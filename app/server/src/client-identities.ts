import { randomUUID } from "node:crypto";
import { assertAdmin, DomainError, type ClientIdentityReservation, type State, type User } from "./domain.js";

// Reservations run inside Store.transaction. PostgreSQL serializes all writers;
// the file/memory stores serialize their own queue. A cancelled form leaves a
// gap rather than reusing a technical identity or modifying a legal document.
export function reserveClientIdentity(state: State, actor: User, now = new Date()): ClientIdentityReservation {
  assertAdmin(actor);
  const reservations = (state.clientIdentityReservations ??= []);
  let sequence = 0;
  for (const row of reservations) sequence = Math.max(sequence, row.sequence);
  for (const row of state.clients) {
    const match = /^INT(\d+)$/.exec(row.internalIdentification ?? "");
    if (match) sequence = Math.max(sequence, Number(match[1]));
  }
  let code: string, internalIdentification: string;
  do {
    sequence += 1;
    if (!Number.isSafeInteger(sequence)) throw new DomainError("CLIENT_SEQUENCE_EXHAUSTED", "La secuencia de clientes requiere revisión.", 409);
    code = `CLI${String(sequence).padStart(8, "0")}`;
    internalIdentification = `INT${String(sequence).padStart(8, "0")}`;
  } while (state.clients.some((row) => row.code === code || row.internalIdentification === internalIdentification) ||
    reservations.some((row) => row.code === code || row.internalIdentification === internalIdentification));
  const reservation = { id: randomUUID(), sequence, code, internalIdentification, actorId: actor.id, createdAt: now.toISOString() };
  reservations.push(reservation);
  return reservation;
}

export function claimClientIdentity(state: State, actor: User, clientId: string, reservationId?: string) {
  assertAdmin(actor);
  const reservation = reservationId
    ? state.clientIdentityReservations.find((row) => row.id === reservationId)
    : reserveClientIdentity(state, actor);
  if (!reservation || reservation.actorId !== actor.id || reservation.clientId)
    throw new DomainError("CLIENT_RESERVATION_UNAVAILABLE", "La reserva no está disponible para esta cuenta. Genera una nueva.", 409);
  reservation.clientId = clientId;
  return { code: reservation.code, internalIdentification: reservation.internalIdentification };
}
