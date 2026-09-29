import { createHash } from "node:crypto";
import type { State } from "../app/server/src/domain.js";

// Pin the newly generated synthetic-only snapshot after its private audit.
// A changed file needs a new audit before it can be served after a restart.
const approvedSnapshot = "44e1e202d89b872617bdd78a4e031937b2146978c68bd6c549ea5c822e70bd5e";
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export function assertApprovedReviewState(contents: Buffer, state: State): void {
  const reject = (): never => { throw new Error("Review state failed synthetic-only checks"); };
  if (digest(contents) !== approvedSnapshot) reject();
  if (state.clients?.length !== 16 || state.collectors?.length !== 5 ||
      state.routes?.length !== 5 || state.accounts?.length !== 2 ||
      state.remittances?.transfers?.length !== 8 ||
      state.remittances?.cashSessions?.length !== 9 ||
      state.remittances?.events?.length !== 23 ||
      state.idempotency?.length !== 1 || state.idempotency[0].id !== "review-v1-seed-v1") reject();

  const clients = new Set<string>();
  for (const client of state.clients) {
    if (!/^(?:cli-[1-8]|review-v1-client-[1-8])$/.test(client.id) ||
        !client.name.startsWith("Prueba CyP Cliente") ||
        !/^(?:DEMO-|REVIEW-V1-)/.test(client.code) ||
        !client.address.startsWith("Dirección sintética ") ||
        client.sector !== "GPS de muestra" ||
        !client.note?.includes("SINTÉTICOS") ||
        client.phone || client.cellular || client.email || client.identification ||
        !Number.isFinite(client.lat) || !Number.isFinite(client.lng)) reject();
    clients.add(client.id);
  }
  if (clients.size !== 16 ||
      state.collectors.some((row) => !row.name.startsWith("Prueba CyP") || row.ident || row.cellular) ||
      state.routes.some((row) => !row.name.startsWith("Prueba CyP")) ||
      state.accounts.some((row) => !/^review-v1-operator-[12]$/.test(row.id) ||
        !row.name.startsWith("Prueba CyP") || !row.email.endsWith("@example.invalid") ||
        row.salt !== "DRY_RUN" || row.passwordHash !== "DRY_RUN_NOT_A_CREDENTIAL")) reject();

  for (const transfer of state.remittances.transfers) {
    if (!clients.has(transfer.senderClientId) || !clients.has(transfer.recipientClientId) ||
        !/^ENV\d{8}$/.test(transfer.envioReference) ||
        !/^REC\d{8}$/.test(transfer.reciboReference) ||
        (transfer.note && !transfer.note.includes("SINTÉTICOS"))) reject();
  }

  const sample = state.remittances.transfers.filter((row) => row.sendingUserId === "demo-collector");
  const cash = state.remittances.cashSessions.filter((row) => row.operatorId === "demo-collector");
  if (sample.length !== 1 || cash.length !== 1) reject();
  const transfer = sample[0], session = cash[0];
  if (transfer.sequence !== 8 || transfer.envioReference !== "ENV00000008" ||
      transfer.reciboReference !== "REC00000008" ||
      transfer.registeredBy !== "demo-admin" || transfer.senderClientId !== "cli-1" ||
      transfer.recipientClientId !== "cli-2" || transfer.sourceCurrency !== "DOP" ||
      transfer.destinationCurrency !== "DOP" || transfer.amount !== 50000 ||
      transfer.commissionBps !== 200 || transfer.commissionAmount !== 1000 ||
      transfer.totalAmount !== 51000 || transfer.receiveAmount !== 50000 ||
      transfer.status !== "pending" ||
      transfer.note !== "DATOS SINTÉTICOS PRUEBA CYP. Envío pendiente para el cobrador de muestra." ||
      session.currency !== "DOP" || session.openingAmount !== 0 || session.status !== "open" ||
      session.date !== transfer.quote.date ||
      state.remittances.events.filter((row) => row.cashSessionId === session.id).length !== 2) reject();
}
