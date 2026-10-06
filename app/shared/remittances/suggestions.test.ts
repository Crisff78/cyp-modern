import assert from "node:assert/strict";
import test from "node:test";
import { clientCurrency, clientLabel, commissionSections, contactRows, eligibleClients, LatestRequestGate, matchingClients, quoteHistoryRows, rateMoment, selectRemittanceClient, type RemittanceClient } from "./suggestions";
import type { Currency, Report, Transfer } from "./types";

const client = (id: string, currency?: Currency, extra: Partial<RemittanceClient> = {}): RemittanceClient => ({ id, code: "+509 1234", name: "José Pérez", routeId: "route", active: true, canSendFrom: true, canReceive: true, preferredCurrency: currency, ...extra });

test("predictive matching keeps shared codes as distinct client IDs and matches accents and words", () => {
  const clients = [client("a"), client("b", "USD", { name: "Ana Pérez" }), client("c", "EUR", { code: "X", name: "Álvaro" })];
  assert.deepEqual(matchingClients(clients, "+509").map((row) => row.id), ["a", "b"]);
  assert.deepEqual(matchingClients(clients, "  JOSE   pereZ ").map((row) => row.id), ["a"]);
  assert.deepEqual(matchingClients(clients, clientLabel(clients[1])).map((row) => row.id), ["b"]);
  assert.deepEqual(matchingClients(clients, "alvaro").map((row) => row.id), ["c"]);
  assert.equal(clients[0].id, "a");
  assert.equal(clients[1].id, "b");
});

test("client lookup respects active and sender scope without hiding another-route recipients", () => {
  const clients = [client("sender"), client("inactive", "USD", { active: false }), client("other-route", "EUR", { canSendFrom: false, canReceive: false })];
  assert.deepEqual(eligibleClients(clients, "sender", "").map((row) => row.id), ["sender"]);
  assert.deepEqual(eligibleClients(clients, "recipient", "sender").map((row) => row.id), ["other-route"]);
});

test("sender and recipient selections adopt only their own currency, with legacy DOP default", () => {
  const original = { senderClientId: "", recipientClientId: "", sourceCurrency: "DOP" as Currency, destinationCurrency: "DOP" as Currency, amount: "10.25", note: "No sobrescribir" };
  const sender = selectRemittanceClient(original, "sender", client("a", "USD"));
  const recipient = selectRemittanceClient(sender, "recipient", client("b", "EUR"));
  const differentSender = selectRemittanceClient(recipient, "sender", client("c"));
  assert.deepEqual([recipient.sourceCurrency, recipient.destinationCurrency], ["USD", "EUR"]);
  assert.deepEqual([differentSender.sourceCurrency, differentSender.destinationCurrency], ["DOP", "EUR"]);
  assert.equal(differentSender.amount, "10.25");
  assert.equal(differentSender.note, "No sobrescribir");
  assert.equal(clientCurrency(client("old")), "DOP");
  assert.equal(original.senderClientId, "");
});

test("choosing recipient as new sender clears only invalid recipient identity and preserves its currency", () => {
  const original = { senderClientId: "a", recipientClientId: "b", sourceCurrency: "USD" as Currency, destinationCurrency: "EUR" as Currency };
  const changed = selectRemittanceClient(original, "sender", client("b", "DOP"));
  assert.deepEqual(changed, { senderClientId: "b", recipientClientId: "", sourceCurrency: "DOP", destinationCurrency: "EUR" });
  assert.equal(original.recipientClientId, "b");
});

test("late requests cannot repopulate a cancelled form or replace a newer quotation", async () => {
  const requests = new LatestRequestGate();
  const first = requests.begin();
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  let displayed = "";
  const pending = delayed.then(() => { if (requests.accepts(first)) displayed = "stale"; });
  requests.invalidate(); // user closes the form
  const newer = requests.begin();
  if (requests.accepts(newer)) displayed = "current";
  release(); await pending;
  assert.equal(displayed, "current");
  requests.invalidate(); // route unmount
  assert.equal(requests.accepts(newer), false);
});

test("rate moments display Dominican day/hour and retain unavailable history without invented timestamps", () => {
  const moment = rateMoment("2026-10-05T03:59:30.000Z");
  assert.match(moment, /4\/10\/26/);
  assert.match(moment, /59:30/);
  assert.match(moment, /America\/Santo_Domingo/);
  assert.equal(rateMoment(), "Hora no disponible");
  assert.equal(rateMoment("not-a-date"), "Hora no disponible");
  const legacy = quoteHistoryRows({ date: "2026-10-04", sourceRate: "1.000000", destinationRate: "0.500000" }, "DOP", "EUR");
  assert.deepEqual(legacy[0], ["Fecha de tasa", "2026-10-04"]);
  assert.equal(legacy[1][1], "Hora no disponible");
  assert.equal(legacy[2][1], "DOP: sin hora registrada");
  assert.equal(legacy[3][1], "Hora no disponible");
});

test("receipts take contact values from the confirmed transfer, and legacy receipts do not invent contacts", () => {
  const transfer = { senderContact: { id: "a", code: "S", name: "Nombre al enviar", phone: "+509111", cellular: "+509222", address: "Dirección al enviar" }, recipientContact: { id: "b", code: "R", name: "Destino al enviar", phone: "", cellular: "", address: "" } } as Transfer;
  const rows = contactRows(transfer);
  assert.ok(rows.some((row) => row[1] === "Nombre al enviar"));
  assert.ok(rows.some((row) => row[1] === "+509111"));
  assert.ok(rows.some((row) => row[1] === "Dirección al enviar"));
  assert.ok(rows.some((row) => row[0] === "Destinatario: teléfono" && row[1] === "No registrado"));
  assert.deepEqual(contactRows({} as Transfer), [["Remitente: contacto", "No guardado en esta operación"], ["Destinatario: contacto", "No guardado en esta operación"]]);
});

test("business commission output keeps currencies separate and identifies excluded cancelled amounts", () => {
  const commissions: NonNullable<Report["commissions"]> = {
    totals: [{ date: "2026-10-04", currency: "USD", count: 2, commissionAmount: 321, cancelledCount: 1, cancelledCommissionAmount: 999 }, { date: "2026-10-04", currency: "EUR", count: 1, commissionAmount: 42, cancelledCount: 0, cancelledCommissionAmount: 0 }],
    details: [{ id: "t", envioReference: "E1", createdAt: "2026-10-05T03:59:30Z", sendingUserId: "u", senderClientId: "a", recipientClientId: "b", sourceCurrency: "USD", destinationCurrency: "EUR", amount: 10000, commissionBps: 500, commissionAmount: 500, status: "cancelled" }],
  };
  const [totals, detail] = commissionSections(commissions, () => "Operador");
  assert.deepEqual(totals.rows.map((row) => [row[1], row[3], row[5]]), [["USD", "USD 3.21", "USD 9.99"], ["EUR", "EUR 0.42", "EUR 0.00"]]);
  assert.equal(detail.rows[0][2], "Operador");
  assert.equal(detail.rows[0][8], "Cancelado (excluido del total vigente)");
  assert.ok(!detail.columns.some((column) => /gestor/i.test(column)));
});
