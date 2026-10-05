export type AssignmentKind = "zones" | "limits" | "routes";

// Monetary values are integer cents, matching the rest of the admin frontend.
export type CollectorAssignment = Readonly<{
  id: string;
  number: string;
  name: string;
  from: string;
  to: string;
  collectionLimit?: number;
  payoutLimit?: number;
}>;

const sessionValues = new Map<string, readonly CollectorAssignment[]>();
const keyFor = (collectorId: string, kind: AssignmentKind) =>
  `cyp-collector-assignments-v1:${encodeURIComponent(collectorId)}:${kind}`;

function validRow(value: unknown, kind: AssignmentKind): value is CollectorAssignment {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (!["id", "number", "name", "from", "to"].every((key) => typeof row[key] === "string") || !row.id) return false;
  if (kind !== "limits") return true;
  return ["DOP", "USD", "EUR"].includes(String(row.id)) &&
    [row.collectionLimit, row.payoutLimit].every((amount) => typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0);
}

export function loadCollectorAssignments(collectorId: string, kind: AssignmentKind, initial: readonly CollectorAssignment[]): CollectorAssignment[] {
  const key = keyFor(collectorId, kind);
  const cached = sessionValues.get(key);
  if (cached) return cached.map((row) => ({ ...row }));
  try {
    const saved = sessionStorage.getItem(key);
    if (saved !== null) {
      const value: unknown = JSON.parse(saved);
      if (Array.isArray(value) && value.every((row) => validRow(row, kind))) {
        const rows = [...new Map(value.map((row) => [row.id, row])).values()];
        sessionValues.set(key, rows);
        return rows.map((row) => ({ ...row }));
      }
    }
  } catch {
    // An unavailable browser store does not prevent using the dialog in memory.
  }
  return initial.map((row) => ({ ...row }));
}

export function saveCollectorAssignments(collectorId: string, kind: AssignmentKind, rows: readonly CollectorAssignment[]): void {
  if (!rows.every((row) => validRow(row, kind))) throw new Error("Revisa los datos de la asignación.");
  const saved = [...new Map(rows.map((row) => [row.id, { ...row }])).values()];
  sessionValues.set(keyFor(collectorId, kind), saved);
  try { sessionStorage.setItem(keyFor(collectorId, kind), JSON.stringify(saved)); }
  catch { /* The session continues in memory when browser storage is blocked. */ }
}

export function parseLimit(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) throw new Error("Escribe un límite válido, mayor o igual a cero y con un máximo de dos decimales.");
  const [whole, fraction = ""] = value.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error("El límite supera el importe permitido.");
  return cents;
}
