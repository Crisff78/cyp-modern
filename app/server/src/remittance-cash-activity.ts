import { DomainError, type State, type User } from "./domain.js";
import { hasRemittancePermission } from "../../shared/access.mjs";
import { paymentLabel, totalPaidForTransfer } from "../../shared/remittances/payment.mjs";
import { cashBalance } from "./remittances.js";
import type { CashActivity, CashActivityKind } from "../../shared/remittances/cashActivity.mjs";

/** A read-only cash ledger: scope by the box, not by the client's current route or the transfer's current status. */
export function remittanceCashActivity(state: State, actor: User, id: string, systemOperators: User[] = []): CashActivity {
  if (!hasRemittancePermission(actor, "remittances.cash.view")) throw new DomainError("FORBIDDEN", "No tienes permiso para consultar cajas de remesas.", 403);
  const cash = state.remittances.cashSessions.find(row => row.id === id && (actor.role === "admin" || actor.role === "supervisor" || row.operatorId === actor.id));
  if (!cash) throw new DomainError("CASH_NOT_FOUND", "Caja no encontrada.", 404);
  const names = new Map([...systemOperators, ...state.accounts, actor].map(user => [user.id, user.name]));
  const name = (userId: string) => names.get(userId) || "Usuario no disponible";
  const transfers = new Map(state.remittances.transfers.map(transfer => [transfer.id, transfer]));
  const entries: CashActivity["entries"] = (state.remittances.cashMovements ?? []).filter(row => row.cashSessionId === cash.id).map(row => ({
    id: `movement:${row.id}`, kind: row.type, direction: row.type === "addition" ? "in" : "out", amount: row.amount,
    createdAt: row.createdAt, recordedBy: name(row.actorId), note: row.note ?? "",
  }));
  for (const event of state.remittances.events) {
    if (event.cashSessionId !== cash.id || !["sent", "paid", "cancelled"].includes(event.type)) continue;
    const transfer = event.transferId ? transfers.get(event.transferId) : undefined;
    const kind = event.type === "cancelled" ? "refund" : event.type as "sent" | "paid";
    const operationAmount = kind === "paid" ? event.amount : transfer?.sourceCurrency === cash.currency ? totalPaidForTransfer(transfer) : undefined;
    entries.push({ id: `event:${event.id}`, kind, direction: kind === "sent" ? "in" : "out", amount: event.amount,
      createdAt: event.createdAt, recordedBy: name(event.actorId), note: event.reason ?? "",
      ...(transfer ? { reference: transfer.envioReference, receiptReference: transfer.reciboReference } : {}),
      ...(operationAmount === undefined ? {} : { operationAmount }),
      ...(kind === "paid" ? { payment: "Efectivo" } : transfer?.payment ? { payment: paymentLabel(transfer.payment) } : {}),
    });
  }
  entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const totals: CashActivity["totals"] = cashBalance(state, cash);
  if (cash.status === "closed" && cash.countedAmount !== undefined) totals.carry = cash.countedAmount - totals.discharged;
  const amounts: Record<CashActivityKind, number> = { addition: totals.added, withdrawal: totals.withdrawn, sent: totals.sentTotal,
    refund: totals.cancelRefund, paid: totals.paid, discharge: totals.discharged };
  const groups = Object.fromEntries(Object.entries(amounts).map(([kind, amount]) => [kind, { count: entries.filter(row => row.kind === kind).length, amount }])) as CashActivity["groups"];
  return { cash: { id: cash.id, date: cash.date, currency: cash.currency, operatorName: name(cash.operatorId), status: cash.status,
    openingAmount: cash.openingAmount, openedAt: cash.openedAt, openedBy: name(cash.openedBy),
    ...(cash.closedAt ? { closedAt: cash.closedAt } : {}), ...(cash.closedBy ? { closedBy: name(cash.closedBy) } : {}),
    ...(cash.countedAmount === undefined ? {} : { countedAmount: cash.countedAmount }) }, totals, groups, entries };
}
