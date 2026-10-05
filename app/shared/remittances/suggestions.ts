import type { Currency, Quote, RemittanceSnapshot, Transfer } from "./types";
import { decimalCents, formatDate, formatMoney, type OutputSection } from "./output";

export type RemittanceClient = RemittanceSnapshot["clients"][number];
export type ClientSide = "sender" | "recipient";

const searchable = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/·/g, " ").toLocaleLowerCase("es").trim();

// This lookup uses only the projection authorized by the server. A shared code
// or name never merges two client records or selects one implicitly.
export function matchingClients(clients: RemittanceClient[], query: string) {
  const terms = searchable(query).split(/\s+/).filter(Boolean);
  return clients.filter((client) => {
    const text = searchable(`${client.code} ${client.name}`);
    return terms.every((term) => text.includes(term));
  });
}

export function eligibleClients(clients: RemittanceClient[], side: ClientSide, senderId: string) {
  return clients.filter((client) => client.active && (side === "sender" ? client.canSendFrom : client.id !== senderId));
}

export function clientCurrency(client: RemittanceClient): Currency {
  return client.preferredCurrency ?? "DOP";
}

export function clientLabel(client: RemittanceClient) {
  return `${client.code} · ${client.name}`;
}

export function selectRemittanceClient<T extends { senderClientId: string; recipientClientId: string; sourceCurrency: Currency; destinationCurrency: Currency }>(current: T, side: ClientSide, client: RemittanceClient): T {
  return side === "sender"
    ? { ...current, senderClientId: client.id, sourceCurrency: clientCurrency(client), ...(current.recipientClientId === client.id ? { recipientClientId: "" } : {}) }
    : { ...current, recipientClientId: client.id, destinationCurrency: clientCurrency(client) };
}

// Each request owns a ticket. Editing, closing or unmounting retires it, so a
// late quotation/report cannot become the confirmation for a newer form.
export class LatestRequestGate {
  private ticket = 0;
  begin() { return ++this.ticket; }
  invalidate() { ++this.ticket; }
  accepts(ticket: number) { return ticket === this.ticket; }
}

export function rateMoment(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Hora no disponible";
  return `${new Intl.DateTimeFormat("es-DO", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Santo_Domingo" }).format(new Date(value))} (America/Santo_Domingo)`;
}

export function quoteHistoryRows(quote: Quote, sourceCurrency: Currency, destinationCurrency: Currency): (string | number)[][] {
  return [
    ["Fecha de tasa", quote.date],
    ["Cotización confirmada", rateMoment(quote.quotedAt)],
    ["Cambio de tasa de origen", sourceCurrency === "DOP" ? "DOP: referencia fija 1" : rateMoment(quote.sourceRateChangedAt)],
    ["Cambio de tasa de destino", destinationCurrency === "DOP" ? "DOP: referencia fija 1" : rateMoment(quote.destinationRateChangedAt)],
  ];
}

export function contactRows(transfer: Transfer): (string | number)[][] {
  return ([ ["Remitente", transfer.senderContact], ["Destinatario", transfer.recipientContact] ] as const).flatMap(([label, contact]) => contact ? [
    [`${label}: código`, contact.code], [`${label}: nombre al registrar`, contact.name],
    [`${label}: teléfono`, contact.phone || "No registrado"], [`${label}: celular`, contact.cellular || "No registrado"],
    [`${label}: dirección`, contact.address || "No registrada"],
  ] : [[`${label}: contacto`, "No guardado en esta operación"]]);
}

export type ManagerCommission = NonNullable<Transfer["managerCommission"]>;
export function parseManagerCommission(enabled: boolean, managerName: string, amount: string, currency: string): ManagerCommission | undefined {
  if (!enabled) return undefined;
  const name = managerName.trim();
  if (!name || name.length > 160) throw new Error("Escribe el nombre del gestor (máximo 160 caracteres).");
  if (currency !== "DOP" && currency !== "USD" && currency !== "EUR") throw new Error("Selecciona la moneda de la comisión del gestor.");
  return { managerName: name, amount: decimalCents(amount, true), currency };
}

export function managerCommissionRows(commission?: ManagerCommission): (string | number)[][] {
  return commission ? [["Gestor (información manual)", commission.managerName], ["Comisión informativa del gestor", formatMoney(commission.amount, commission.currency)], ["Tratamiento", "Información declarada; no se suma al cobro ni registra un pago al gestor"]] : [["Comisión informativa del gestor", "No registrada en esta operación"]];
}

export function managerCommissionMatches(expected: ManagerCommission | undefined, actual: unknown) {
  if (expected === undefined) return actual === undefined;
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  const row = actual as Record<string, unknown>;
  return Object.keys(row).sort().join(",") === "amount,currency,managerName" && row.managerName === expected.managerName && row.amount === expected.amount && row.currency === expected.currency;
}

type ManagerCommissions = NonNullable<import("./types").Report["managerCommissions"]>;
export function managerCommissionSections(commissions: ManagerCommissions): OutputSection[] {
  return [
    { title: "Información manual de comisiones por gestor y moneda", columns: ["Fecha", "Gestor declarado", "Moneda", "Vigentes", "Importe informativo vigente", "Canceladas", "Importe informativo cancelado"], rows: commissions.totals.map((row) => [row.date, row.managerName, row.currency, row.count, formatMoney(row.amount, row.currency), row.cancelledCount, formatMoney(row.cancelledAmount, row.currency)]) },
    { title: "Detalle informativo de comisiones de gestores", columns: ["Envío", "Emitido", "Gestor declarado", "Moneda", "Importe informativo", "Estado"], rows: commissions.details.map((row) => [row.envioReference, formatDate(row.createdAt), row.managerName, row.currency, formatMoney(row.amount, row.currency), row.status === "cancelled" ? "Cancelado (excluido del total vigente)" : row.status === "paid" ? "Pagado" : "Pendiente de entrega"]) },
  ];
}

type Commissions = NonNullable<import("./types").Report["commissions"]>;
export function commissionSections(commissions: Commissions, operatorName: (id: string) => string): OutputSection[] {
  return [
    { title: "Comisión del negocio por moneda (canceladas excluidas)", columns: ["Fecha", "Moneda", "Operaciones vigentes", "Comisión vigente", "Canceladas", "Comisión cancelada"], rows: commissions.totals.map((row) => [row.date, row.currency, row.count, formatMoney(row.commissionAmount, row.currency), row.cancelledCount, formatMoney(row.cancelledCommissionAmount, row.currency)]) },
    { title: "Detalle de comisiones del negocio", columns: ["Envío", "Emitido", "Operador", "Moneda origen", "Moneda destino", "Principal", "Comisión (%)", "Comisión", "Estado"], rows: commissions.details.map((row) => [row.envioReference, formatDate(row.createdAt), operatorName(row.sendingUserId), row.sourceCurrency, row.destinationCurrency, formatMoney(row.amount, row.sourceCurrency), row.commissionBps / 100, formatMoney(row.commissionAmount, row.sourceCurrency), row.status === "cancelled" ? "Cancelado (excluido del total vigente)" : row.status === "paid" ? "Pagado" : "Pendiente de entrega"]) },
  ];
}
