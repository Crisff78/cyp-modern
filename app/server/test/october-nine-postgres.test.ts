import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { businessDate, type User } from "../src/domain.js";
import { reserveClientIdentity } from "../src/client-identities.js";
import { createRemittance, openRemittanceCash, quoteRemittance } from "../src/remittances.js";
import { seed } from "../src/seed.js";
import { PostgresStore } from "../src/store.js";

test("PostgreSQL 001–029 preserve new contracts, serialized reservations and immutable financial snapshots", {
  skip: !process.env.CYP_OCTOBER_NINE_TEST_DATABASE_URL,
}, async () => {
  const target = new URL(process.env.CYP_OCTOBER_NINE_TEST_DATABASE_URL!);
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55435");
  assert.equal(target.pathname, "/cyp_october_nine_test"); assert.equal(target.username, "october_nine_qa");
  const sql = new pg.Client({ connectionString: target.toString() }); await sql.connect();
  const store = new PostgresStore(target.toString()), parallel = new PostgresStore(target.toString());
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const admin: User = { id: "demo-admin", name: "Administración ficticia", role: "admin" }, now = new Date();
  try {
    const server = (await sql.query("SELECT current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,current_setting('port') AS port")).rows[0];
    assert.deepEqual(server, { database: "cyp_october_nine_test", role: "october_nine_qa", host: "127.0.0.1", port: "55435" });
    const directory = new URL("../database/", import.meta.url);
    const files = (await readdir(directory)).filter((file) => /^\d{3}_.+\.sql$/.test(file) && Number(file.slice(0, 3)) <= 29).sort();
    assert.equal(files.length, 29);
    const migrations = (await sql.query("SELECT name,sha256 FROM cyp_schema_migrations ORDER BY name")).rows;
    assert.equal(migrations.length, 29);
    for (const file of files) assert.equal(migrations.find((row) => row.name === file)?.sha256,
      createHash("sha256").update(await readFile(new URL(file, directory), "utf8")).digest("hex"), file);
    await store.transaction((state) => { if (!state.clients.length) Object.assign(state, seed()); });
    app = await buildApp({ store, secret: "fictional-isolated-postgres-october-nine-secret", demo: true, origins: [], collectorUrl: "http://localhost:5174" });
    const login = (password = "Demo-CyP-2026!") => app!.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin", password } });
    const token = (await login()).json().token as string;
    const post = (url: string, payload: unknown, key = randomUUID()) => app!.inject({ method: "POST", url, payload,
      headers: { authorization: `Bearer ${token}`, "idempotency-key": key } });

    const reservations = await Promise.all([store.transaction((state) => reserveClientIdentity(state, admin)),
      parallel.transaction((state) => reserveClientIdentity(state, admin))]);
    assert.notEqual(reservations[0].sequence, reservations[1].sequence);
    assert.notEqual(reservations[0].internalIdentification, reservations[1].internalIdentification);
    const key = randomUUID(), body = { name: "Persona PostgreSQL ficticia", code: `MANUAL-${randomUUID()}`, routeId: "route-1",
      identification: `LEGAL-FICTICIO-${randomUUID()}`, reservationId: reservations[0].id };
    const created = await post("/api/clientes", body, key); assert.equal(created.statusCode, 200, created.body);
    assert.deepEqual((await post("/api/clientes", body, key)).json(), created.json());
    const reopenedClient = (await parallel.read()).clients.find((row) => row.id === created.json().id)!;
    assert.equal(reopenedClient.internalIdentification, reservations[0].internalIdentification);
    assert.equal(reopenedClient.identification, body.identification); assert.equal(reopenedClient.code, body.code);
    await assert.rejects(sql.query("UPDATE clients SET internal_identification='INT99999999' WHERE id=$1", [reopenedClient.id]), /immutable/);
    await assert.rejects(sql.query("UPDATE client_identity_reservations SET code='FORGED' WHERE id=$1", [reservations[0].id]), /immutable/);
    await assert.rejects(sql.query("DELETE FROM client_identity_reservations WHERE id=$1", [reservations[1].id]), /cannot be deleted/);

    const bank = (await post("/api/bancos", { name: `Banco ficticio ${randomUUID()}`, active: true })).json();
    const collectionKey = randomUUID(), collectionBody = { clientId: "cli-1", collectorId: "col-1", currency: "DOP",
      lines: [{ chargeId: "chg-1", amount: 123 }], bankId: bank.id, reference: "REFERENCIA-FICTICIA", note: "Nota ficticia de cobro" };
    const collected = await post("/api/cobros/central", collectionBody, collectionKey); assert.equal(collected.statusCode, 200, collected.body);
    const movement = collected.json().movements[0];
    await post(`/api/bancos/${bank.id}`, { name: `Banco renombrado ${randomUUID()}`, active: false });
    assert.deepEqual((await post("/api/cobros/central", collectionBody, collectionKey)).json(), collected.json());
    const reopenedMovement = (await parallel.read()).movements.find((row) => row.id === movement.id)!;
    assert.equal(reopenedMovement.bankId, bank.id); assert.equal(reopenedMovement.bankName, bank.name);
    assert.equal(reopenedMovement.reference, collectionBody.reference); assert.equal(reopenedMovement.note, collectionBody.note);
    assert.equal(reopenedMovement.amount, 123);
    await assert.rejects(sql.query("UPDATE collections SET bank_reference='FORGED' WHERE id=$1", [movement.id]), /immutable/);

    const date = businessDate(now), rateBody = { currency: "USD", date, rate: "60", purchaseRate: "58", saleRate: "62" };
    const rate = await post("/api/envios/tasas", rateBody); assert.equal(rate.statusCode, 200, rate.body);
    const rateRead = await parallel.read(), currentRate = rateRead.remittances.rates.find((row) => row.currency === "USD" && row.date === date)!;
    assert.equal(currentRate.purchaseRate, "58.000000"); assert.equal(currentRate.saleRate, "62.000000");
    assert.equal(quoteRemittance(rateRead, { sourceCurrency: "USD", destinationCurrency: "DOP", amount: 1000 }, now).receiveAmount, 60000);
    const history = rateRead.remittances.rateHistory!.find((row) => row.id === currentRate.changeId)!;
    assert.equal(history.purchaseRate, "58.000000"); assert.equal(history.saleRate, "62.000000");
    await assert.rejects(sql.query("UPDATE remittance_rate_history SET sale_rate=63 WHERE id=$1", [history.id]), /append-only/);
    await assert.rejects(sql.query("UPDATE exchange_rates SET purchase_rate=NULL WHERE currency='USD' AND effective_date=$1", [date]), /exchange_rates_commercial_pair/);

    const remittance = await store.transaction((state) => {
      openRemittanceCash(state, admin, { operatorId: admin.id, currency: "USD", openingAmount: 0 }, [], now);
      const quoted = quoteRemittance(state, { sourceCurrency: "USD", destinationCurrency: "DOP", amount: 1000 }, now);
      return createRemittance(state, admin, { sourceCurrency: "USD", destinationCurrency: "DOP", amount: 1000,
        senderClientId: reopenedClient.id, recipientClientId: "cli-5", quote: quoted.quote }, [], now);
    });
    assert.equal((await parallel.read()).remittances.transfers.find((row) => row.id === remittance.id)?.senderContact?.identification, body.identification);
    await store.transaction((state) => { state.clients.find((row) => row.id === reopenedClient.id)!.identification = "DOCUMENTO-POSTERIOR-FICTICIO"; });
    assert.equal((await parallel.read()).remittances.transfers.find((row) => row.id === remittance.id)?.senderContact?.identification, body.identification);

    const changed = await post("/api/usuarios/demo-admin/clave", { currentPassword: "Demo-CyP-2026!", password: "Nuevo-ficticio" });
    assert.equal(changed.statusCode, 200, changed.body);
    const persistedAccount = (await parallel.read()).accounts.find((row) => row.id === "demo-admin")!;
    assert.equal(persistedAccount.credentialVersion, 1); assert.notEqual(persistedAccount.passwordHash, "Nuevo-ficticio");
    assert.equal((await login()).statusCode, 401); assert.equal((await login("Nuevo-ficticio")).statusCode, 200);
    assert.equal((await app.inject({ url: "/api/auth/me", headers: { authorization: `Bearer ${token}` } })).statusCode, 401);
  } finally { if (app) await app.close(); else await store.close(); await sql.end(); await parallel.close(); }
});
