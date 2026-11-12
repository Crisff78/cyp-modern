import { randomUUID } from "node:crypto";
import { businessDate, DomainError, type State, type User } from "./domain.js";
import { hasRemittancePermission } from "../../shared/access.mjs";
import { cashBalance, cashView, type CashSession } from "./remittances.js";

// Excepción de la demo: continúa la misma caja, sin borrar cierres ni inventar efectivo.
export function demoCashReopeningProblem(state: State, actor: User, cash: CashSession, now = new Date()): string | undefined {
  if (actor.role !== "admin" || !(["remittances.cash.view", "remittances.cash.open", "remittances.cash.close"] as const)
    .every(permission => hasRemittancePermission(actor, permission)))
    return "Solo un administrador con permisos de caja puede reabrir una caja de prueba.";
  if (cash.status !== "closed") return "La caja ya está abierta.";
  if (cash.date !== businessDate(now)) return "Solo se puede reabrir la caja de prueba de hoy.";
  if (state.remittances.cashSessions.some(other => other.operatorId === cash.operatorId && other.currency === cash.currency && other.date > cash.date))
    return "Hay una caja posterior que depende de este cierre.";
  if (cashBalance(state, cash).discharged > 0)
    return "No se puede reabrir: al cerrar se descargó dinero al encargado. Ese efectivo ya no está en la caja.";
}

export function reopenDemoRemittanceCash(state: State, actor: User, id: string, demo: boolean, now = new Date()) {
  if (!demo) throw new DomainError("NOT_FOUND", "Opción disponible solo en la demo.", 404);
  const cash = state.remittances.cashSessions.find(row => row.id === id);
  if (!cash) throw new DomainError("CASH_NOT_FOUND", "Caja no encontrada.", 404);
  const problem = demoCashReopeningProblem(state, actor, cash, now);
  if (problem) throw new DomainError(actor.role !== "admin" ? "FORBIDDEN" : "CASH_REOPEN_BLOCKED", problem, actor.role !== "admin" ? 403 : 409);
  const last = state.remittances.events.filter(event => event.cashSessionId === id).reduce((max, event) => Math.max(max, Date.parse(event.createdAt)), 0);
  state.remittances.events.push({ id: randomUUID(), type: "reopened", cashSessionId: id, operatorId: cash.operatorId, currency: cash.currency,
    amount: cashBalance(state, cash).expected, actorId: actor.id, createdAt: new Date(Math.max(now.getTime(), last + 1)).toISOString(),
    reason: "Reapertura de la caja de hoy para continuar pruebas en la demo." });
  cash.status = "open";
  delete cash.closedBy; delete cash.closedAt; delete cash.countedAmount;
  return cashView(state, actor, cash);
}
