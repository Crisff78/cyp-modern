import { useEffect, useRef, useState, type FormEvent } from "react";
import { CircleHelp } from "lucide-react";
import { LegacyDialog, LegacyToolbar, handleKeyboardActivation } from "./LegacyConnectedUi";
import "./connected-user-permissions.css";

type PermissionCategory = "No definido" | "Sistema" | "Archivos" | "Edición" | "Reportes y Procesamiento" | "Monitoreo" | "Otros";
type PermissionDefinition = Readonly<{ id: number; name: string; category: PermissionCategory }>;

const categories: readonly PermissionCategory[] = ["No definido", "Sistema", "Archivos", "Edición", "Reportes y Procesamiento", "Monitoreo", "Otros"];
const groups: ReadonlyArray<Readonly<{ category: PermissionCategory; entries: ReadonlyArray<readonly [number, string]> }>> = [
  { category: "Sistema", entries: [
    [1, "Entrar al sistema"], [2, "Cambiar Clave propia"], [3, "Mostrar Configuración General"],
    [4, "Cambiar Configuración General"], [5, "Mostrar Trazas General del Sistema"],
    [6, "Hacer copias de Seguridad"], [10, "Visualizar Panel de Control del Sistema"],
    [101, "Visualizar Usuarios"], [102, "Agregar usuario"], [103, "Modificar usuario"],
    [104, "Inactivar usuario"], [106, "Modificar permisos de usuario"],
    [107, "Cambiar Clave de Usuario"], [109, "Cambiar Estación de Usuario"],
    [111, "Visualizar estaciones de usuarios"], [112, "Agregar estacion de usuarios"],
    [113, "Modificar estacion de usuarios"], [114, "Eliminar estacion de usuarios"],
    [115, "Visualizar sesiones de Usuarios"], [116, "Cerrar sesiones de usuarios"],
  ] },
  { category: "Archivos", entries: [
    [120, "Visualizar Zonas"], [121, "Agregar Zona"], [122, "Modificar Zona"],
    [123, "Inactivar/Eliminar Zona"], [130, "Visualizar Rutas"], [131, "Agregar Ruta"],
    [132, "Modificar Ruta"], [133, "Inactivar/Eliminar Ruta"], [134, "Armar Ruta"],
    [140, "Visualizar Clientes"], [141, "Agregar cliente"], [142, "Modificar cliente"],
    [143, "Inactivar cliente"], [144, "Mostrar Expediente del Cliente"],
    [145, "Modificar GeoCoordenas del Cliente"], [150, "Visualizar Cobradores"],
    [151, "Agregar cobrador"], [152, "Modificar cobrador"],
    [153, "Inactivar/Eliminar cobrador"], [154, "Modificar Zonas del Cobrador"],
    [155, "Modificar Rutas del Cobrador"], [156, "Modificar Límites del Cobrador"],
    [160, "Visualizar Grupos de PCPs"], [161, "Agregar Grupo de PCPs"],
    [162, "Modificar Grupo de PCPs"], [163, "ELiminar/Inactivar Grupo de PCPs"],
    [170, "Visualizar PCPs"], [171, "Agregar PCPs"], [172, "Modificar PCPs"],
    [173, "Inactivar/Eliminar PCPs"], [174, "Mostrar Estaciones del PCP"],
    [175, "Agregar Estación a PCP"], [176, "Eliminar Estación de PCP"],
    [180, "Visualizar Servicios"], [181, "Agregar Servicio"], [182, "Modificar Servicio"],
    [183, "Inactivar/Eliminar Servicio"], [190, "Visualizar Conceptos"],
    [191, "Agregar concepto"], [192, "Modificar Concepto"],
    [193, "Inactivar/Eliminar Concepto"], [200, "Visualizar Tasas de Cambios"],
    [201, "Agregar Tasa de Cambio"],
  ] },
  { category: "Edición", entries: [
    [300, "Visualizar Cargos"], [301, "Agregar Cargo"], [302, "Modificar Cargo"],
    [303, "Eliminar Cargo"], [304, "Importar Cargos"], [310, "Visualizar Desembolsos"],
    [311, "Agregar Desembolso"], [312, "Modificar Desembolso"], [313, "Eliminar Desembolso"],
    [320, "Visualizar Cobros"], [321, "Agregar Cobro"], [322, "Modificar Cobro"],
    [323, "Eliminar Cobro"], [330, "Visualizar Depósitos"], [331, "Agregar depósito"],
    [332, "Modificar depósito"], [333, "Eliminar depósito"], [334, "Aceptar depósito"],
    [340, "Visuzalizar Entregas"], [341, "Agregar entrega"], [342, "Modificar entrega"],
    [343, "Eliminar entrega"], [350, "Visualizar Cargos Rec."],
    [351, "Agregar Cargo Rec."], [352, "Modificar Cargo Rec."],
    [353, "Inactivar/Eliminar Cargo Rec."], [360, "Visualizar Descargos"],
    [361, "Agregar descargo"], [362, "Modificar descargo"],
    [363, "Inactivar/Eliminar descargo"], [364, "Importar descargos"],
    [370, "Visualizar Pagos"], [371, "Agregar pago"], [372, "Modificar pago"],
    [373, "Inactivar/Eliminar pago"], [374, "Exportar pagos"],
    [380, "Visualizar Entregas de Dinero"], [381, "Agregar entrega"],
    [382, "Modificar entrega"], [383, "Inactivar/Eliminar entrega"],
    [390, "Visualizar Descargos Rec."], [391, "Agregar descargo rec."],
    [392, "Modificar descargo rec."], [393, "Inactivar/Eliminar descargo rec."],
  ] },
  { category: "Reportes y Procesamiento", entries: [
    [400, "Visualizar Reportes"], [401, "Mostrar Cuadres"], [402, "Hacer cuadre"],
    [403, "Cerrar Día"], [410, "Visualizar Reporte de Cobros Resumido"],
    [411, "Visualizar Reporte de Cobros Detallado"],
    [412, "Visualizar Reporte de Pagos Resumido"],
    [413, "Visualizar Reporte de Pagos Detallado"],
    [414, "Visualizar Reporte de CDDE Resumido"],
    [415, "Visualizar Reporte de CDDE Detallado"],
  ] },
  { category: "Monitoreo", entries: [
    [500, "Mostrar Monitores"], [501, "Mostrar Monitor de Cobradores"],
  ] },
  { category: "Otros", entries: [] },
];

const catalog: readonly PermissionDefinition[] = groups.flatMap(({ category, entries }) =>
  entries.map(([id, name]) => ({ id, name, category })));
const catalogById = new Map(catalog.map((permission) => [permission.id, permission]));
const storageKey = (userId: string) => `cyp-admin-user-permissions-v1:${encodeURIComponent(userId)}`;
const isAdmin = (role: string) => ["ADMIN", "SUPERADMIN", "ADMINISTRADOR", "ROLE_ADMIN", "ROLE_SUPERADMIN"].includes(role.trim().toUpperCase());

function loadPermissionIds(userId: string, role: string): number[] {
  try {
    const saved = window.localStorage.getItem(storageKey(userId));
    if (saved !== null) {
      const parsed: unknown = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return [...new Set(parsed.filter((id): id is number => typeof id === "number" && Number.isInteger(id) && catalogById.has(id)))];
      }
    }
  } catch {
    // Browsers may block local storage; the dialog remains usable in memory.
  }
  return isAdmin(role) ? catalog.map(({ id }) => id) : [];
}

function savePermissionIds(userId: string, ids: readonly number[]): boolean {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(ids));
    return true;
  } catch {
    return false;
  }
}

function PermissionPicker({ assignedIds, onAdd, onClose }: Readonly<{
  assignedIds: readonly number[];
  onAdd: (id: number) => void;
  onClose: () => void;
}>) {
  const [category, setCategory] = useState<PermissionCategory>("No definido");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const visible = category === "No definido" ? catalog : catalog.filter((permission) => permission.category === category);
  const assigned = new Set(assignedIds);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (selectedId === null) { setError("Seleccione un permiso."); return; }
    if (assigned.has(selectedId)) { setError("Este permiso ya está asignado."); return; }
    onAdd(selectedId);
  };

  return <LegacyDialog title="Seleccionar permisos de usuarios... (*)" onClose={onClose} className="connected-permission-picker">
    <form className="connected-permission-picker-form" onSubmit={submit}>
      <label className="connected-permission-category">Categoría:
        <select autoFocus value={category} onChange={(event) => { setCategory(event.target.value as PermissionCategory); setSelectedId(null); setError(""); }}>
          {categories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      <div className="connected-permission-picker-label">Seleccione:</div>
      <div className="connected-permission-picker-scroll">
        <table className="legacy-mdi-table connected-permission-table">
          <thead><tr><th>Permiso</th></tr></thead>
          <tbody>
            {visible.map((permission) => {
              const alreadyAssigned = assigned.has(permission.id);
              return <tr key={permission.id} className={selectedId === permission.id ? "is-selected" : ""} aria-selected={selectedId === permission.id} aria-disabled={alreadyAssigned} tabIndex={alreadyAssigned ? -1 : 0} onClick={() => { if (!alreadyAssigned) { setSelectedId(permission.id); setError(""); } }} onKeyDown={(event) => { if (!alreadyAssigned) handleKeyboardActivation(event, () => { setSelectedId(permission.id); setError(""); }); }}>
                <td><span className="connected-permission-code">{permission.id}</span>{permission.name}{alreadyAssigned && <span className="connected-permission-assigned">Asignado</span>}</td>
              </tr>;
            })}
            {visible.length === 0 && <tr><td>No hay permisos en esta categoría.</td></tr>}
          </tbody>
        </table>
      </div>
      {error && <p className="connected-permission-error" role="alert">{error}</p>}
      <div className="legacy-dialog-actions connected-permission-actions">
        <button type="submit" disabled={selectedId === null}>oK</button>
        <button type="button" onClick={onClose}>Cancelar</button>
      </div>
    </form>
  </LegacyDialog>;
}

function PermissionDeleteConfirm({ onYes, onNo }: Readonly<{ onYes: () => void; onNo: () => void }>) {
  return <LegacyDialog title="Confirm" onClose={onNo} className="connected-permission-confirm">
    <div className="connected-permission-confirm-content"><CircleHelp size={30} aria-hidden="true" /><p>¿Está seguro que desea eliminar este permiso?</p></div>
    <div className="legacy-dialog-actions connected-permission-actions"><button type="button" onClick={onYes}>Sí</button><button type="button" onClick={onNo}>No</button></div>
  </LegacyDialog>;
}

export function ConnectedUserPermissionsDialog({ userId, userName, role, onClose }: Readonly<{
  userId: string;
  userName: string;
  role: string;
  onClose: () => void;
}>) {
  const [assignedIds, setAssignedIds] = useState<number[]>(() => loadPermissionIds(userId, role));
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);
  useEffect(() => {
    setAssignedIds(loadPermissionIds(userId, role));
    setSelectedId(null);
    setPickerOpen(false);
    setConfirmOpen(false);
  }, [userId, role]);
  useEffect(() => {
    tableRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedId]);
  const assigned = assignedIds.flatMap((id) => {
    const permission = catalogById.get(id);
    return permission ? [permission] : [];
  });
  const formattedUserId = `{${userId.replace(/^\{|\}$/g, "")}}`;
  const navigate = (position: "first" | "previous" | "next" | "last") => {
    if (assigned.length === 0) { setSelectedId(null); return; }
    const currentIndex = assigned.findIndex((permission) => permission.id === selectedId);
    let target = 0;
    if (position === "last") target = assigned.length - 1;
    if (position === "previous") target = currentIndex < 0 ? 0 : Math.max(0, currentIndex - 1);
    if (position === "next") target = currentIndex < 0 ? 0 : Math.min(assigned.length - 1, currentIndex + 1);
    setSelectedId(assigned[target].id);
  };
  const persist = (next: number[]) => {
    setAssignedIds(next);
    setStorageError(!savePermissionIds(userId, next));
  };
  const addPermission = (id: number) => {
    if (!catalogById.has(id) || assignedIds.includes(id)) return;
    persist([...assignedIds, id]);
    setSelectedId(id);
    setPickerOpen(false);
  };
  const deletePermission = () => {
    if (selectedId === null) return;
    const next = assignedIds.filter((id) => id !== selectedId);
    persist(next);
    setSelectedId(null);
    setConfirmOpen(false);
  };
  const refresh = () => {
    if (!storageError) setAssignedIds(loadPermissionIds(userId, role));
    setSelectedId(null);
  };

  return <LegacyDialog title="Permisos del Usuario..." onClose={onClose} className="connected-user-permissions-dialog">
    <div className="connected-user-permissions-content">
      <LegacyToolbar onFirst={() => navigate("first")} onPrevious={() => navigate("previous")} onNext={() => navigate("next")} onLast={() => navigate("last")} onNew={() => setPickerOpen(true)} showEdit={false} onDelete={() => setConfirmOpen(true)} disableDelete={selectedId === null} onRefresh={refresh} />
      <div className="legacy-mdi-table-wrap connected-user-permissions-scroll">
        <table ref={tableRef} className="legacy-mdi-table connected-user-permissions-table">
          <thead><tr><th>idUsuario</th><th>Usuario</th><th>idPermiso</th><th>Permiso</th></tr></thead>
          <tbody>
            {assigned.map((permission) => <tr key={permission.id} className={selectedId === permission.id ? "is-selected" : ""} aria-selected={selectedId === permission.id} tabIndex={0} onClick={() => setSelectedId(permission.id)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedId(permission.id))}>
              <td>{formattedUserId}</td><td>{userName}</td><td>{permission.id}</td><td>{permission.name}</td>
            </tr>)}
            {assigned.length === 0 && <tr><td colSpan={4}>Este usuario no tiene permisos asignados localmente.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="connected-user-permissions-note">Asignaciones locales de esta interfaz. Los permisos efectivos se validan en la API.</p>
      {storageError && <p className="connected-permission-error" role="alert">El navegador no pudo guardar los cambios; permanecerán hasta cerrar esta ventana.</p>}
    </div>
    {pickerOpen && <PermissionPicker assignedIds={assignedIds} onAdd={addPermission} onClose={() => setPickerOpen(false)} />}
    {confirmOpen && <PermissionDeleteConfirm onYes={deletePermission} onNo={() => setConfirmOpen(false)} />}
  </LegacyDialog>;
}
