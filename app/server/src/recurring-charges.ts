import { createHash } from "node:crypto";
import { businessDate, supportedLedgerCurrency, type RecurringCharge, type State } from "./domain.js";
import { frequencyCodes } from "./catalog-store.js";
import { recordAdminTrace } from "./admin-tools.js";

const DAY = 86400000;
const dateValue = (value: string) => Date.parse(`${value}T00:00:00Z`);
const iso = (value: number) => new Date(value).toISOString().slice(0, 10);
export function nextChargeDate(template: RecurringCharge, from: string): string | undefined {
  const frequency = frequencyCodes[template.frequency] ?? template.frequency;
  if (frequency === "undefined" || !template.active || !template.generationFrom) return undefined;
  const start = dateValue(template.startDate), lower = Math.max(start, dateValue(from), dateValue(template.generationFrom));
  if (!Number.isFinite(lower) || !Number.isFinite(start)) return undefined;
  const anchor = new Date(start), periods: Record<string, number> = { monthly: 1, quarterly: 3, four_monthly: 4, semiannual: 6, yearly: 12 };
  const interval: Record<string, number> = { daily: 1, every_other_day: 2, weekly: 7, fortnightly: 15 };
  for (let cursor = lower; cursor <= lower + 370 * DAY; cursor += DAY) {
    const day = iso(cursor);
    if (template.endDate && day > template.endDate) return undefined;
    const date = new Date(cursor), monthDays = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    const selectedDays = [template.day1, template.day2].filter((value) => /^\d{1,2}$/.test(value) && Number(value) >= 1 && Number(value) <= 31).map(Number);
    if (frequency === "fortnightly" && selectedDays.length === 2) {
      if (selectedDays.some((value) => Math.min(value, monthDays) === date.getUTCDate())) return day;
    } else if (interval[frequency]) {
      if (((cursor - start) / DAY) % interval[frequency] === 0) return day;
    } else if (periods[frequency]) {
      const months = (date.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + date.getUTCMonth() - anchor.getUTCMonth();
      const firstDay = /^\d{1,2}$/.test(template.day1) && Number(template.day1) >= 1 && Number(template.day1) <= 31 ? Number(template.day1) : anchor.getUTCDate();
      if (months % periods[frequency] === 0 && Math.min(firstDay, monthDays) === date.getUTCDate()) return day;
    } else return undefined;
  }
  return undefined;
}

// Transactional, repeatable and bounded. Cancelled generated charges are never regenerated.
export function generateScheduledCharges(state: State, through = businessDate(), maximum = 100) {
  const generated: string[] = [], skipped: { id: string; reason: string }[] = [];
  for (const template of state.recurringCharges) {
    if (generated.length >= maximum) break;
    if (template.nextRunDate === "") continue;
    let due = nextChargeDate(template, template.nextRunDate || template.generationFrom || through);
    const client = state.clients.find((row) => row.id === template.clientId), service = state.services.find((row) => row.id === template.serviceId || row.service === template.service);
    if (!client || client.active === false || !service?.active || !supportedLedgerCurrency(template.currency) || /remesa/i.test(service.service) || !Number.isSafeInteger(template.amount) || template.amount <= 0) {
      if (template.active && due && due <= through) skipped.push({ id: template.id, reason: "Revisa el cliente, servicio, moneda e importe de la plantilla." });
      continue;
    }
    while (due && due <= through && generated.length < maximum) {
      const id = `rec-${createHash("sha256").update(JSON.stringify([template.id, due])).digest("hex")}`;
      if (!state.charges.some((row) => row.id === id || row.recurringTemplateId === template.id && row.scheduledDate === due)) {
        state.charges.push({ id, clientId: client.id, serviceId: service.id, service: service.service, concept: template.concept,
          currency: supportedLedgerCurrency(template.currency), amount: template.amount, collected: 0, dueDate: due,
          note: template.note, required: service.obligated, status: "pending", recurringTemplateId: template.id, scheduledDate: due });
        generated.push(id);
      }
      due = nextChargeDate(template, iso(dateValue(due) + DAY));
      template.nextRunDate = due ?? "";
    }
  }
  if (generated.length) {
    const audit = recordAdminTrace(state, {id:"system-recurring",name:"Calendario de cargos",role:"admin"}, "recurring.generated", "cargos-recurrentes");
    audit.details = { version:1, through, generated };
  }
  return { generated, skipped, through };
}
