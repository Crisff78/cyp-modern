import { StrictApiError } from "./strictApi";
import type { CommissionPolicy } from "./types";

const roundings = ["none", "normal", "up"];
const rate = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10000;
/**
 * The policy the API saved must be the one reviewed: the commission of each send, the manager's share of that
 * commission (since 29-10-2026 it may be any share, it no longer depends on the total) and the rounding.
 */
export function confirmedCommissionPolicy(value: unknown,
  expected: Pick<CommissionPolicy, "transactionCommissionBps"> & Required<Pick<CommissionPolicy, "managerShareBps" | "receiveRounding">>): CommissionPolicy {
  const policy = value as CommissionPolicy | null;
  if (!policy || typeof policy !== "object" || Array.isArray(policy) ||
      typeof policy.revision !== "string" || !policy.revision || policy.revision !== policy.revision.trim() || policy.revision.length > 80 ||
      ![policy.transactionCommissionBps, policy.managerShareBps].every(rate) || !roundings.includes(String(policy.receiveRounding)) ||
      policy.transactionCommissionBps !== expected.transactionCommissionBps || policy.managerShareBps !== expected.managerShareBps ||
      policy.receiveRounding !== expected.receiveRounding)
    throw new StrictApiError("No pudimos confirmar la configuración guardada. Reintenta la misma operación.", 200, true);
  return policy;
}
