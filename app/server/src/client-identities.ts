import { randomUUID } from "node:crypto";
import { assertAdmin, DomainError, type ClientIdentityReservation, type State, type User } from "./domain.js";

// Codes in these formats are assigned by the system and are never typed by hand:
// a typed one would move the series or block a number that nobody uses.
export const SYSTEM_CLIENT_CODE = /^(?:CLI|INT)\d+$/i;

// Number of a generated code. Values that are not a safe integer are ignored.
const seriesNumber = (value: string | undefined) => {
  const match = /^CLI(\d{1,15})$/.exec(value ?? "");
  return match ? Number(match[1]) : 0;
};

// Reservations run inside Store.transaction. PostgreSQL serializes all writers;
// the file/memory stores serialize their own queue. A cancelled form leaves a
// gap rather than reusing a technical identity or modifying a legal document.
// With `withCode = false` (a client saved with its own code, for example its phone)
// the reservation only carries the internal identification: its `code` is a technical
// placeholder, so the client's own code is not locked and no number of the generated
// CLI series is used up.
export function reserveClientIdentity(state: State, actor: User, now = new Date(), withCode = true): ClientIdentityReservation {
  assertAdmin(actor);
  const reservations = (state.clientIdentityReservations ??= []);
  let sequence = 0, codeNumber = 0;
  for (const row of reservations) sequence = Math.max(sequence, row.sequence);
  for (const row of state.clients) {
    const match = /^INT(\d+)$/.exec(row.internalIdentification ?? "");
    if (match) sequence = Math.max(sequence, Number(match[1]));
  }
  // The series comes only from codes generated here, which always live in a reservation.
  // A code that a client already uses is skipped below.
  for (const row of reservations) codeNumber = Math.max(codeNumber, seriesNumber(row.code));
  const taken = (field: "code" | "internalIdentification", value: string) =>
    state.clients.some((row) => row[field] === value) || reservations.some((row) => row[field] === value);
  let internalIdentification: string;
  do {
    sequence += 1;
    if (!Number.isSafeInteger(sequence)) throw new DomainError("CLIENT_SEQUENCE_EXHAUSTED", "La secuencia de clientes requiere revisión.", 409);
    internalIdentification = `INT${String(sequence).padStart(8, "0")}`;
  } while (taken("internalIdentification", internalIdentification) || taken("code", internalIdentification));
  let code = withCode ? "" : internalIdentification;
  while (withCode && (!code || taken("code", code))) {
    codeNumber += 1;
    if (!Number.isSafeInteger(codeNumber)) throw new DomainError("CLIENT_SEQUENCE_EXHAUSTED", "La secuencia de clientes requiere revisión.", 409);
    code = `CLI${String(codeNumber).padStart(8, "0")}`;
  }
  const reservation = { id: randomUUID(), sequence, code, internalIdentification, actorId: actor.id, createdAt: now.toISOString() };
  reservations.push(reservation);
  return reservation;
}

// `code` is undefined when the reservation did not generate one (see `withCode`).
export function claimClientIdentity(state: State, actor: User, clientId: string, reservationId?: string, withCode = true) {
  assertAdmin(actor);
  const reservation = reservationId
    ? state.clientIdentityReservations.find((row) => row.id === reservationId)
    : reserveClientIdentity(state, actor, new Date(), withCode);
  if (!reservation || reservation.actorId !== actor.id || reservation.clientId)
    throw new DomainError("CLIENT_RESERVATION_UNAVAILABLE", "La reserva no está disponible para esta cuenta. Genera una nueva.", 409);
  reservation.clientId = clientId;
  return {
    code: reservation.code === reservation.internalIdentification ? undefined : reservation.code,
    internalIdentification: reservation.internalIdentification,
  };
}
