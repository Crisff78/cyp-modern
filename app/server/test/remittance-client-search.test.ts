import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { seed } from "../src/seed.js";
import { MemoryStore } from "../src/store.js";
import { searchRemittanceClients } from "../src/remittance-client-search.js";
import type { User } from "../src/domain.js";

const admin: User = { id: "demo-admin", name: "Synthetic administrator", role: "admin" };
const collector: User = { id: "demo-collector", name: "Synthetic collector", role: "collector", collectorId: "col-1" };
function fixture() {
  const state = seed();
  state.clients = [
    { id: "sender", code: "SYN-1", name: "José sintético", phone: "", cellular: "", note: "Contacto: +509 (41)23-4567. Nota privada sintética.", routeId: state.routes[0].id, address: "", active: true },
    { id: "recipient", code: "SYN-2", name: "Destinatario sintético", phone: "+509 4123 4567", cellular: "", note: "Nota privada distinta", routeId: state.routes[1].id, address: "", active: true },
    { id: "cellular", code: "SYN-3", name: "Celular sintético", phone: "", cellular: "+509 4123 4567", routeId: state.routes[0].id, address: "", active: true },
    { id: "inactive", code: "SYN-4", name: "Inactivo", phone: "+509 4123 4567", routeId: state.routes[0].id, address: "", active: false },
    { id: "separate", code: "SYN-5", name: "Separados", phone: "", note: "1234567 - 7654321; referencia 509 y factura 41234567", routeId: state.routes[0].id, address: "", active: true },
  ];
  return state;
}
test("contact search finds formatted note/phone/cellular without merging identities or exposing contacts", () => {
  const state = fixture(), before = structuredClone(state);
  for (const query of ["50941234567", "+509 (41)23-4567", "41234567"]) {
    assert.deepEqual(searchRemittanceClients(state, admin, query, "recipient", ""), { ids: ["sender", "recipient", "cellular", ...(query === "41234567" ? ["separate"] : [])], hasMore: false });
  }
  assert.deepEqual(searchRemittanceClients(state, collector, "50941234567", "sender").ids, ["sender", "cellular"]);
  assert.deepEqual(searchRemittanceClients(state, collector, "50941234567", "recipient", "sender").ids, ["recipient", "cellular"]);
  assert.deepEqual(searchRemittanceClients(state, admin, "12345677", "recipient").ids, []);
  assert.deepEqual(searchRemittanceClients(state, admin, "JOSE sintetico", "sender").ids, ["sender"]);
  assert.deepEqual(state, before);
});
test("contact search is bounded and requires an explicit result selection", () => {
  const state = fixture();
  state.clients = Array.from({ length: 105 }, (_, index) => ({ ...state.clients[0], id: `synthetic-${index}` }));
  const result = searchRemittanceClients(state, collector, "50941234567", "sender");
  assert.equal(result.ids.length, 100); assert.equal(result.hasMore, true);
  assert.deepEqual(Object.keys(result).sort(), ["hasMore", "ids"]);
});
test("contact search API authenticates, validates input, preserves scope and does not write", async () => {
  const state = fixture(), store = new MemoryStore(state);
  const app = await buildApp({ store, demo: true, secret: "synthetic-contact-search-secret-for-isolated-tests", origins: [], collectorUrl: "http://127.0.0.1:5174" });
  try {
    assert.equal((await app.inject("/api/envios/clientes/buscar?query=50941234567&side=recipient")).statusCode, 401);
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "collector@cyp.local", password: "Demo-CyP-2026!" } });
    assert.equal(login.statusCode, 200);
    const before = await store.read(); // Login creates an audited session; the searches must not mutate it.
    const headers = { authorization: `Bearer ${login.json().token}` };
    const result = await app.inject({ url: "/api/envios/clientes/buscar?query=50941234567&side=sender", headers });
    assert.equal(result.statusCode, 200); assert.deepEqual(result.json(), { ids: ["sender", "cellular"], hasMore: false });
    for (const query of ["query=&side=recipient", "query=x&side=other", `query=${"x".repeat(161)}&side=recipient`, "query=x&side=sender&extra=x"])
      assert.equal((await app.inject({ url: `/api/envios/clientes/buscar?${query}`, headers })).statusCode, 400);
    assert.deepEqual(await store.read(), before);
  } finally { await app.close(); }
});
