import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "../src/store.js";
import { emptyState } from "../src/domain.js";
import { ACCOUNT_ROLES, isCollectorAccountRole } from "../src/account-roles.js";
import { canOpenPage, effectiveAccess } from "../../shared/access.mjs";

// The Usuario role gave way to Cliente (2026-10-20): Cliente has no access for now, and the accounts
// saved as Usuario attend remittances as Cajero.
test("Cliente replaces Usuario: a valid role without access that is never a collector account", () => {
  assert.deepEqual(ACCOUNT_ROLES, ["undefined", "admin", "supervisor", "collector", "client", "cashier"]);
  assert.deepEqual(effectiveAccess("client"), { mode: "role", revision: 0, legacy: [], remittances: [] });
  assert.equal(isCollectorAccountRole("client"), false);
  for (const page of ["remittances", "remittancePayouts", "dailySettlements", "clients", "controlPanel"])
    assert.equal(canOpenPage({ role: "client" }, page), false, page);
});

test("a demo file saved with Usuario accounts opens them as Cajero, sessions included", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "cyp-client-role-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "state.json");
  const account = { id: "desk-1", name: "Cuenta de escritorio", email: "desk@example.invalid", role: "user", status: "active" };
  const other = { id: "sup-1", name: "Supervisión", email: "sup@example.invalid", role: "supervisor", status: "active" };
  const session = { id: "s-1", userId: "desk-1", userName: "Cuenta de escritorio", role: "user", startedAt: "2026-10-20T12:00:00.000Z", expiresAt: "2026-10-21T12:00:00.000Z" };
  await writeFile(path, JSON.stringify({ ...emptyState(), accounts: [account, other], adminTools: { sessions: [session] } }));
  const store = await FileStore.open(path, emptyState());
  const state = await store.read() as Awaited<ReturnType<FileStore["read"]>> & { adminTools?: { sessions: { role: string }[] } };
  assert.deepEqual(state.accounts.map(({ id, role }) => [id, role]), [["desk-1", "cashier"], ["sup-1", "supervisor"]]);
  assert.deepEqual(state.adminTools?.sessions.map(({ role }) => role), ["cashier"]);
  // The converted state is also what the file keeps.
  assert.equal(JSON.parse(await readFile(path, "utf8")).accounts[0].role, "cashier");
});
