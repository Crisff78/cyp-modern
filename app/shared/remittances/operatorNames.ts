import type { RemittanceSnapshot } from "./types";

type OperatorNames = Pick<RemittanceSnapshot, "operators" | "operatorNames">;

/** Name of an operator: from the operators the account may choose, then from the names of what it sees. */
export function remittanceOperatorName(snapshot: OperatorNames | null | undefined, id: string | undefined): string | undefined {
  if (!snapshot || !id) return undefined;
  const names = snapshot.operatorNames ?? {};
  return snapshot.operators.find((operator) => operator.id === id)?.name ?? (Object.prototype.hasOwnProperty.call(names, id) ? names[id] : undefined);
}
