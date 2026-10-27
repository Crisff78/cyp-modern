import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { DEMO_PASSWORD } from "../src/demo-credentials.js";
import { seed } from "../src/seed.js";
import { MemoryStore } from "../src/store.js";
import { CLIENT_PAGE_SIZE, NOT_DEFINED, NOT_DEFINED_ROUTE, pageClients } from "../../shared/clientPage.mjs";

// Dionel (26-10): the Clientes window asks the server for one page with its own filters; «Todos» is paged too.
type Reply = { statusCode: number; body: string; json(): any };
type Page = { items: { id: string; name: string; routeId: string; sector?: string; active?: boolean }[]; total: number; limit: number; offset: number; zones: string[] };

async function setup(t: TestContext) {
  const state = seed();
  // 112 synthetic clients on top of the 8 of the seed: every fifth without a zone, every seventh inactive.
  for (let index = 1; index <= 112; index++) state.clients.push({
    id: `qa-page-${String(index).padStart(3, "0")}`, name: index === 7 ? "José Peña página" : `Cliente página ${index}`,
    code: `QA-P-${index}`, phone: `80955${String(index).padStart(5, "0")}`, address: "Calle ficticia", routeId: index % 2 ? "route-1" : "route-2",
    sector: index % 5 ? "Distrito Nacional" : "", active: index % 7 !== 0, ...(index === 9 ? { identification: "001-7654321-9" } : {}),
  } as (typeof state.clients)[number]);
  // A client whose route is not in the catalog never reaches the general view, nor this page.
  state.clients.push({ id: "qa-orphan", name: "Cliente sin ruta válida", code: "QA-ORPHAN", phone: "8095559999", address: "Calle ficticia", routeId: "route-missing" } as (typeof state.clients)[number]);
  const store = new MemoryStore(state);
  const app = await buildApp({ store, demo: true, secret: "synthetic-client-page-secret-at-least-32-chars", origins: [], collectorUrl: "http://localhost:5174" });
  t.after(() => app.close());
  let address = 0;
  const remoteAddress = () => { address += 1; return `10.43.${Math.floor(address / 250)}.${address % 250 + 1}`; };
  const login = async (email: string, password = DEMO_PASSWORD) => {
    const reply = await app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: remoteAddress(), payload: { email, password } });
    assert.equal(reply.statusCode, 200, reply.body);
    return reply.json().token as string;
  };
  const admin = await login("admin@cyp.local");
  const get = (query: string, token = admin): Promise<Reply> => app.inject({ url: `/api/clientes/pagina${query}`, remoteAddress: remoteAddress(), headers: { authorization: `Bearer ${token}` } });
  const page = async (query: string, token = admin) => { const reply = await get(query, token); assert.equal(reply.statusCode, 200, reply.body); return reply.json() as Page; };
  const visible = state.clients.filter((client) => client.id !== "qa-orphan");
  return { app, state, visible, admin, login, get, page, remoteAddress };
}

test("«Todos» comes in pages of 50 and the first/previous/next/last offsets stay inside the list", async (t) => {
  const { visible, page } = await setup(t);
  const active = visible.filter((client) => client.active !== false);
  const first = await page("");
  assert.equal(first.limit, CLIENT_PAGE_SIZE);
  assert.equal(first.offset, 0);
  assert.equal(first.total, active.length);
  assert.equal(first.items.length, 50);
  assert.deepEqual(first.items.map(({ id }) => id), active.slice(0, 50).map(({ id }) => id));
  const second = await page("?offset=50");
  assert.deepEqual(second.items.map(({ id }) => id), active.slice(50, 100).map(({ id }) => id));
  // Past the end it answers the last page instead of an empty one.
  const last = await page("?offset=100000");
  assert.equal(last.offset, Math.floor((active.length - 1) / 50) * 50);
  assert.equal(last.items.length, active.length - last.offset);
  const everyone = await page("?status=Todos&limit=200");
  assert.equal(everyone.total, visible.length);
  assert.equal(everyone.items.length, visible.length);
  assert.equal(everyone.items.some(({ id }) => id === "qa-orphan"), false, "the page never shows clients the general view hides");
  assert.equal((await page("?status=Inactivo")).total, visible.filter((client) => client.active === false).length);
});

test("the window filters run on the server: search, identification, name, zone and route, «No Definida» included", async (t) => {
  const { visible, page } = await setup(t);
  const active = visible.filter((client) => client.active !== false);
  assert.deepEqual((await page(`?mode=name&q=${encodeURIComponent("jose pena")}&status=Todos`)).items.map(({ id }) => id), ["qa-page-007"], "accents do not matter");
  assert.deepEqual((await page("?mode=search&q=QA-P-11&status=Todos")).items.map(({ id }) => id).sort(), ["qa-page-011", "qa-page-110", "qa-page-111", "qa-page-112"]);
  assert.deepEqual((await page("?mode=search&q=8095500042&status=Todos")).items.map(({ id }) => id), ["qa-page-042"], "phone digits");
  assert.deepEqual((await page("?mode=identification&q=7654321")).items.map(({ id }) => id), ["qa-page-009"]);
  const noZone = await page(`?mode=zone&q=${encodeURIComponent(NOT_DEFINED)}`);
  assert.equal(noZone.total, active.filter((client) => !client.sector).length);
  assert.ok(noZone.total > 0);
  assert.ok(noZone.items.every((client) => !client.sector));
  assert.equal(noZone.zones[0], NOT_DEFINED);
  const route2 = await page("?mode=route&q=route-2&limit=200");
  assert.equal(route2.total, active.filter((client) => client.routeId === "route-2").length);
  assert.ok(route2.items.every((client) => client.routeId === "route-2"));
  // Every client must have a route the account can see, so «No Definida» finds none today.
  assert.equal((await page(`?mode=route&q=${NOT_DEFINED_ROUTE}&status=Todos`)).total, 0);
});

test("after saving, the page that holds the client comes back even when it is not the current one", async (t) => {
  const { visible, page } = await setup(t);
  const active = visible.filter((client) => client.active !== false);
  const target = active[75];
  const focused = await page(`?offset=0&focus=${target.id}`);
  assert.equal(focused.offset, 50);
  assert.ok(focused.items.some(({ id }) => id === target.id));
  // A client outside the filters keeps the requested page.
  assert.equal((await page(`?offset=50&status=Inactivo&focus=${target.id}`)).offset, 0);
});

test("bad parameters are rejected and the rules of who may read clients stay the same", async (t) => {
  const { get, login, app, admin, remoteAddress, visible } = await setup(t);
  for (const query of ["?limit=201", "?limit=0", "?offset=-1", "?mode=todos", "?status=Activos", "?otro=1"])
    assert.equal((await get(query)).statusCode, 400, query);
  assert.equal((await get("", "token-falso")).statusCode, 401);
  // A Cajero attends remittances only: the clients window is not his.
  const email = `cashier-${randomUUID()}@example.invalid`, password = "Clave-ficticia-cajero-2026!";
  const created = await app.inject({ method: "POST", url: "/api/usuarios", remoteAddress: remoteAddress(), headers: { authorization: `Bearer ${admin}`, "idempotency-key": randomUUID() }, payload: { name: "Cajero de página", email, role: "cashier", password } });
  assert.equal(created.statusCode, 200, created.body);
  assert.equal((await get("", await login(email, password))).statusCode, 403);
  // The collector reads only the clients of his own route, as in the general view.
  const collector = await get("?status=Todos&limit=200", await login("collector@cyp.local"));
  assert.equal(collector.statusCode, 200, collector.body);
  const own = collector.json() as Page;
  assert.ok(own.items.length > 0 && own.items.every((client) => client.routeId === "route-1"));
  assert.equal(own.total, visible.filter((client) => client.routeId === "route-1").length);
});

test("the shared page helper keeps the zone list and the order of the clients", () => {
  const clients = [
    { id: "a", name: "Ana", routeId: "r1", sector: "Norte" }, { id: "b", name: "Beto", routeId: "r2", sector: "" },
    { id: "c", name: "Cira", routeId: "gone", sector: "Sur", active: false },
  ];
  const routes = [{ id: "r1", sector: "Norte" }, { id: "r2", sector: "Este" }];
  const page = pageClients(clients, routes, { status: "Todos", limit: 2 });
  assert.deepEqual(page.items.map(({ id }) => id), ["a", "b"]);
  assert.deepEqual(page.zones, [NOT_DEFINED, "Norte", "Sur", "Este"]);
  assert.deepEqual(pageClients(clients, routes, { mode: "route", q: NOT_DEFINED_ROUTE, status: "Todos" }).items.map(({ id }) => id), ["c"]);
  assert.deepEqual(pageClients(clients, routes, { mode: "zone", q: NOT_DEFINED }).items.map(({ id }) => id), ["b"]);
  assert.equal(pageClients([], routes).offset, 0);
});

// PostgreSQL: the same page over the real store (zone stored as null, the order of the database).
test("PostgreSQL: the Clientes page reads the stored clients with their filters", { skip: !process.env.CYP_CLIENT_PAGE_TEST_DATABASE_URL }, async (t) => {
  const target = new URL(process.env.CYP_CLIENT_PAGE_TEST_DATABASE_URL!);
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.pathname, "/cyp_client_page_qa");
  const { PostgresStore } = await import("../src/store.js");
  const store = new PostgresStore(target.toString());
  await store.transaction((state) => {
    if (!state.clients.length) Object.assign(state, seed());
    for (let index = 1; index <= 60; index++) if (!state.clients.some(({ id }) => id === `qa-pg-${index}`)) state.clients.push({
      id: `qa-pg-${index}`, name: `Cliente PostgreSQL ${index}`, code: `QA-PG-${index}`, phone: "", address: "Calle ficticia",
      routeId: index % 2 ? "route-1" : "route-2", sector: index % 4 ? "Distrito Nacional" : "", active: index % 10 !== 0,
    } as (typeof state.clients)[number]);
  });
  const app = await buildApp({ store, demo: true, secret: "synthetic-client-page-postgres-secret-32-chars", origins: [], collectorUrl: "http://localhost:5174" });
  t.after(() => app.close());
  const token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin", password: DEMO_PASSWORD } })).json().token as string;
  const page = async (query: string) => { const reply = await app.inject({ url: `/api/clientes/pagina${query}`, headers: { authorization: `Bearer ${token}` } }); assert.equal(reply.statusCode, 200, reply.body); return reply.json() as Page; };
  const snapshot = (await app.inject({ url: "/api/snapshot", headers: { authorization: `Bearer ${token}` } })).json() as { clients: Page["items"] };
  const active = snapshot.clients.filter((client) => client.active !== false);
  const first = await page("");
  assert.equal(first.total, active.length);
  assert.deepEqual(first.items.map(({ id }) => id), active.slice(0, 50).map(({ id }) => id), "same order as the general view");
  const rest = await page("?offset=50");
  assert.deepEqual(rest.items.map(({ id }) => id), active.slice(50, 100).map(({ id }) => id));
  const noZone = await page(`?mode=zone&q=${encodeURIComponent(NOT_DEFINED)}&status=Todos&limit=200`);
  assert.deepEqual(noZone.items.map(({ id }) => id).sort(), snapshot.clients.filter((client) => !client.sector).map(({ id }) => id).sort());
  assert.ok(noZone.items.some(({ id }) => id === "qa-pg-4"));
  assert.equal((await page("?mode=search&q=QA-PG-60&status=Todos")).items[0]?.id, "qa-pg-60");
  assert.ok((await page("?focus=qa-pg-59")).items.some(({ id }) => id === "qa-pg-59"));
});
