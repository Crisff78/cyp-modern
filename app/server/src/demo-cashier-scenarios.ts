import { hashPassword, type State } from "./domain.js";
import { DEMO_PASSWORD } from "./demo-credentials.js";

const MARKER = "__demo_seed__:cashier-v1";
export const DEMO_CASHIER_EMAIL = "cajero@cyp.local";
// The row stays in the base or file of the demo; outside demo mode the API refuses this identity
// (its login and its sessions), because its password is published.
export const DEMO_CASHIER_ID = "demo-cashier";

const MOBILE_TEST_MARKER = "__demo_seed__:mobile-test-v1";
// The account the mobile application tests with. Rardiel asked for this login and this password on 2026-11-23, knowing
// they are short and published. New passwords still need 15 characters: this one only exists as this seed.
export const DEMO_MOBILE_TEST_LOGIN = "cob";
export const DEMO_MOBILE_TEST_PASSWORD = "cob";
export const DEMO_MOBILE_TEST_ID = "demo-mobile-test";

/** The accounts whose password is published: outside demo mode the API refuses them, their login and their sessions. */
export const isPublishedDemoAccount = (id: string) => id === DEMO_CASHIER_ID || id === DEMO_MOBILE_TEST_ID;

/** Add a practice Cajero login once, in demo mode only. An edited or deleted account is never restored. */
export function enrichCashierDemo(state: State, now = new Date()) {
  if (state.idempotency.some((row) => row.id === MARKER)) return;
  const at = now.toISOString();
  if (!state.accounts.some((row) => row.id === DEMO_CASHIER_ID || row.email.toLowerCase() === DEMO_CASHIER_EMAIL))
    state.accounts.push({
      id: DEMO_CASHIER_ID, name: "Cajero de práctica", email: DEMO_CASHIER_EMAIL, role: "cashier",
      ...hashPassword(DEMO_PASSWORD), credentialVersion: 1, status: "active",
      permissionMode: "role", permissionRevision: 0, createdAt: at, updatedAt: at,
    });
  state.idempotency.push({ id: MARKER, fingerprint: "cashier-v1-additive", response: { version: 1, account: DEMO_CASHIER_EMAIL }, createdAt: at });
}

/** Add the mobile test login once, in the public demo only. An account with that login, edited or deleted, is left as it is. */
export function enrichMobileTestDemo(state: State, now = new Date()) {
  if (state.idempotency.some((row) => row.id === MOBILE_TEST_MARKER)) return;
  const at = now.toISOString();
  if (!state.accounts.some((row) => row.id === DEMO_MOBILE_TEST_ID || row.email.toLowerCase() === DEMO_MOBILE_TEST_LOGIN))
    state.accounts.push({
      id: DEMO_MOBILE_TEST_ID, name: "Usuario de pruebas (cob)", email: DEMO_MOBILE_TEST_LOGIN, role: "cashier",
      ...hashPassword(DEMO_MOBILE_TEST_PASSWORD), credentialVersion: 1, status: "active",
      permissionMode: "role", permissionRevision: 0, createdAt: at, updatedAt: at,
    });
  state.idempotency.push({ id: MOBILE_TEST_MARKER, fingerprint: "mobile-test-v1-additive", response: { version: 1, account: DEMO_MOBILE_TEST_LOGIN }, createdAt: at });
}
