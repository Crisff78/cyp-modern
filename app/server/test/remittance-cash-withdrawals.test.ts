import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { businessDate, type User } from "../src/domain.js";
import { seed } from "../src/seed.js";
import { MemoryStore, PostgresStore, type Store } from "../src/store.js";
import { effectiveAccess } from "../../shared/access.mjs";
import { addRemittanceCash, cashBalance, closeRemittanceCash, openRemittanceCash, remittanceOpeningCarry,
  remittanceReports, remittanceSnapshot, withdrawRemittanceCash } from "../src/remittances.js";

const now = new Date("2026-11-05T16:00:00.000Z"), tomorrow = new Date("2026-11-06T16:00:00.000Z");
const admin: User = { id: "cash-admin", role: "admin", name: "Encargado" };
const cashier: User = { id: "cash-operator", role: "cashier", name: "Operador" };
const other: User = { id: "cash-other", role: "cashier", name: "Otro operador" };
const operators = [admin, cashier, other];
const code = (expected: string) => (error: unknown) => { assert.equal((error as { code: string }).code, expected); return true; };

test("additional cash and daytime withdrawals reconcile the remaining count and carry exactly once", () => {
  const state = seed();
  const box = openRemittanceCash(state, admin, { operatorId: cashier.id, currency: "DOP", openingAmount: 5000000 }, operators, now);
  addRemittanceCash(state, admin, box.id, { amount: 200000, note: "Refuerzo de efectivo" }, now);
  // Synthetic already-paid receipt: the remaining expected cash is 6,000.00.
  state.remittances.events.push({ id: randomUUID(), type: "paid", amount: 4600000, cashSessionId: box.id,
    currency: "DOP", operatorId: cashier.id, actorId: cashier.id, createdAt: now.toISOString() });
  const withdrawn = withdrawRemittanceCash(state, cashier, box.id, { amount: 400000, note: "Entregado al encargado: exceso de efectivo" }, now);
  assert.equal(withdrawn.status, "open"); assert.equal(withdrawn.openingAmount, 5000000);
  assert.equal(withdrawn.added, 200000); assert.equal(withdrawn.withdrawn, 400000); assert.equal(withdrawn.expected, 200000);
  assert.throws(() => closeRemittanceCash(state, cashier, box.id, 600000, now), code("CASH_UNBALANCED"));
  // An additional 500.00 handed over after counting is separate from the day's previous withdrawals.
  const closed = closeRemittanceCash(state, cashier, box.id, 200000, now, 50000);
  assert.equal(closed.carry, 150000); assert.equal(closed.withdrawn, 400000); assert.equal(closed.discharged, 50000);
  assert.equal(remittanceOpeningCarry(state, cashier.id, "DOP", businessDate(tomorrow))?.amount, 150000);
  const history = structuredClone(state.remittances.cashSessions[0]);
  const next = openRemittanceCash(state, admin, { operatorId: cashier.id, currency: "DOP", openingAmount: 150000 }, operators, tomorrow);
  assert.equal(next.expected, 150000); assert.equal(next.withdrawn, 0);
  assert.deepEqual(state.remittances.cashSessions[0], history, "opening the next day does not rewrite the previous close");
  const report = remittanceReports(state, admin, { from: businessDate(now), to: businessDate(tomorrow), grouping: "range" }).cashSummary[0];
  assert.equal(report.firstOpening, 5000000); assert.equal(report.added, 200000); assert.equal(report.withdrawn, 400000);
  assert.equal(report.discharged, 50000); assert.equal(report.lastExpected, 150000); assert.equal(report.lastCarry, 150000);
  const snapshot = remittanceSnapshot(state, admin, operators, now);
  assert.equal(snapshot.cashSessions.find((cash) => cash.id === box.id)?.movements.length, 3);
  assert.equal(snapshot.operatorNames[admin.id], admin.name);
  assert.equal(snapshot.operatorNames[cashier.id], cashier.name);
});

test("withdrawals enforce permissions, own box, open business date, positive integer money and sufficient funds", () => {
  const state = seed();
  const box = openRemittanceCash(state, admin, { operatorId: cashier.id, currency: "USD", openingAmount: 10000 }, operators, now);
  const euro = openRemittanceCash(state, admin, { operatorId: cashier.id, currency: "EUR", openingAmount: 5000 }, operators, now);
  const input = { amount: 100, note: "Encargado: devolución" };
  assert.throws(() => withdrawRemittanceCash(state, other, box.id, input, now), code("FORBIDDEN"));
  const withoutClosing: User = { ...cashier, access: effectiveAccess("cashier", { permissionMode: "custom", permissionIds: [1, 2],
    remittancePermissions: ["remittances.cash.view", "remittances.cash.open"] }) };
  assert.throws(() => withdrawRemittanceCash(state, withoutClosing, box.id, input, now), code("FORBIDDEN"));
  assert.throws(() => withdrawRemittanceCash(state, cashier, box.id, input, tomorrow), code("CASH_NOT_OPEN"));
  assert.throws(() => withdrawRemittanceCash(state, cashier, "missing", input, now), code("CASH_NOT_FOUND"));
  for (const amount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => withdrawRemittanceCash(state, cashier, box.id, { ...input, amount }, now), code("INVALID_AMOUNT"));
  assert.throws(() => withdrawRemittanceCash(state, cashier, box.id, { ...input, amount: 10001 }, now), code("INSUFFICIENT_CASH"));
  assert.throws(() => withdrawRemittanceCash(state, cashier, box.id, { ...input, note: "  " }, now), code("REASON_REQUIRED"));
  assert.equal(state.remittances.cashMovements?.length ?? 0, 0, "rejections create no ledger entry");
  withdrawRemittanceCash(state, admin, box.id, { ...input, amount: 10000 }, now);
  assert.equal(cashBalance(state, state.remittances.cashSessions.find((cash) => cash.id === euro.id)!).expected, 5000, "currencies stay separate");
  closeRemittanceCash(state, cashier, box.id, 0, now);
  assert.throws(() => withdrawRemittanceCash(state, cashier, box.id, input, now), code("CASH_CLOSED"));
});

async function exerciseApi(store: Store) {
  const app = await buildApp({ store, demo: true, secret: "synthetic-cash-withdrawal-secret-32", origins: [] });
  try {
    const logged = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin", password: "Demo-CyP-2026!" } });
    assert.equal(logged.statusCode, 200, logged.body);
    const token = logged.json().token as string;
    const post = (url: string, payload: unknown, key = randomUUID(), auth = token) => app.inject({ method: "POST", url, payload,
      headers: { authorization: `Bearer ${auth}`, "idempotency-key": key } });
    const created = await post("/api/usuarios", { role: "cashier", name: "Operador de prueba de caja", email: `caja-${randomUUID()}@example.invalid`, password: "Prueba-Caja-2026!" });
    assert.equal(created.statusCode, 200, created.body);
    const account = created.json();
    const opened = await post("/api/envios/cajas/abrir", { operatorId: account.id, currency: "DOP", openingAmount: 10000 });
    assert.equal(opened.statusCode, 200, opened.body);
    const box = opened.json();
    const path = `/api/envios/cajas/${box.id}/retiros`;
    for (const amount of ["100", "1e2", "1; DROP TABLE users", -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const rejected = await post(path, { amount, note: "Prueba" });
      assert.equal(rejected.statusCode, 400, rejected.body);
    }
    assert.equal((await post(path, { amount: 100, note: "" })).statusCode, 400);
    assert.equal((await post(path, { amount: 100, note: "x", currency: "USD" })).statusCode, 400, "currency comes from the box, not a caller override");
    const addKey = randomUUID();
    for (let retry = 0; retry < 2; retry++) assert.equal((await post(`/api/envios/cajas/${box.id}/entregas`, { amount: 2000 }, addKey)).statusCode, 200);
    const key = randomUUID();
    for (let retry = 0; retry < 2; retry++) {
      const saved = await post(path, { amount: 3000, note: "Encargado: reducir efectivo" }, key);
      assert.equal(saved.statusCode, 200, saved.body); assert.equal(saved.json().withdrawn, 3000); assert.equal(saved.json().expected, 9000);
    }
    const results = await Promise.all([post(path, { amount: 5000, note: "Primer encargado" }), post(path, { amount: 5000, note: "Segundo encargado" })]);
    assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 409], "concurrent withdrawals cannot spend the same remaining cash");
    const closed = await post(`/api/envios/cajas/${box.id}/cerrar`, { countedAmount: 4000, dischargedAmount: 1000 });
    assert.equal(closed.statusCode, 200, closed.body); assert.equal(closed.json().carry, 3000);
    const read = await store.read();
    assert.deepEqual(read.remittances.cashMovements?.filter((movement) => movement.cashSessionId === box.id).map(({ type, amount }) => [type, amount]).sort(),
      [["addition", 2000], ["discharge", 1000], ["withdrawal", 3000], ["withdrawal", 5000]].sort());
    return { id: box.id, operatorId: account.id };
  } finally { await app.close(); }
}

test("cash API validates amounts, persists each movement once and serializes concurrent withdrawals", async () => {
  await exerciseApi(new MemoryStore(seed()));
});

test("PostgreSQL persists withdrawals, the closed count and carry without modifying historical discharges", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const store = new PostgresStore(process.env.TEST_DATABASE_URL!);
  const { id } = await exerciseApi(store);
  const readOnly = new PostgresStore(process.env.TEST_DATABASE_URL!);
  try {
    const read = await readOnly.read();
    const box = read.remittances.cashSessions.find((cash) => cash.id === id)!;
    assert.equal(cashBalance(read, box).withdrawn, 8000);
    assert.equal(cashBalance(read, box).discharged, 1000);
    assert.equal(box.countedAmount, 4000);
    assert.equal(remittanceOpeningCarry(read, box.operatorId, "DOP", businessDate(new Date(Date.now() + 86400000)))?.amount, 3000);
  } finally { await readOnly.close(); }
});
