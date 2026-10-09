import { StrictApiError } from "./strictApi";
import type { CommissionPolicy } from "./types";

export function confirmedCommissionPolicy(value: unknown,
  expected: Pick<CommissionPolicy, "transactionCommissionBps" | "managerCommissionBps">): CommissionPolicy {
  const policy = value as CommissionPolicy | null;
  if (!policy || typeof policy !== "object" || Array.isArray(policy) ||
      typeof policy.revision !== "string" || !policy.revision || policy.revision !== policy.revision.trim() || policy.revision.length > 80 ||
      ![policy.transactionCommissionBps, policy.managerCommissionBps].every((rate) => Number.isInteger(rate) && rate >= 0 && rate <= 10000) ||
      policy.transactionCommissionBps !== expected.transactionCommissionBps || policy.managerCommissionBps !== expected.managerCommissionBps ||
      policy.managerCommissionBps > policy.transactionCommissionBps)
    throw new StrictApiError("No pudimos confirmar la configuración guardada. Reintenta la misma operación.", 200, true);
  return policy;
}
