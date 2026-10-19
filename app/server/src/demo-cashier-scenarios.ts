import { hashPassword, type State } from "./domain.js";
import { DEMO_PASSWORD } from "./demo-credentials.js";

const MARKER = "__demo_seed__:cashier-v1";
export const DEMO_CASHIER_EMAIL = "cajero@cyp.local";

/** Add a practice Cajero login once, in demo mode only. An edited or deleted account is never restored. */
export function enrichCashierDemo(state: State, now = new Date()) {
  if (state.idempotency.some((row) => row.id === MARKER)) return;
  const at = now.toISOString();
  if (!state.accounts.some((row) => row.id === "demo-cashier" || row.email.toLowerCase() === DEMO_CASHIER_EMAIL))
    state.accounts.push({
      id: "demo-cashier", name: "Cajero de práctica", email: DEMO_CASHIER_EMAIL, role: "cashier",
      ...hashPassword(DEMO_PASSWORD), credentialVersion: 1, status: "active",
      permissionMode: "role", permissionRevision: 0, createdAt: at, updatedAt: at,
    });
  state.idempotency.push({ id: MARKER, fingerprint: "cashier-v1-additive", response: { version: 1, account: DEMO_CASHIER_EMAIL }, createdAt: at });
}
