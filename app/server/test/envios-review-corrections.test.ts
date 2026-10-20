import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { DEMO_PASSWORD } from "../src/demo-credentials.js";
import { DEMO_CASHIER_EMAIL, enrichCashierDemo } from "../src/demo-cashier-scenarios.js";
import { seed } from "../src/seed.js";
import { MemoryStore } from "../src/store.js";
import { roleRemittancePermissions, rolePermissionIds } from "../../shared/access.mjs";

// Corrections of the review of the Envíos and Cajero branch: names of the operators of what each account sees,
// the practice Cajero outside demo mode and the saved references of permissions. Synthetic accounts and data only.
const password = "Clave-ficticia-revision-envios-2026!";
const configured = { adminEmail: "principal@example.invalid", adminPassword: "Principal-ficticia-2026!" };
const secret = "synthetic-envios-review-corrections-secret-32";
type Reply = { statusCode: number; body: string; json(): any };
const cashierKeys = roleRemittancePermissions("cashier");
const sorted = (values: readonly string[]) => [...values].sort();

async function setup(t: TestContext, store = new MemoryStore(seed()), demo = true) {
  const app = await buildApp({ store, secret, origins: [], collectorUrl: "http://localhost:5174", ...(demo ? { demo: true } : { demo: false, ...configured }) });
  t.after(() => app.close());
  // Each request comes from its own synthetic address so the login rate limit does not interfere.
  let address = 0;
  const remoteAddress = () => { address += 1; return `10.44.${Math.floor(address / 250)}.${address % 250 + 1}`; };
  const get = (url: string, token: string): Promise<Reply> => app.inject({ url, remoteAddress: remoteAddress(), headers: { authorization: `Bearer ${token}` } });
  const post = (url: string, payload: object, token: string): Promise<Reply> => app.inject({ method: "POST", url, payload,
    remoteAddress: remoteAddress(), headers: { authorization: `Bearer ${token}`, "idempotency-key": randomUUID() } });
  const signIn = (email: string, secret = password): Promise<Reply> => app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: remoteAddress(), payload: { email, password: secret } });
  const login = async (email: string, secret = password) => { const reply = await signIn(email, secret); assert.equal(reply.statusCode, 200, reply.body); return reply.json().token as string; };
  const admin = demo ? await login("admin@cyp.local", DEMO_PASSWORD) : await login(configured.adminEmail, configured.adminPassword);
  const account = async (role: string, name = `Cuenta ${role} sintética`) => {
    const email = `${role}-${randomUUID()}@example.invalid`;
    const reply = await post("/api/usuarios", { name, email, role, password }, admin);
    assert.equal(reply.statusCode, 200, reply.body);
    return { ...(reply.json() as { id: string; name: string; role: string }), email, token: await login(email) };
  };
  const permissions = async (id: string) => (await get(`/api/usuarios/${id}/permisos`, admin)).json();
  const savePermissions = async (id: string, body: Record<string, unknown>) => {
    const reply = await post(`/api/usuarios/${id}/permisos`, { ...body, revision: (await permissions(id)).revision }, admin);
    assert.equal(reply.statusCode, 200, reply.body); return reply.json();
  };
  const openCash = (operatorId: string, token: string, openingAmount = 0) => post("/api/envios/cajas/abrir", { operatorId, currency: "DOP", openingAmount }, token);
  const send = async (token: string, senderClientId: string, recipientClientId: string) => {
    const quoted = await get("/api/envios/cotizacion?sourceCurrency=DOP&destinationCurrency=DOP&amount=10000", token);
    assert.equal(quoted.statusCode, 200, quoted.body);
    const { sourceCurrency, destinationCurrency, amount, quote } = quoted.json();
    const reply = await post("/api/envios", { sourceCurrency, destinationCurrency, amount, quote, senderClientId, recipientClientId }, token);
    assert.equal(reply.statusCode, 200, reply.body); return reply.json() as { id: string };
  };
  return { app, admin, get, post, signIn, login, account, permissions, savePermissions, openCash, send };
}

test("the snapshot names every operator of the operations, boxes and reports each account sees, also disabled ones, and no other", async (t) => {
  const { admin, get, post, account, openCash, send } = await setup(t);
  const ana = await account("cashier", "Cajera Ana"), beto = await account("cashier", "Cajero Beto");
  // Beto starts with cash to pay out.
  for (const [desk, cash] of [[ana, 0], [beto, 100_000]] as const) assert.equal((await openCash(desk.id, desk.token, cash)).statusCode, 200);
  const transfer = await send(ana.token, "cli-1", "cli-2");
  // Beto pays a receipt of Ana from «Entregas de dinero»: its detail and its printed receipt name both operators.
  assert.equal((await post(`/api/envios/${transfer.id}/pagar`, {}, beto.token)).statusCode, 200);
  const desk = (await get("/api/envios/snapshot", beto.token)).json();
  const paid = desk.transfers.find((row: { id: string }) => row.id === transfer.id);
  assert.deepEqual([paid.sendingUserId, paid.registeredBy, paid.paidBy], [ana.id, ana.id, beto.id]);
  assert.deepEqual(desk.operatorNames, { [ana.id]: "Cajera Ana", [beto.id]: "Cajero Beto" });
  assert.deepEqual(desk.operators.map(({ id }: { id: string }) => id), [beto.id], "naming an operator never offers it as a choice");

  // Supervision reads every operation and box without choosing operators: it still sees whose box each one is.
  const supervisor = await account("supervisor");
  const supervised = (await get("/api/envios/snapshot", supervisor.token)).json();
  assert.deepEqual(supervised.operators, []);
  const date = supervised.businessDate, report = (await get(`/api/envios/reportes?from=${date}&to=${date}`, supervisor.token)).json();
  const shown = [...supervised.transfers.flatMap((row: any) => [row.sendingUserId, row.registeredBy, row.paidBy]), ...supervised.cashSessions.map((row: any) => row.operatorId),
    ...report.cashSummary.map((row: any) => row.operatorId), ...report.commissions.details.map((row: any) => row.sendingUserId)];
  assert.ok(shown.length >= 6);
  assert.deepEqual([...new Set(shown)].sort().map((id) => supervised.operatorNames[id]), [ana.id, beto.id].sort().map((id) => id === ana.id ? "Cajera Ana" : "Cajero Beto"));
  // Only an id and a name: no role, access or route travels with it.
  assert.ok(Object.values(supervised.operatorNames).every((name) => typeof name === "string"));

  // A disabled account leaves the operators administration may choose, but its boxes keep its name.
  assert.equal((await post(`/api/usuarios/${ana.id}/estado`, { status: "disabled" }, admin)).statusCode, 200);
  const administered = (await get("/api/envios/snapshot", admin)).json();
  assert.equal(administered.operators.some(({ id }: { id: string }) => id === ana.id), false);
  assert.equal(administered.operatorNames[ana.id], "Cajera Ana");

  // A desk that does not see the operation does not learn its operators.
  const carla = await account("cashier", "Cajera Carla");
  assert.deepEqual((await get("/api/envios/snapshot", carla.token)).json().operatorNames, {});
});

test("the practice Cajero saved by a start in demo mode is refused outside demo mode, in its login and in its sessions", async (t) => {
  const state = seed();
  enrichCashierDemo(state);
  const store = new MemoryStore(state);
  const demo = await setup(t, store);
  const practice = await demo.login(DEMO_CASHIER_EMAIL, DEMO_PASSWORD);
  assert.equal((await demo.get("/api/auth/me", practice)).statusCode, 200);
  await demo.app.close();
  // The same base, now started with configured credentials.
  const real = await setup(t, store, false);
  const refused = await real.signIn(DEMO_CASHIER_EMAIL, DEMO_PASSWORD);
  assert.deepEqual([refused.statusCode, refused.json().error?.code], [401, "INVALID_CREDENTIALS"]);
  for (const url of ["/api/auth/me", "/api/envios/snapshot"]) assert.equal((await real.get(url, practice)).statusCode, 401, `${url} with the session opened in demo mode`);
  assert.equal((await real.post("/api/envios/cajas/abrir", { operatorId: "demo-cashier", currency: "DOP", openingAmount: 0 }, practice)).statusCode, 401);
  // Every other saved account keeps working there.
  const own = await real.account("cashier", "Cajera real");
  assert.equal((await real.get("/api/auth/me", own.token)).statusCode, 200);
});

test("«Perfil del rol» keeps the personalized keys of Envíos as a reference that can be adopted again", async (t) => {
  const { get, account, permissions, savePermissions } = await setup(t);
  const access = async (token: string) => (await get("/api/auth/me", token)).json().access;
  // A Cajero with the reports of its operations granted by hand, then returned to its role profile as the dialog
  // does: the saved lists go back unchanged, only the mode changes.
  const cashier = await account("cashier");
  const personalized = sorted([...cashierKeys, "remittances.reports"]);
  await savePermissions(cashier.id, { mode: "custom", permissionIds: [1, 2], remittancePermissions: personalized });
  const reference = await savePermissions(cashier.id, { mode: "role", permissionIds: [1, 2], remittancePermissions: personalized });
  assert.deepEqual([reference.mode, sorted(reference.remittancePermissions)], ["role", personalized]);
  assert.deepEqual(sorted((await access(cashier.token)).remittances), sorted(cashierKeys), "the role profile is what applies");
  // A save without the keys (the previous contract) keeps the reference too.
  await savePermissions(cashier.id, { mode: "role", permissionIds: [1, 2] });
  assert.deepEqual(sorted((await permissions(cashier.id)).remittancePermissions), personalized);
  // Adopting it again applies the reports.
  const kept = await permissions(cashier.id);
  await savePermissions(cashier.id, { mode: "custom", permissionIds: kept.permissionIds, remittancePermissions: kept.remittancePermissions });
  assert.equal((await access(cashier.token)).remittances.includes("remittances.reports"), true);

  // A Usuaria has no keys on its role profile: adopting its earlier selection gives back its access to the panel.
  const desk = await account("user");
  const keys = sorted(["remittances.view", "remittances.receipts"]);
  await savePermissions(desk.id, { mode: "custom", permissionIds: [1, 2], remittancePermissions: keys });
  await savePermissions(desk.id, { mode: "role", permissionIds: [1, 2], remittancePermissions: keys });
  assert.deepEqual((await access(desk.token)).remittances, [], "nothing applies on the role profile of Usuario");
  const earlier = await permissions(desk.id);
  assert.deepEqual([earlier.mode, earlier.permissionIds, sorted(earlier.remittancePermissions)], ["role", [1, 2], keys]);
  await savePermissions(desk.id, { mode: "custom", permissionIds: earlier.permissionIds, remittancePermissions: earlier.remittancePermissions });
  assert.deepEqual(sorted((await access(desk.token)).remittances), keys);

  // An account that never kept keys of its own still reads the keys of its role profile.
  const plain = await account("cashier");
  assert.deepEqual(sorted((await permissions(plain.id)).remittancePermissions), sorted(cashierKeys));
});

test("a role change drops a saved copy of the old role profile, so it is never shown as an earlier selection", async (t) => {
  const { admin, post, account, permissions, savePermissions } = await setup(t);
  const edit = (row: { id: string; name: string; email: string }, role: string) => post(`/api/usuarios/${row.id}`, { name: row.name, email: row.email, role }, admin);
  // The first save with «Perfil del rol» stores the profile the dialog read as the account's lists.
  const supervisor = await account("supervisor");
  await savePermissions(supervisor.id, { mode: "role", permissionIds: rolePermissionIds("supervisor"), remittancePermissions: roleRemittancePermissions("supervisor") });
  assert.equal((await edit(supervisor, "cashier")).statusCode, 200);
  const promoted = await permissions(supervisor.id);
  assert.deepEqual([promoted.mode, promoted.permissionIds, sorted(promoted.remittancePermissions)], ["role", [1, 2], sorted(cashierKeys)]);
  // A list that is not the old profile (for example one kept by the 034 migration) is a real earlier selection.
  const migrated = await account("user");
  await savePermissions(migrated.id, { mode: "role", permissionIds: [2, 140, 501], remittancePermissions: ["remittances.view"] });
  assert.equal((await edit(migrated, "supervisor")).statusCode, 200);
  const kept = await permissions(migrated.id);
  assert.deepEqual([kept.permissionIds, kept.remittancePermissions], [[2, 140, 501], ["remittances.view"]]);
  // A personalized account keeps the selection that applies.
  const custom = await account("cashier");
  await savePermissions(custom.id, { mode: "custom", permissionIds: [1, 2], remittancePermissions: ["remittances.view"] });
  assert.equal((await edit(custom, "user")).statusCode, 200);
  const applied = await permissions(custom.id);
  assert.deepEqual([applied.mode, applied.permissionIds, applied.remittancePermissions], ["custom", [1, 2], ["remittances.view"]]);
});
