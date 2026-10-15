import { createHash, randomUUID } from "node:crypto";
import { assertAdmin, businessDate, DomainError, ledgerCurrencies, preview, unresolvedCashDates, type Settlement, type State, type User } from "./domain.js";
import type { CashReconciliationRecord, PreviousCashInput, PreviousCashPreview, PreviousCashRow } from "../../shared/cashReconciliation.js";

export function reconciledSettlements(state: State): Settlement[] {
  const groups = new Map<string, CashReconciliationRecord[]>();
  for (const record of state.cashReconciliations ?? []) {
    const key = `${record.collectorId}:${record.date}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return [...groups.values()].map((records) => {
    const first = records[0];
    const totalsByCurrency = Object.fromEntries(ledgerCurrencies.map((currency) => {
      const record = records.find((row) => row.currency === currency);
      return [currency, record ? { collected: record.collected, deposited: record.deposited,
        officeDelivered: record.officeDelivered, paidToClients: record.paidToClients,
        returnedCollection: record.returnedCollection, returnedPayout: record.returnedPayout, difference: 0 }
        : preview(state, first.collectorId, first.date, currency)];
    })) as NonNullable<Settlement["totalsByCurrency"]>;
    return { id: `cash-reconciliation:${first.id}`, collectorId: first.collectorId, date: first.date,
      ...totalsByCurrency.DOP, totalsByCurrency, status: "closed" as const,
      closedAt: first.createdAt, actorId: first.actorId, cashReconciled: true };
  });
}

export function previousCashPreview(state: State, collectorId: string, now = new Date(), demo = false, selectedDate?: string): PreviousCashPreview {
  const collector = state.collectors.find((row) => row.id === collectorId);
  if (!collector) throw new DomainError("NOT_FOUND", "Cobrador no encontrado.", 404);
  const today = businessDate(now);
  if (selectedDate !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate) ||
      Number.isNaN(Date.parse(`${selectedDate}T12:00:00Z`)) || new Date(`${selectedDate}T12:00:00Z`).toISOString().slice(0, 10) !== selectedDate))
    throw new DomainError("INVALID_DATE", "Selecciona una fecha de jornada válida.", 422);
  if (selectedDate && selectedDate > today)
    throw new DomainError("FUTURE_DATE", "No se puede cerrar una fecha futura.", 422);
  const movements = state.movements.filter((row) => row.collectorId === collectorId &&
    (selectedDate ? businessDate(new Date(row.createdAt)) === selectedDate : businessDate(new Date(row.createdAt)) < today));
  const history = (state.cashReconciliations ?? []).filter((row) => row.collectorId === collectorId);
  const dates = [...new Set(movements.map((row) => businessDate(new Date(row.createdAt))))].sort();
  const rows: PreviousCashRow[] = [], amounts = { DOP: 0, USD: 0, EUR: 0 }, issues: string[] = [];
  const earlier = selectedDate ? unresolvedCashDates(state, collectorId, selectedDate) : [];
  if (earlier.length) issues.push(`Completa primero el cuadre pendiente del ${earlier[0]} en Cuadres Diarios.`);
  for (const date of dates) for (const currency of ledgerCurrencies) {
    const balance = preview(state, collectorId, date, currency);
    const returnedCollection = balance.collected - balance.deposited - (balance.returnedCollection ?? 0);
    const returnedPayout = balance.officeDelivered - balance.paidToClients - (balance.returnedPayout ?? 0);
    if (returnedCollection === 0 && returnedPayout === 0) continue;
    const amount = returnedCollection + returnedPayout;
    rows.push({ date, currency, collected: balance.collected, deposited: balance.deposited,
      officeDelivered: balance.officeDelivered, paidToClients: balance.paidToClients, returnedCollection, returnedPayout, amount });
    if (![balance.collected, balance.deposited, balance.officeDelivered, balance.paidToClients, returnedCollection, returnedPayout, amount].every(Number.isSafeInteger)) issues.push(`${date} · ${currency}: el saldo excede el rango seguro y requiere revisión administrativa.`);
    else if (returnedCollection < 0 || returnedPayout < 0) issues.push(`${date} · ${currency}: hay una diferencia negativa; revisa los movimientos antes de conciliar.`);
    else if (state.settlements.some((row) => row.collectorId === collectorId && row.date === date)) issues.push(`${date} · ${currency}: la jornada figura cerrada y requiere revisión administrativa.`);
    amounts[currency] += amount;
  }
  if (!Object.values(amounts).every((amount) => Number.isSafeInteger(amount) && amount >= 0)) issues.push("Los totales por moneda no permiten una conciliación automática.");
  const revision = createHash("sha256").update(JSON.stringify({ collectorId, today, ...(selectedDate ? { date: selectedDate, earlier } : {}), rows,
    movementIds: movements.map((row) => [row.id, row.amount, row.type, row.currency ?? "DOP", row.createdAt, row.cancelledAt ?? ""]).sort(),
    history: history.map((row) => row.id).sort(), closed: state.settlements.filter((row) => row.collectorId === collectorId).map((row) => row.id).sort() })).digest("hex");
  return { collectorId, collectorName: collector.name, businessDate: today, ...(selectedDate ? { date: selectedDate } : {}), revision, rows, amounts,
    canReconcile: rows.length > 0 && issues.length === 0, issues, history, demo };
}

export function reconcilePreviousCash(state: State, actor: User, input: PreviousCashInput, now = new Date()) {
  assertAdmin(actor);
  if (input.confirmReceived !== true) throw new DomainError("CASH_RECEIPT_CONFIRMATION_REQUIRED", "Confirma la recepción del efectivo antes de conciliar.", 422);
  const note = input.note.trim();
  if (!note || note.length > 2000) throw new DomainError("RECONCILIATION_NOTE_REQUIRED", "Escribe el motivo de la conciliación (máximo 2000 caracteres).", 422);
  const current = previousCashPreview(state, input.collectorId, now, false, input.date);
  if (current.revision !== input.revision) throw new DomainError("CASH_RECONCILIATION_CHANGED", "El saldo cambió. Refresca y revisa los importes antes de confirmar.", 409);
  if (!current.rows.length) throw new DomainError("NO_PREVIOUS_CASH", input.date
    ? "La jornada seleccionada no tiene efectivo pendiente de devolución."
    : "El cobrador no tiene efectivo pendiente de jornadas anteriores.", 409);
  if (!current.canReconcile) throw new DomainError("CASH_RECONCILIATION_REVIEW_REQUIRED", current.issues.join(" "), 409);
  for (const currency of ledgerCurrencies) if (!Number.isSafeInteger(input.amounts[currency]) || input.amounts[currency] !== current.amounts[currency])
    throw new DomainError("CASH_RECONCILIATION_AMOUNT_MISMATCH", `El efectivo recibido en ${currency} debe coincidir exactamente con el pendiente.`, 422);
  const createdAt = now.toISOString();
  const records: CashReconciliationRecord[] = current.rows.map(({ amount: _amount, ...row }) => ({ ...row,
    id: randomUUID(), collectorId: input.collectorId, note, actorId: actor.id, createdAt }));
  state.cashReconciliations ??= [];
  state.cashReconciliations.push(...records);
  return { collectorId: input.collectorId, records, amounts: current.amounts };
}
