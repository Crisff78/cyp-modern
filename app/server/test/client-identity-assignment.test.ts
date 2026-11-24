import assert from "node:assert/strict";
import test from "node:test";
import { assignMissingClientIdentities, reserveClientIdentity } from "../src/client-identities.js";
import type { User } from "../src/domain.js";
import { seed } from "../src/seed.js";

// The internal identification is the short idCliente of the text protocol (version 0.6). Synthetic data only.
const admin: User = { id: "demo-admin", name: "Administración", role: "admin" };

test("every client without an internal identification gets its own, once, and the one that had it keeps it", () => {
  const state = seed();
  state.clients[0].internalIdentification = "INT00000007";
  const codes = state.clients.map((row) => row.code);
  assignMissingClientIdentities(state, admin);
  const given = state.clients.map((row) => row.internalIdentification ?? "");
  assert.ok(given.every((value) => /^INT\d{8}$/.test(value)), given.join(" "));
  assert.equal(new Set(given).size, given.length);
  assert.equal(given[0], "INT00000007");
  assert.ok(given.slice(1).every((value) => Number(value.slice(3)) > 7), "after the highest one in use");
  // Each one by its own reservation, without a generated code: no code of a client is touched or locked.
  assert.equal(state.clientIdentityReservations.length, state.clients.length - 1);
  assert.ok(state.clientIdentityReservations.every((row) => row.actorId === admin.id && row.code === row.internalIdentification &&
    state.clients.some((client) => client.id === row.clientId && client.internalIdentification === row.internalIdentification)));
  assert.deepEqual(state.clients.map((row) => row.code), codes);
  const before = structuredClone(state);
  assignMissingClientIdentities(state, admin);
  assert.deepEqual(state, before, "a second start changes nothing");
});

test("a new internal identification never repeats the id of a client", () => {
  const state = seed();
  state.clients.push({ ...state.clients[0], id: "INT00000001", code: "SINT-1" });
  assert.equal(reserveClientIdentity(state, admin).internalIdentification, "INT00000002");
});
