import catalog from "../../shared/permission-catalog.json";
import { REMITTANCE_PERMISSIONS } from "../../shared/access.mjs";

export function PermissionAuditDetails({ details }: Readonly<{ details: unknown }>) {
  if (!details || typeof details !== "object") return null;
  const data = details as Record<string, unknown>;
  const names = new Map<string,string>(catalog.permissions.map((row) => [String(row.id), row.name]));
  const granted = Array.isArray(data.added) ? data.added.map((id) => names.get(String(id)) ?? `Permiso ${id}`) : [];
  const removed = Array.isArray(data.removed) ? data.removed.map((id) => names.get(String(id)) ?? `Permiso ${id}`) : [];
  const remittanceNames = new Map<string,string>(REMITTANCE_PERMISSIONS.map((row) => [row.key, row.name]));
  if (Array.isArray(data.remittancesAdded)) granted.push(...data.remittancesAdded.map((key) => remittanceNames.get(String(key)) ?? "Permiso de remesas"));
  if (Array.isArray(data.remittancesRemoved)) removed.push(...data.remittancesRemoved.map((key) => remittanceNames.get(String(key)) ?? "Permiso de remesas"));
  return <details><summary>Ver cambios de permisos</summary><p>Revisión {String(data.previousRevision ?? "—")} → {String(data.revision ?? "—")}</p>
    <p>Agregados: {granted.join(", ") || "Ninguno"}</p><p>Retirados: {removed.join(", ") || "Ninguno"}</p>
    {data.roleExceptionsConfirmed === true && <p>Se confirmó la advertencia de permisos adicionales al rol.</p>}</details>;
}
