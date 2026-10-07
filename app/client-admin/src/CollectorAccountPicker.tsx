import { useEffect, useState } from "react";
import { accountRoleLabel, isCollectorAccountRole } from "../../shared/accountRoles";
import { INPUT_LIMITS } from "../../shared/inputRules";
import { LegacyDialog } from "./LegacyConnectedUi";
import { remittancesApi } from "./remittancesApi";
import type { PublicAccount } from "./types";

export function CollectorAccountPicker({ currentId, onSelect, onClose }: Readonly<{
  currentId: string;
  onSelect: (account: PublicAccount) => void;
  onClose: () => void;
}>) {
  const [accounts, setAccounts] = useState<PublicAccount[]>([]);
  const [selectedId, setSelectedId] = useState(currentId);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    void remittancesApi<PublicAccount[]>("/usuarios", { signal: controller.signal }).then((rows) => {
      if (controller.signal.aborted) return;
      if (!Array.isArray(rows)) throw new Error("El servidor no devolvió una lista de cuentas válida.");
      setAccounts(rows.filter((row) => typeof row.id === "string" && row.id && isCollectorAccountRole(row.role)));
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "No se pudieron cargar las cuentas.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  const search = query.trim().toLocaleLowerCase();
  const visible = accounts.filter((row) => `${row.name} ${row.email} ${accountRoleLabel(row.role)}`.toLocaleLowerCase().includes(search));
  const selected = visible.find((row) => row.id === selectedId);
  return <LegacyDialog title="Seleccionar cuenta del cobrador..." className="catalog-legacy-dialog catalog-account-picker" onClose={onClose}>
    <div className="legacy-dialog-form">
      <label>Buscar:<input autoFocus maxLength={INPUT_LIMITS.name} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      {loading && <p role="status">Cargando cuentas…</p>}
      {error && <p role="alert">{error} <button type="button" onClick={() => setReload((value) => value + 1)}>Reintentar</button></p>}
      <div className="legacy-mdi-table-wrap"><table className="legacy-mdi-table">
        <thead><tr><th>Usuario</th><th>Cuenta</th><th>Rol</th><th>Estado</th></tr></thead>
        <tbody>{visible.map((account) => <tr key={account.id} tabIndex={0} aria-selected={selectedId === account.id} className={selectedId === account.id ? "selected-row" : ""} onClick={() => setSelectedId(account.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(account.id); } }}>
          <td>{account.name}</td><td>{account.email}</td><td>{accountRoleLabel(account.role)}</td><td>{account.status === "active" ? "Activo" : "Inactivo"}</td>
        </tr>)}</tbody>
      </table></div>
      {!loading && !error && !visible.length && <p>No hay cuentas elegibles para este filtro.</p>}
      <div className="legacy-dialog-actions centered"><button type="button" disabled={!selected || loading || Boolean(error)} onClick={() => { if (selected) onSelect(selected); }}>OK</button><button type="button" onClick={onClose}>Cancelar</button></div>
    </div>
  </LegacyDialog>;
}
