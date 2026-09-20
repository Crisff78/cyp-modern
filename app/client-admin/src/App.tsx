import {
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Activity,
  Bell,
  Building2,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronLeft,
  ChevronsUpDown,
  CircleAlert,
  CircleHelp,
  ClipboardCheck,
  Command,
  Database,
  Download,
  FileCheck2,
  Printer,
  FolderOpen,
  KeyRound,
  LayoutDashboard,
  ListFilter,
  LoaderCircle,
  LogOut,
  MapPinned,
  Menu,
  Plus,
  Pencil,
  ReceiptText,
  RefreshCw,
  Search,
  ServerCog,
  Settings,
  ShieldCheck,
  Trash2,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import {
  api,
  ApiError,
  clearToken,
  dateLabel,
  getToken,
  money,
  setToken,
  timeLabel,
} from "./api";
import {
  Avatar,
  Badge,
  CollectorDrawer,
  CollectorMap,
  Empty,
  Loading,
  Logo,
  Modal,
  SectionHeading,
} from "./components";
import { exportCsv } from "./Dashboard";
import {
  dispatchMarkerClick,
  transformCollectorToMap,
  transformRouteToMap,
  transformZoneToMap,
  type AdaptedMap,
  type MapMarker,
} from "./services/mapAdapter";
import { parseImportCsv } from "./services/importCsv";
import OperationModal, { type Operation } from "./Operations";
import AccountModal, { type AccountOperation } from "./Users";
import {
  canAccessAdmin,
  enrichUserRole,
  isSuspendedUser,
  normalizeRole,
  type Collector,
  type ClientStatement,
  type Page,
  type Snapshot,
  type User,
} from "./types";

const groupOrder = [
  "ARCHIVOS",
  "COBROS",
  "PAGOS",
  "REPORTES & MONITOREO",
] as const;
type NavGroup = (typeof groupOrder)[number];
const navigation: {
  key: string;
  page?: Page;
  action?: "controlPanel";
  label: string;
  icon: typeof LayoutDashboard;
  group: NavGroup;
  primary?: boolean;
  badge?: "pendingCharges";
}[] = [
  { key: "admin-panel", action: "controlPanel", label: "Admin.", icon: ServerCog, group: "ARCHIVOS" },
  { key: "clients", page: "clients", label: "Clientes", icon: FolderOpen, group: "ARCHIVOS" },
  {
    key: "direct-charges",
    page: "charges",
    label: "Cargos",
    icon: ReceiptText,
    group: "COBROS",
    badge: "pendingCharges",
  },
  {
    key: "recurring-charges",
    page: "recurringCharges",
    label: "Cargos Recurrentes",
    icon: RefreshCw,
    group: "COBROS",
  },
  {
    key: "collections",
    page: "collections",
    label: "Cobros",
    icon: ArrowDownLeft,
    group: "COBROS",
  },
  {
    key: "deposits",
    page: "deposits",
    label: "Depósitos por Cobradores",
    icon: Wallet,
    group: "COBROS",
  },
  {
    key: "payouts",
    page: "payouts",
    label: "Descargos",
    icon: ArrowUpRight,
    group: "PAGOS",
  },
  {
    key: "recurring-payouts",
    page: "recurringPayouts",
    label: "Descargos Rec.",
    icon: RefreshCw,
    group: "PAGOS",
  },
  {
    key: "payments",
    page: "payments",
    label: "Pagos",
    icon: ArrowUpRight,
    group: "PAGOS",
  },
  {
    key: "cash-delivery",
    page: "cashDeliveries",
    label: "Entregas de Dinero",
    icon: Wallet,
    group: "PAGOS",
  },
  {
    key: "monitor-collectors",
    page: "monitorCollectors",
    label: "Monitor C",
    icon: LayoutDashboard,
    group: "REPORTES & MONITOREO",
    primary: true,
  },
  { key: "monitor-zones", page: "monitorZones", label: "Monitor Z", icon: MapPinned, group: "REPORTES & MONITOREO" },
  { key: "monitor-routes", page: "monitorRoutes", label: "Monitor R", icon: MapPinned, group: "REPORTES & MONITOREO" },
  { key: "daily-settlements", page: "dailySettlements", label: "Cuadres Diarios", icon: FileCheck2, group: "REPORTES & MONITOREO" },
  { key: "general-reports", page: "reports", label: "Reportes", icon: ChartNoAxesCombined, group: "REPORTES & MONITOREO" },
];
const pageFromHash = (): Page =>
  location.hash.slice(1) in pageTitles
    ? (location.hash.slice(1) as Page)
    : "monitorCollectors";
const pageTitles: Record<Page, string> = {
  collectors: "Cobradores",
  clients: "Clientes",
  routesZones: "Rutas y Zonas",
  stations: "Estaciones de PCP",
  groups: "Grupos de PCPs",
  pcps: "Puntos de Cobros y Pagos",
  routes: "Rutas",
  zones: "Zonas",
  servicesProducts: "Servicios y Productos",
  delayReasons: "Motivos de Atraso",
  exchangeRates: "Tasas de Cambio",
  sessions: "Listado de Sesiones",
  traces: "Trazas del Sistema",
  users: "Usuarios",
  generalConfig: "Configuración General",
  authorizationRequests: "Solicitudes de Autorización",
  charges: "Cargos",
  recurringCharges: "Cargos Recurrentes",
  recurringPayouts: "Descargos Recurrentes",
  collections: "Cobros",
  deposits: "Depósitos por Cobradores",
  payouts: "Descargos",
  payments: "Pagos",
  cashDeliveries: "Entregas de Dinero",
  monitorCollectors: "Monitor de Cobradores",
  monitorZones: "Monitor de Zonas",
  monitorRoutes: "Monitor de Rutas",
  dailySettlements: "Cuadres Diarios",
  reports: "Reportes",
};
type Station = {
  code: string;
  name: string;
  kind: "Administración" | "Estación de Cobro y Pago";
};
const stations: Station[] = [
  {
    code: "EST-01",
    name: "Estaci\u00f3n Operativa Predeterminada",
    kind: "Administraci\u00f3n",
  },
];

type AdminPermissions = {
  role: ReturnType<typeof normalizeRole>;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  deleteNeedsConfirm: boolean;
  readOnlyReason?: string;
};

function permissionsFor(user: User): AdminPermissions {
  const role = normalizeRole(user.role);
  if (role === "SUPERVISOR")
    return {
      role,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      deleteNeedsConfirm: false,
      readOnlyReason: "Acción restringida para Supervisores",
    };
  if (role === "ADMIN")
    return {
      role,
      canCreate: true,
      canEdit: true,
      canDelete: true,
      deleteNeedsConfirm: true,
    };
  return {
    role,
    canCreate: true,
    canEdit: true,
    canDelete: true,
    deleteNeedsConfirm: false,
  };
}


type ControlPanelTile = {
  label: string;
  page: Page;
  navKey: string;
  icon: typeof LayoutDashboard;
};

type ReportPageId =
  | "reportClientPendingCharges"
  | "reportClientPendingChargesByRoutes"
  | "reportClientPendingChargesByZones"
  | "reportPendingChargesByRoutes"
  | "reportPendingChargesByZones"
  | "reportClientChargesByZoneService"
  | "reportCollectionsSummary"
  | "reportCollectionsGeneralSummary"
  | "reportCollectionsByService"
  | "reportPaymentsDetailed"
  | "reportClientPendingPayouts"
  | "reportPendingPayoutsByRoutes"
  | "reportPendingPayoutsByZones"
  | "reportPaymentsByServiceDetailed"
  | "reportPaymentsByServiceSummary"
  | "reportServicesByZone";
type ReportDefinition = {
  id: ReportPageId;
  label: string;
  category: "-- Cargos --" | "-- Cobros --" | "-- Pagos --" | "-- Servicios --";
  filters: ("route" | "zone" | "service" | "collectorCheck")[];
};
type MdiPage = Page | "controlPanel" | ReportPageId;
const reportDefinitions: ReportDefinition[] = [
  { id: "reportClientPendingCharges", label: "Cargos pendientes de clientes.", category: "-- Cargos --", filters: [] },
  { id: "reportClientPendingChargesByRoutes", label: "Cargos pendientes de clientes por rutas.", category: "-- Cargos --", filters: ["route"] },
  { id: "reportClientPendingChargesByZones", label: "Cargos pendientes de clientes por zonas.", category: "-- Cargos --", filters: ["zone"] },
  { id: "reportPendingChargesByRoutes", label: "Cargos pendientes por rutas.", category: "-- Cargos --", filters: [] },
  { id: "reportPendingChargesByZones", label: "Cargos pendientes por zonas.", category: "-- Cargos --", filters: [] },
  { id: "reportClientChargesByZoneService", label: "Cargos de clientes por zona por servicio.", category: "-- Cargos --", filters: ["zone", "service"] },
  { id: "reportCollectionsSummary", label: "Cobros Res.", category: "-- Cobros --", filters: ["collectorCheck"] },
  { id: "reportCollectionsGeneralSummary", label: "Cobros Gen. Resumido", category: "-- Cobros --", filters: ["collectorCheck"] },
  { id: "reportCollectionsByService", label: "Cobros x Servicio", category: "-- Cobros --", filters: ["zone", "service"] },
  { id: "reportPaymentsDetailed", label: "Pagos detallado.", category: "-- Pagos --", filters: ["collectorCheck"] },
  { id: "reportClientPendingPayouts", label: "Pagos pendientes de clientes.", category: "-- Pagos --", filters: [] },
  { id: "reportPendingPayoutsByRoutes", label: "Pagos pendientes por rutas.", category: "-- Pagos --", filters: ["route"] },
  { id: "reportPendingPayoutsByZones", label: "Pagos pendientes por zonas.", category: "-- Pagos --", filters: ["zone"] },
  { id: "reportPaymentsByServiceDetailed", label: "Pagos x servicio detallado.", category: "-- Pagos --", filters: ["zone", "service"] },
  { id: "reportPaymentsByServiceSummary", label: "Pagos x servicio resumido.", category: "-- Pagos --", filters: ["zone", "service"] },
  { id: "reportServicesByZone", label: "Servicios por zona.", category: "-- Servicios --", filters: ["zone"] },
];
const reportTitle = (page: ReportPageId) =>
  reportDefinitions.find((report) => report.id === page)?.label.replace(/\.$/, "") ?? "Reporte";
const isReportPage = (page: MdiPage): page is ReportPageId =>
  reportDefinitions.some((report) => report.id === page);
const mdiOperationPages: Page[] = [
  "charges",
  "recurringCharges",
  "recurringPayouts",
  "collections",
  "deposits",
  "payouts",
  "payments",
  "cashDeliveries",
];
const mdiMonitoringPages: Page[] = [
  "monitorCollectors",
  "monitorZones",
  "monitorRoutes",
  "dailySettlements",
];
const isMdiOperationPage = (page: MdiPage): page is Page =>
  page !== "controlPanel" && !isReportPage(page) && mdiOperationPages.includes(page);
const isMdiMonitoringPage = (page: MdiPage): page is Page =>
  page !== "controlPanel" && !isReportPage(page) && mdiMonitoringPages.includes(page);
const mdiTitle = (page: MdiPage) =>
  page === "controlPanel" ? "Panel de Control" : isReportPage(page) ? reportTitle(page) : pageTitles[page];

type MdiWindowState = {
  id: string;
  page: MdiPage;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  isFocused: boolean;
};

const codifierTiles: ControlPanelTile[] = [
  { label: "Cobradores", page: "collectors", navKey: "control-collectors", icon: Users },
  { label: "Estaciones", page: "stations", navKey: "control-stations", icon: Building2 },
  { label: "Grupos", page: "groups", navKey: "control-groups", icon: Users },
  { label: "Motivos Atraso", page: "delayReasons", navKey: "control-delay-reasons", icon: CircleAlert },
  { label: "PCPs", page: "pcps", navKey: "control-pcps", icon: MapPinned },
  { label: "Rutas", page: "routes", navKey: "control-routes", icon: MapPinned },
  { label: "Servicios y Prods.", page: "servicesProducts", navKey: "control-services", icon: ListFilter },
  { label: "Sesiones", page: "sessions", navKey: "control-sessions", icon: Activity },
  { label: "Tasas de cambio", page: "exchangeRates", navKey: "control-exchange", icon: RefreshCw },
  { label: "Trazas", page: "traces", navKey: "control-traces", icon: ClipboardCheck },
  { label: "Usuarios", page: "users", navKey: "control-users", icon: ShieldCheck },
  { label: "Zonas", page: "zones", navKey: "control-zones", icon: MapPinned },
];

const toolTiles: ControlPanelTile[] = [
  { label: "Configuracion General", page: "generalConfig", navKey: "control-general-config", icon: Settings },
  { label: "Solicitudes de Autoriz.", page: "authorizationRequests", navKey: "control-authorizations", icon: FileCheck2 },
];

function ControlPanelContent({ onLaunch }: { onLaunch: (page: Page, navKey: string) => void }) {
  const renderTile = (tile: ControlPanelTile) => (
    <button type="button" className="control-panel-tile" key={tile.navKey} onClick={() => onLaunch(tile.page, tile.navKey)}>
      <span className="control-panel-icon"><tile.icon size={22} /></span>
      <strong>{tile.label}</strong>
    </button>
  );
  return (
    <div className="control-panel-body in-mdi">
      <section className="control-panel-section"><div className="control-panel-section-heading"><span>Codificadores</span><small>Accesos rapidos</small></div><div className="control-panel-grid">{codifierTiles.map(renderTile)}</div></section>
      <section className="control-panel-section tools-section"><div className="control-panel-section-heading"><span>Herramientas</span><small>Control interno</small></div><div className="control-panel-grid tools-grid">{toolTiles.map(renderTile)}</div></section>
    </div>
  );
}

function ReportesLauncher({ onLaunch }: { onLaunch: (page: ReportPageId, navKey: string) => void }) {
  const renderGroup = (category: ReportDefinition["category"]) => (
    <section className="reports-launcher-section" key={category}>
      <div className="control-panel-section-heading"><span>{category}</span><small>Seleccione un reporte</small></div>
      <div className="reports-launcher-grid">
        {reportDefinitions.filter((report) => report.category === category).map((report) => (
          <button
            type="button"
            className="report-launcher-tile"
            key={report.id}
            onClick={() => onLaunch(report.id, `reports-${report.id}`)}
          >
            <ChartNoAxesCombined size={18} aria-hidden="true" />
            <span>{report.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
  return (
    <div className="reports-launcher">
      {renderGroup("-- Cargos --")}
      {renderGroup("-- Cobros --")}
      {renderGroup("-- Pagos --")}
      {renderGroup("-- Servicios --")}
    </div>
  );
}

function ReportLayout({ title, snapshot, children }: { title: string; snapshot: Snapshot; children?: ReactNode }) {
  return (
    <div className="report-layout">
      <aside className="report-filter-panel">
        <div className="report-filter-fields">
          <label>Fecha inicial<input type="date" defaultValue="2026-09-01" /></label>
          <label>Fecha final<input type="date" defaultValue={snapshot.businessDate} /></label>
          <label>Moneda<select defaultValue="Peso Dominicano"><option>Peso Dominicano</option><option>Dólar Estadounidense</option><option>Euro</option></select></label>
          {children}
        </div>
        <div className="report-filter-actions">
          <div className="report-separator">---</div>
          <button type="button" className="btn full"><RefreshCw size={14} /> Refrescar</button>
          <div className="report-action-row">
            <button type="button" onClick={() => window.print()}><Printer size={14} /> Imprimir</button>
            <button type="button"><Download size={14} /> Exportar</button>
          </div>
        </div>
      </aside>
      <section className="report-results-panel" aria-label={`Resultados de ${title}`}>
        <div className="report-results-header">
          <strong>{title}</strong>
          <span>Vista preliminar</span>
        </div>
        <div className="legacy-mdi-table-wrap report-empty-grid">
          <table className="legacy-mdi-table">
            <thead><tr><th>Nro.</th><th>Fecha</th><th>Descripción</th><th>Moneda</th><th>Importe</th></tr></thead>
            <tbody><tr><td colSpan={5}>Use los filtros y presione Refrescar para generar el reporte.</td></tr></tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ReportView({ page, snapshot }: { page: ReportPageId; snapshot: Snapshot }) {
  const definition = reportDefinitions.find((report) => report.id === page);
  const title = definition ? definition.label.replace(/\.$/, "") : "Reporte";
  const zones = Array.from(new Set(snapshot.routes.map((route) => route.sector)));
  const services = Array.from(new Set([...snapshot.charges.map((charge) => charge.service), ...snapshot.payouts.map((payout) => payout.concept)]));
  return (
    <ReportLayout title={title} snapshot={snapshot}>
      {definition?.filters.includes("route") && (
        <label>Ruta:<select defaultValue=""><option value="">Todas</option>{snapshot.routes.map((route) => <option key={route.id}>{route.name}</option>)}</select></label>
      )}
      {definition?.filters.includes("zone") && (
        <label>Zona:<select defaultValue=""><option value="">Todas</option>{zones.map((zone) => <option key={zone}>{zone}</option>)}</select></label>
      )}
      {definition?.filters.includes("service") && (
        <label>Servicio:<select defaultValue=""><option value="">Todos</option>{services.map((service) => <option key={service}>{service}</option>)}</select></label>
      )}
      {definition?.filters.includes("collectorCheck") && (
        <label className="report-inline-check"><span><input type="checkbox" /> Cobrador</span><select defaultValue=""><option value="">Todos</option>{snapshot.collectors.map((collector) => <option key={collector.id}>{collector.name}</option>)}</select></label>
      )}
    </ReportLayout>
  );
}

function MdiWindow({ windowState, onClose, onFocus, onMove, children }: { windowState: MdiWindowState; onClose: (id: string) => void; onFocus: (id: string) => void; onMove: (id: string, x: number, y: number) => void; children: ReactNode }) {
  const [drag, setDrag] = useState<null | { startX: number; startY: number; x: number; y: number }>(null);
  useEffect(() => {
    if (!drag) return;
    const onMouseMove = (event: MouseEvent) => onMove(windowState.id, Math.max(8, drag.x + event.clientX - drag.startX), Math.max(8, drag.y + event.clientY - drag.startY));
    const onMouseUp = () => setDrag(null);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp, { once: true });
    return () => { document.removeEventListener("mousemove", onMouseMove); document.removeEventListener("mouseup", onMouseUp); };
  }, [drag, onMove, windowState.id]);
  const startDrag = (event: ReactMouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    onFocus(windowState.id);
    setDrag({ startX: event.clientX, startY: event.clientY, x: windowState.x, y: windowState.y });
  };
  return (
    <section className={`mdi-window ${windowState.isFocused ? "focused" : ""}`} style={{ left: windowState.x, top: windowState.y, width: windowState.width, height: windowState.height, zIndex: windowState.zIndex }} onMouseDown={() => onFocus(windowState.id)} role="dialog" aria-label={windowState.title}>
      <div className="mdi-window-titlebar" onMouseDown={startDrag}><span>{windowState.title}</span><button type="button" aria-label={`Cerrar ${windowState.title}`} onClick={() => onClose(windowState.id)}><X size={15} /></button></div>
      <div className="mdi-window-content">{children}</div><span className="mdi-resize-cue" aria-hidden="true" />
    </section>
  );
}

function LegacyToolbar({ onNew, onEdit, onDelete, onRefresh, extra }: { onNew?: () => void; onEdit?: () => void; onDelete?: () => void; onRefresh?: () => void; extra?: ReactNode }) {
  return <div className="legacy-mdi-toolbar" aria-label="Barra de herramientas legacy"><button type="button" className="nav-tool" title="Ir al inicio">|&lt;</button><button type="button" className="nav-tool" title="Anterior">&lt;</button><button type="button" className="nav-tool" title="Siguiente">&gt;</button><button type="button" className="nav-tool" title="Ir al final">&gt;|</button><span className="mdi-toolbar-separator" /><button type="button" title="Nuevo" onClick={onNew}><Plus size={15} /></button><button type="button" title="Editar" onClick={onEdit}><Pencil size={15} /></button><button type="button" className="danger-tool" title="Eliminar" onClick={onDelete}><Trash2 size={15} /></button><button type="button" title="Refrescar" onClick={onRefresh}><RefreshCw size={15} /></button>{extra && <span className="mdi-toolbar-extra">{extra}</span>}</div>;
}
function LegacyCheck({ checked = true }: { checked?: boolean }) { return <input type="checkbox" checked={checked} readOnly aria-label={checked ? "Activo" : "Inactivo"} />; }
function LegacyDenseTable({ columns, rows }: { columns: string[]; rows: ReactNode[][] }) { return <div className="legacy-mdi-table-wrap"><table className="legacy-mdi-table"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>; }
function LegacySidePanel({ children }: { children: ReactNode }) { return <aside className="legacy-mdi-side-panel">{children}</aside>; }

function LegacyDialog({ title, onClose, children, className = "" }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div className="legacy-dialog-overlay" role="presentation">
      <section className={`legacy-dialog ${className}`} role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="legacy-dialog-titlebar">
          <span>{title}</span>
          <button type="button" aria-label={`Cerrar ${title}`} onClick={onClose}>X</button>
        </div>
        <div className="legacy-dialog-body">{children}</div>
      </section>
    </div>
  );
}

type CollectorFormDraft = {
  name: string;
  ident: string;
  cellular: string;
  accountId: string;
};

function CollectorFormLegacyDialog({ collector, onClose, onSave }: { collector?: Collector; onClose: () => void; onSave: (draft: CollectorFormDraft) => void }) {
  const [draft, setDraft] = useState<CollectorFormDraft>({
    name: collector?.name ?? "",
    ident: collector?.ident ?? "",
    cellular: collector?.cellular ?? "",
    accountId: collector?.accountId ?? "cob",
  });
  const update = (field: keyof CollectorFormDraft, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim()) return toast.error("El nombre del cobrador es requerido.");
    onSave(draft);
  };
  return (
    <LegacyDialog title="Datos de Cobrador..." onClose={onClose} className="collector-form-dialog">
      <form className="legacy-dialog-form" onSubmit={submit}>
        <label>Cobrador:<input autoFocus value={draft.name} onChange={(event) => update("name", event.target.value)} /></label>
        <div className="legacy-dialog-row two-cols">
          <label>Ident.:<input value={draft.ident} onChange={(event) => update("ident", event.target.value)} /></label>
          <label>Celular:<input value={draft.cellular} onChange={(event) => update("cellular", event.target.value)} /></label>
        </div>
        <label>Cuenta:<span className="legacy-lookup-field"><input value={draft.accountId} disabled readOnly /><button type="button" aria-label="Buscar cuenta">...</button></span></label>
        <div className="legacy-dialog-actions centered"><button type="submit">oK</button><button type="button" onClick={onClose}>Cancelar</button></div>
      </form>
    </LegacyDialog>
  );
}

function LegacyConfirmDialog({ title = "Confirm", message, onYes, onNo }: { title?: string; message: string; onYes: () => void; onNo: () => void }) {
  return (
    <LegacyDialog title={title} onClose={onNo} className="legacy-confirm-dialog">
      <div className="legacy-confirm-content"><span className="legacy-question-icon">?</span><p>{message}</p></div>
      <div className="legacy-dialog-actions centered"><button type="button" onClick={onYes}>Sí</button><button type="button" onClick={onNo}>No</button></div>
    </LegacyDialog>
  );
}

function CollectorZonesLegacyDialog({ collector, onClose }: { collector: Collector; onClose: () => void }) {
  const [zones, setZones] = useState(() => collector.zones?.length ? collector.zones : [{ id: "zone-default", name: "Zona Centro", from: "001", to: "999" }]);
  const [selectedZoneId, setSelectedZoneId] = useState(zones[0]?.id ?? "");
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const removeSelected = () => {
    setZones((current) => current.filter((zone) => zone.id !== selectedZoneId));
    setSelectedZoneId("");
    setConfirmDelete(false);
    toast.success("Zona eliminada del cobrador");
  };
  return (
    <LegacyDialog title="Zonas del Cobrador..." onClose={onClose} className="collector-relation-dialog">
      <div className="legacy-relation-manager">
        <div className="legacy-relation-toolbar"><button type="button" onClick={() => setAdding(true)}>Agregar</button><button type="button" onClick={() => setConfirmDelete(true)} disabled={!selectedZoneId}>Eliminar</button></div>
        <LegacyDenseTable columns={["Nro", "Zona", "Desde", "Hasta"]} rows={zones.map((zone, index) => [<button type="button" className={`mdi-row-select ${selectedZoneId === zone.id ? "selected" : ""}`} onClick={() => setSelectedZoneId(zone.id)}>{index + 1}</button>, zone.name, zone.from, zone.to])} />
        <div className="legacy-mdi-pager"><button type="button">|&lt;</button><button type="button">&lt;</button><span>Página 1 de 1</span><button type="button">&gt;</button><button type="button">&gt;|</button></div>
      </div>
      {adding && <ZoneSelectDialog onClose={() => setAdding(false)} onSelect={(name) => { const next = { id: `zone-${Date.now()}`, name, from: "001", to: "999" }; setZones((current) => [...current, next]); setSelectedZoneId(next.id); setAdding(false); toast.success("Zona agregada al cobrador"); }} />}
      {confirmDelete && <LegacyConfirmDialog message="¿Está seguro que desea eliminar la Zona actual del Cobrador?" onYes={removeSelected} onNo={() => setConfirmDelete(false)} />}
    </LegacyDialog>
  );
}

function ZoneSelectDialog({ onClose, onSelect }: { onClose: () => void; onSelect: (name: string) => void }) {
  const [selected, setSelected] = useState("Zona Centro");
  return (
    <LegacyDialog title="Seleccionar..." onClose={onClose} className="legacy-select-dialog">
      <div className="legacy-dialog-form">
        <label>Seleccione:<select autoFocus value={selected} onChange={(event) => setSelected(event.target.value)}><option>Zona Centro</option><option>Zona Norte</option><option>Zona Sur</option><option>Zona Este</option><option>Mercado</option></select></label>
        <div className="legacy-dialog-actions centered"><button type="button" onClick={() => onSelect(selected)}>oK</button><button type="button" onClick={onClose}>Cancelar</button></div>
      </div>
    </LegacyDialog>
  );
}

function CollectorLimitsLegacyDialog({ collector, onClose }: { collector: Collector; onClose: () => void }) {
  const [limits, setLimits] = useState(() => collector.limits?.length ? collector.limits : [{ currency: "Peso Dominicano", abbr: "DOP", collectionLimit: collector.collectionLimit, payoutLimit: collector.payoutLimit }]);
  const [selectedAbbr, setSelectedAbbr] = useState(limits[0]?.abbr ?? "");
  const addLimit = () => {
    const next = { currency: "Dólar Americano", abbr: `USD${limits.length + 1}`, collectionLimit: 25000, payoutLimit: 10000 };
    setLimits((current) => [...current, next]);
    setSelectedAbbr(next.abbr);
  };
  const removeLimit = () => {
    setLimits((current) => current.filter((limit) => limit.abbr !== selectedAbbr));
    setSelectedAbbr("");
  };
  return (
    <LegacyDialog title="Limites del Cobrador" onClose={onClose} className="collector-relation-dialog limits-dialog">
      <div className="legacy-relation-manager">
        <div className="legacy-relation-toolbar"><button type="button" onClick={addLimit}>Agregar</button><button type="button" onClick={removeLimit} disabled={!selectedAbbr}>Eliminar</button><button type="button" onClick={() => toast.success("Límites guardados")}>Guardar</button></div>
        <LegacyDenseTable columns={["Moneda", "Abrev", "Lim. de Cobro", "Lim. de Pago"]} rows={limits.map((limit) => [<button type="button" className={`mdi-row-select ${selectedAbbr === limit.abbr ? "selected" : ""}`} onClick={() => setSelectedAbbr(limit.abbr)}>{limit.currency}</button>, limit.abbr, money(limit.collectionLimit), money(limit.payoutLimit)])} />
      </div>
    </LegacyDialog>
  );
}

function CollectorRoutesLegacyDialog({ collector, snapshot, onClose }: { collector: Collector; snapshot: Snapshot; onClose: () => void }) {
  const [routes, setRoutes] = useState(() => collector.assignedRoutes?.length ? collector.assignedRoutes : [collector.routeId]);
  const [selectedRouteId, setSelectedRouteId] = useState(routes[0] ?? "");
  const addRoute = () => {
    const available = snapshot.routes.find((route) => !routes.includes(route.id));
    if (!available) return toast.info("No hay rutas disponibles para agregar.");
    setRoutes((current) => [...current, available.id]);
    setSelectedRouteId(available.id);
  };
  const removeRoute = () => {
    setRoutes((current) => current.filter((routeId) => routeId !== selectedRouteId));
    setSelectedRouteId("");
  };
  return (
    <LegacyDialog title="Rutas del Cobrador..." onClose={onClose} className="collector-relation-dialog routes-dialog">
      <div className="legacy-relation-manager">
        <div className="legacy-relation-toolbar"><button type="button" onClick={addRoute}>Agregar</button><button type="button" onClick={removeRoute} disabled={!selectedRouteId}>Eliminar</button></div>
        <LegacyDenseTable columns={["Nro_Ruta", "Ruta"]} rows={routes.map((routeId, index) => [<button type="button" className={`mdi-row-select ${selectedRouteId === routeId ? "selected" : ""}`} onClick={() => setSelectedRouteId(routeId)}>{index + 1}</button>, snapshot.routes.find((route) => route.id === routeId)?.name ?? routeId])} />
        <div className="legacy-mdi-pager"><button type="button">|&lt;</button><button type="button">&lt;</button><span>Página 1 de 1</span><button type="button">&gt;</button><button type="button">&gt;|</button></div>
      </div>
    </LegacyDialog>
  );
}

function CollectorsLegacyView({ snapshot, onRefresh }: { snapshot: Snapshot; onRefresh: () => void }) {
  const [collectors, setCollectors] = useState<Collector[]>(() => snapshot.collectors);
  const [selectedCollectorId, setSelectedCollectorId] = useState(snapshot.collectors[0]?.id ?? "");
  const [formMode, setFormMode] = useState<"new" | "edit" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [relationDialog, setRelationDialog] = useState<"zones" | "limits" | "routes" | null>(null);
  const selectedCollector = collectors.find((collector) => collector.id === selectedCollectorId) ?? collectors[0];
  const saveCollector = (draft: CollectorFormDraft) => {
    if (formMode === "edit" && selectedCollector) {
      setCollectors((current) => current.map((collector) => collector.id === selectedCollector.id ? { ...collector, name: draft.name, ident: draft.ident, cellular: draft.cellular, accountId: draft.accountId } : collector));
      toast.success("Cobrador actualizado");
    } else {
      const next: Collector = { id: `local-collector-${Date.now()}`, name: draft.name, initials: draft.name.slice(0, 2).toUpperCase(), routeId: snapshot.routes[0]?.id ?? "route-local", status: "active", cashInHand: 0, collectionLimit: 25000, payoutLimit: 10000, lat: 19.45, lng: -70.7, lastSeen: new Date().toISOString(), ident: draft.ident, cellular: draft.cellular, accountId: draft.accountId, zones: [], limits: [], assignedRoutes: [] };
      setCollectors((current) => [...current, next]);
      setSelectedCollectorId(next.id);
      toast.success("Cobrador creado");
    }
    setFormMode(null);
  };
  const inactivateCollector = () => {
    if (!selectedCollector) return;
    setCollectors((current) => current.map((collector) => collector.id === selectedCollector.id ? { ...collector, status: "offline" } : collector));
    setConfirmDelete(false);
    toast.success("Cobrador inactivado");
  };
  return (
    <div className="legacy-mdi-view">
      <LegacyToolbar onNew={() => setFormMode("new")} onEdit={() => selectedCollector ? setFormMode("edit") : toast.info("Seleccione un cobrador.")} onDelete={() => selectedCollector ? setConfirmDelete(true) : toast.info("Seleccione un cobrador.")} onRefresh={onRefresh} extra={<><button type="button" disabled={!selectedCollector} onClick={() => setRelationDialog("zones")}>Z</button><button type="button" disabled={!selectedCollector} onClick={() => setRelationDialog("limits")}>L</button><button type="button" disabled={!selectedCollector} onClick={() => setRelationDialog("routes")}>R</button></>} />
      <LegacyDenseTable columns={["Cod.", "Cobrador", "Celular", "Cuenta", "Act."]} rows={collectors.map((collector, index) => [<button type="button" className={`mdi-row-select ${selectedCollectorId === collector.id ? "selected" : ""}`} onClick={() => setSelectedCollectorId(collector.id)}>{String(index + 1).padStart(3, "0")}</button>, collector.name, collector.cellular ?? "809-000-0000", collector.accountId ?? "cob", <LegacyCheck checked={collector.status !== "offline"} />])} />
      {formMode && <CollectorFormLegacyDialog collector={formMode === "edit" ? selectedCollector : undefined} onClose={() => setFormMode(null)} onSave={saveCollector} />}
      {confirmDelete && <LegacyConfirmDialog message="¿Inactivar datos?" onYes={inactivateCollector} onNo={() => setConfirmDelete(false)} />}
      {relationDialog === "zones" && selectedCollector && <CollectorZonesLegacyDialog collector={selectedCollector} onClose={() => setRelationDialog(null)} />}
      {relationDialog === "limits" && selectedCollector && <CollectorLimitsLegacyDialog collector={selectedCollector} onClose={() => setRelationDialog(null)} />}
      {relationDialog === "routes" && selectedCollector && <CollectorRoutesLegacyDialog collector={selectedCollector} snapshot={snapshot} onClose={() => setRelationDialog(null)} />}
    </div>
  );
}

const SYSTEM_CONFIG_DEFAULTS: Record<string, string | number | boolean> = {
  "general.empresa": "Gamera Software - Cobros y Pagos",
  "general.direccion": "Santiago de los Caballeros, República Dominicana",
  "general.telefono": "809-555-0100",
  "general.correo": "admin@cyp.local",
  "general.fax": "809-555-0199",
  "general.licencia": "CYP-DEMO-2026-ADM001",
  "general.moneda": "Peso Dominicano",
  "clientes.modificarCodigo": true,
  "clientes.requerirIdentificacion": true,
  "clientes.identificacionUnica": true,
  "cargos.importeConcepto": true,
  "cargos.modificarImporteConcepto": true,
  "cargos.modificarPrecio": true,
  "cargos.modificarCantidad": true,
  "cargos.enPcp": true,
  "cargos.tragamonedas": false,
  "cargos.servicioTm": "MANEJO DE MAQUINITAS",
  "cargos.conceptoTm": "",
  "descargos.modificarCantidad": true,
  "cobros.guardarGps": true,
  "cobros.mezclarServiciosRecibo": true,
  "cobros.cobrosParciales": true,
  "cobros.cobroSaldoPendiente": true,
  "cobros.obligarVencidos": false,
  "cobros.porcientoCdc": "0",
  "impresion.mismaImpresora": false,
  "impresion.reciboHtml": false,
  "impresion.reciboMatriz": false,
  "impresion.reciboVirtual": false,
  "impresion.url": "",
  "impresion.puerto": "",
  "impresion.nombre": "",
  "interfaz.monitorInicio": true,
  "gps.latitud": "19.4499607086182",
  "gps.longitud": "-70.68701171875",
};

function LegacyCodifierView({ page, snapshot, onRefresh, onAccount }: { page: Page; snapshot: Snapshot; onRefresh: () => void; onAccount: (operation: AccountOperation) => void }) {
  const [configTab, setConfigTab] = useState("General");
  const [systemCfg, setSystemCfg] = useState<Record<string, string | number | boolean>>(SYSTEM_CONFIG_DEFAULTS);
  const [savedCfg, setSavedCfg] = useState<Record<string, string | number | boolean>>(SYSTEM_CONFIG_DEFAULTS);
  const [cfgBusy, setCfgBusy] = useState(false);
  useEffect(() => {
    if (page !== "generalConfig") return;
    let active = true;
    api<{ config: Record<string, string | number | boolean> }>("/configuracion")
      .then((data) => {
        if (!active) return;
        const merged = { ...SYSTEM_CONFIG_DEFAULTS, ...(data.config ?? {}) };
        setSystemCfg(merged);
        setSavedCfg(merged);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [page]);
  const saveSystemCfg = async () => {
    setCfgBusy(true);
    try {
      await api("/configuracion", {
        method: "POST",
        body: JSON.stringify({ config: systemCfg }),
      });
      setSavedCfg(systemCfg);
      toast.success("Configuración guardada");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo guardar la configuración.",
      );
    } finally {
      setCfgBusy(false);
    }
  };
  const services = Array.from(new Set([...snapshot.charges.map((charge) => charge.service), ...snapshot.payouts.map((payout) => payout.concept)]));
  const routeName = (routeId: string) => snapshot.routes.find((route) => route.id === routeId)?.name ?? "Sin ruta";
  const baseToolbar = (extra?: ReactNode) => <LegacyToolbar onRefresh={onRefresh} extra={extra} />;
  if (page === "collectors") return <CollectorsLegacyView snapshot={snapshot} onRefresh={onRefresh} />;
  if (page === "stations") return <div className="legacy-mdi-view">{baseToolbar()}<LegacyDenseTable columns={["Nro", "Estacion", "idDispositivo", "Licencia", "Version", "VersionRec", "Activa"]} rows={[["1", "ADM001", "PC-ADM001", "CYP-ADM-001", "1.0.0", "1.0.0", <LegacyCheck />], ["2", "ECP001", "TERM-ECP001", "CYP-ECP-001", "1.0.0", "1.0.0", <LegacyCheck />], ["3", "ECP002", "TERM-ECP002", "CYP-ECP-002", "1.0.0", "1.0.0", <LegacyCheck checked={false} />]]} /></div>;
  if (page === "groups") return <div className="legacy-mdi-view">{baseToolbar()}<LegacyDenseTable columns={["Nro.", "Grupo"]} rows={[["1", "Grupo Principal"], ["2", "df"], ["3", "GRUPO MAYITO"]]} /></div>;
  if (page === "delayReasons") return <div className="legacy-mdi-view">{baseToolbar()}<LegacyDenseTable columns={["Nro.", "Motivo", "Activo"]} rows={[["1", "Local cerrado", <LegacyCheck />], ["2", "Cliente ausente", <LegacyCheck />], ["3", "Promesa de pago", <LegacyCheck />], ["4", "Sin efectivo disponible", <LegacyCheck />]]} /></div>;
  if (page === "routes") return <div className="legacy-mdi-view">{baseToolbar()}<LegacyDenseTable columns={["Nro.", "Ruta", "Desde", "Hasta", "Activo"]} rows={snapshot.routes.map((route, index) => [index + 1, route.name, "001", "999", <LegacyCheck />])} /></div>;
  if (page === "servicesProducts") return <div className="legacy-mdi-view">{baseToolbar()}<LegacyDenseTable columns={["Nro.", "Servicio", "Abrev", "Caption", "Ob. Cob.", "Activo"]} rows={services.map((service, index) => [index + 1, service, abbreviation(service), service, <LegacyCheck checked={index === 0} />, <LegacyCheck />])} /></div>;
  if (page === "exchangeRates") return <div className="legacy-mdi-view">{baseToolbar()}<LegacyDenseTable columns={["Fecha", "Moneda", "Abrev", "Compra", "Venta"]} rows={[["18/09/2026", "Peso Dominicano", "DOP", "1.00", "1.00"], ["18/09/2026", "Dolar Estadounidense", "USD", "59.20", "60.15"], ["18/09/2026", "Euro", "EUR", "64.30", "65.80"]]} /></div>;
  if (page === "pcps") return <div className="legacy-mdi-split-view"><LegacySidePanel><LegacyToolbar onRefresh={onRefresh} /><label><input type="radio" name="pcp-filter" defaultChecked /> Todos</label><label><input type="radio" name="pcp-filter" /> del Grupo</label><label>Grupo<select defaultValue="Grupo Principal"><option>Grupo Principal</option><option>df</option><option>GRUPO MAYITO</option></select></label></LegacySidePanel><LegacyDenseTable columns={["Nro.", "PCP", "Cliente", "Grupo", "Ruta", "Activo"]} rows={snapshot.clients.map((client, index) => [index + 1, `PCP-${client.code}`, client.name, index % 2 ? "df" : "Grupo Principal", routeName(client.routeId), <LegacyCheck />])} /></div>;
  if (page === "sessions") return <div className="legacy-mdi-split-view"><LegacySidePanel><div className="legacy-vertical-toolbar"><button>Filtro</button><button>|&lt;</button><button>&lt;</button><button>&gt;</button><button>X</button><button>Ref.</button></div><label><input type="radio" name="session-filter" defaultChecked /> Todas</label><label><input type="radio" name="session-filter" /> del Usuario</label><label>Usuario<select><option>admin@cyp.local</option><option>collector@cyp.local</option></select></label><label>Fecha inicial<input type="date" defaultValue="2026-09-18" /></label><label>Fecha final<input type="date" defaultValue="2026-09-18" /></label><label><input type="checkbox" defaultChecked /> Activa</label></LegacySidePanel><LegacyDenseTable columns={["Nro.", "Usuario", "Estacion", "Inicio", "Estado"]} rows={snapshot.accounts.map((account, index) => [index + 1, account.email, account.role === "admin" ? "ADM001" : "ECP001", "18/09/2026 08:00", account.status === "active" ? "Activa" : "Cerrada"])} /></div>;
  if (page === "traces") return <div className="legacy-mdi-split-view traces-layout"><LegacySidePanel><div className="legacy-vertical-toolbar"><button>Filtro</button><button>|&lt;</button><button>&lt;</button><button>&gt;</button><button>X</button><button>Ref.</button></div><label>Fecha Inicial<input type="datetime-local" defaultValue="2026-09-18T00:00" /></label><label>Fecha final<input type="datetime-local" defaultValue="2026-09-18T23:59" /></label><label>Buscar<input placeholder="Digite texto..." /></label></LegacySidePanel><div className="legacy-mdi-table-with-footer"><LegacyDenseTable columns={["Nro.", "Fecha", "Traza"]} rows={[[1, "18/09/2026 08:00", "Inicio de sesion administrativa"], [2, "18/09/2026 08:04", "Consulta de cobradores"], [3, "18/09/2026 08:15", "Apertura de Panel de Control"]]} /><div className="legacy-mdi-pager"><button>|&lt;</button><button>&lt;</button><span>Pagina 1 de 1</span><button>&gt;</button><button>&gt;|</button></div></div></div>;
  if (page === "users") return <div className="legacy-mdi-view">{baseToolbar(<button type="button" onClick={() => onAccount({ type: "create" })}>Nueva cuenta</button>)}<LegacyDenseTable columns={["Usuario", "Cuenta", "Rol", "Act."]} rows={snapshot.accounts.map((account) => [account.name, account.email, account.role === "admin" ? "Administracion" : "Cobrador", <LegacyCheck checked={account.status === "active"} />])} /></div>;
  if (page === "zones") return <div className="legacy-mdi-view">{baseToolbar()}<LegacyDenseTable columns={["Nro", "Zona", "Desde", "Hasta", "Act."]} rows={Array.from(new Set(snapshot.routes.map((route) => route.sector))).map((sector, index) => [index + 1, sector, "001", "999", <LegacyCheck />])} /></div>;
  if (page === "authorizationRequests") return <div className="legacy-mdi-split-view authorizations-layout"><LegacySidePanel><LegacyToolbar onRefresh={onRefresh} /><label>Fecha Inicial<input type="date" defaultValue="2026-09-18" /></label><label>Fecha Final<input type="date" defaultValue="2026-09-18" /></label><label>Estado<select defaultValue="Todas"><option>Todas</option><option>Pendiente</option><option>Aprobada</option><option>Rechazada</option></select></label><label>Cliente<span className="legacy-lookup-field"><input placeholder="Cliente..." /><button type="button">...</button></span></label></LegacySidePanel><LegacyDenseTable columns={["Nro.", "Fecha", "Cobrador", "Código", "Cliente", "Telefono", "Celular"]} rows={snapshot.clients.slice(0, 8).map((client, index) => { const collector = snapshot.collectors[index % Math.max(1, snapshot.collectors.length)]; return [index + 1, "18/09/2026", collector?.name ?? "Cobrador", client.code, client.name, client.phone, collector?.cellular ?? "809-000-0000"]; })} /></div>;
  if (page === "generalConfig") {
    const tabs = ["General", "Clientes", "Cargos y Descargos", "Cobros y Pagos", "Interfaz", "GPS"];
    const CheckLine = ({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) => <label className={`legacy-check-line ${disabled ? "disabled" : ""}`}><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
    const fld = (key: string) => ({
      value: String(systemCfg[key] ?? ""),
      onChange: (event: { target: { value: string } }) =>
        setSystemCfg((current) => ({ ...current, [key]: event.target.value })),
    });
    const chk = (key: string) => (value: boolean) =>
      setSystemCfg((current) => ({ ...current, [key]: value }));
    return (
      <div className="legacy-config-layout">
        <div className="legacy-config-main">
          <div className="legacy-tabs" role="tablist" aria-label="Configuracion General">
            {tabs.map((tab) => (
              <button type="button" key={tab} className={configTab === tab ? "active" : ""} onClick={() => setConfigTab(tab)}>{tab}</button>
            ))}
          </div>
          {configTab === "General" && (
            <fieldset className="legacy-config-fieldset">
              <legend>General</legend>
              <label>Empresa:<input {...fld("general.empresa")} /></label>
              <label>Dirección:<input {...fld("general.direccion")} /></label>
              <div className="legacy-config-row">
                <label>Teléfono:<input {...fld("general.telefono")} /></label>
                <label>Correo Electrónico:<input {...fld("general.correo")} /></label>
              </div>
              <label className="short-field">Fax:<input {...fld("general.fax")} /></label>
              <label className="short-field">Licencia:<input {...fld("general.licencia")} /></label>
              <label className="short-field">Moneda por defecto:
                <select {...fld("general.moneda")}>
                  <option>Peso Dominicano</option>
                  <option>Dólar Estadounidense</option>
                  <option>Euro</option>
                </select>
              </label>
            </fieldset>
          )}
          {configTab === "Clientes" && (
            <fieldset className="legacy-config-fieldset">
              <legend>Clientes</legend>
              <CheckLine label="Permitir Modificar Código de Cliente Nuevo" checked={Boolean(systemCfg["clientes.modificarCodigo"])} onChange={chk("clientes.modificarCodigo")} />
              <CheckLine label="Requerir Identificacion para Cliente" checked={Boolean(systemCfg["clientes.requerirIdentificacion"])} onChange={chk("clientes.requerirIdentificacion")} />
              <CheckLine label="Requerir Identificacion única para Cliente" checked={Boolean(systemCfg["clientes.identificacionUnica"])} onChange={chk("clientes.identificacionUnica")} />
            </fieldset>
          )}
          {configTab === "Cargos y Descargos" && (
            <fieldset className="legacy-config-fieldset">
              <legend>Cargos y Descargos</legend>
              <CheckLine label="Utilizar Importe de Concepto" checked={Boolean(systemCfg["cargos.importeConcepto"])} onChange={chk("cargos.importeConcepto")} />
              <CheckLine label="Permitir modificar importe de Concepto" checked={Boolean(systemCfg["cargos.modificarImporteConcepto"])} onChange={chk("cargos.modificarImporteConcepto")} />
              <div className="legacy-config-separator">--- Cargos ---</div>
              <CheckLine label="Permitir modificar precio en cargos" checked={Boolean(systemCfg["cargos.modificarPrecio"])} onChange={chk("cargos.modificarPrecio")} />
              <CheckLine label="Permitir modificar cantidad en cargos" checked={Boolean(systemCfg["cargos.modificarCantidad"])} onChange={chk("cargos.modificarCantidad")} />
              <CheckLine label="Permitir cargos en PCP" checked={Boolean(systemCfg["cargos.enPcp"])} onChange={chk("cargos.enPcp")} />
              <CheckLine label="Tragamonedas" checked={Boolean(systemCfg["cargos.tragamonedas"])} disabled onChange={chk("cargos.tragamonedas")} />
              <div className="legacy-config-row">
                <label>Servicio para TM:<select {...fld("cargos.servicioTm")}><option>MANEJO DE MAQUINITAS</option></select></label>
                <label>Concepto para TM:<select {...fld("cargos.conceptoTm")}><option value=""></option></select></label>
              </div>
              <div className="legacy-config-separator">--- Descargos ---</div>
              <CheckLine label="Permitir modificar cantidad en Descargos" checked={Boolean(systemCfg["descargos.modificarCantidad"])} onChange={chk("descargos.modificarCantidad")} />
            </fieldset>
          )}
          {configTab === "Cobros y Pagos" && (
            <fieldset className="legacy-config-fieldset">
              <legend>Cobros y Pagos</legend>
              <div className="legacy-config-two-col">
                <div>
                  <CheckLine label="Guardar GPS" checked={Boolean(systemCfg["cobros.guardarGps"])} onChange={chk("cobros.guardarGps")} />
                  <CheckLine label="Permitir Mezclar Servicios en Recibo" checked={Boolean(systemCfg["cobros.mezclarServiciosRecibo"])} onChange={chk("cobros.mezclarServiciosRecibo")} />
                  <CheckLine label="Permitir Cobros Parciales" checked={Boolean(systemCfg["cobros.cobrosParciales"])} onChange={chk("cobros.cobrosParciales")} />
                  <CheckLine label="Permitir Cobro con Saldo Pendiente (Para Cob.)" checked={Boolean(systemCfg["cobros.cobroSaldoPendiente"])} onChange={chk("cobros.cobroSaldoPendiente")} />
                  <CheckLine label="Obligar a Cobrar Clientes con Saldo Vencido (Para Clientes)" checked={Boolean(systemCfg["cobros.obligarVencidos"])} onChange={chk("cobros.obligarVencidos")} />
                </div>
                <label className="short-field">Porciento Mín. para chequeo de CDC:<input type="number" {...fld("cobros.porcientoCdc")} /></label>
              </div>
              <fieldset className="legacy-inner-fieldset">
                <legend>Impresión</legend>
                <div className="legacy-inner-tabs"><button type="button">Listados</button><button type="button" className="active">Recibos</button></div>
                <CheckLine label="Usar la misma Impresora de los Listados" checked={Boolean(systemCfg["impresion.mismaImpresora"])} onChange={chk("impresion.mismaImpresora")} />
                <CheckLine label="Imprimir Recibo en HTML" checked={Boolean(systemCfg["impresion.reciboHtml"])} onChange={chk("impresion.reciboHtml")} />
                <CheckLine label="Imprimir Recibo en Impresora de Matriz" checked={Boolean(systemCfg["impresion.reciboMatriz"])} onChange={chk("impresion.reciboMatriz")} />
                <CheckLine label="Imprimir Recibo en Impresora Virtual" checked={Boolean(systemCfg["impresion.reciboVirtual"])} onChange={chk("impresion.reciboVirtual")} />
                <div className="legacy-config-row url-port-row">
                  <label>URL:<input {...fld("impresion.url")} /></label>
                  <label>Puerto:<input {...fld("impresion.puerto")} /></label>
                </div>
                <label>Nombre:<input {...fld("impresion.nombre")} /></label>
              </fieldset>
            </fieldset>
          )}
          {configTab === "Interfaz" && (
            <fieldset className="legacy-config-fieldset">
              <legend>Interfaz</legend>
              <CheckLine label="Mostrar Monitor de Cobradores al Inicio" checked={Boolean(systemCfg["interfaz.monitorInicio"])} onChange={chk("interfaz.monitorInicio")} />
            </fieldset>
          )}
          {configTab === "GPS" && (
            <fieldset className="legacy-config-fieldset">
              <legend>GPS</legend>
              <div className="legacy-config-row">
                <label>Latitud:<input type="number" step="0.0000000000001" {...fld("gps.latitud")} /></label>
                <label>Longitud:<input type="number" step="0.0000000000001" {...fld("gps.longitud")} /></label>
              </div>
            </fieldset>
          )}
        </div>
        <aside className="legacy-config-actions">
          <button type="button" className="ok-button" disabled={cfgBusy} onClick={() => void saveSystemCfg()}>{cfgBusy ? "Guardando..." : "oK"}</button>
          <button type="button" disabled={cfgBusy} onClick={() => setSystemCfg(savedCfg)}>Cancelar</button>
        </aside>
      </div>
    );
  }
  return <div className="legacy-mdi-view">{baseToolbar()}<LegacyDenseTable columns={["Nro.", "Opcion", "Estado"]} rows={[[1, pageTitles[page], "Disponible"]]} /></div>;
}

function Login({
  onLogin,
}: {
  onLogin: (user: User, station: Station) => void;
}) {
  const [email, setEmail] = useState("admin@cyp.local"),
    [password, setPassword] = useState("Demo-CyP-2026!"),
    [busy, setBusy] = useState(false),
    [blockedCollector, setBlockedCollector] = useState(false),
    [error, setError] = useState("");
  async function login() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ token: string; user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      const next = enrichUserRole(result.user);
      if (isSuspendedUser(next))
        throw new Error("Cuenta o empresa suspendida.");
      if (normalizeRole(next.role) === "COLLECTOR") {
        setBlockedCollector(true);
        return;
      }
      if (!canAccessAdmin(next))
        throw new Error(
          "No tienes permisos para acceder al panel administrativo.",
        );
      setToken(result.token);
      onLogin(next, stations[0]);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "No pudimos iniciar sesión.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (blockedCollector)
    return (
      <div className="login-layout">
        <section className="login-form-side">
          <div className="login-form-inner blocked-access-card">
            <div className="login-card-brand">
              <Logo />
            </div>
            <h2>Acceso no autorizado</h2>
            <p className="inline-error" role="alert">
              Acceso no autorizado al panel administrativo. Ingrese desde la
              terminal móvil de cobrador.
            </p>
            <a
              className="btn primary full login-submit"
              href="http://127.0.0.1:5174"
            >
              Ir a la PWA del Cobrador <ArrowRight size={18} />
            </a>
            <button
              className="btn full"
              onClick={() => setBlockedCollector(false)}
            >
              Volver al login administrativo
            </button>
          </div>
        </section>
      </div>
    );
  return (
    <div className="login-layout">
      <section className="login-form-side">
        <div className="login-form-inner">
          <div className="login-card-brand">
            <Logo />
          </div>
          <h2>Cobros y Pagos</h2>
          <strong className="login-subtitle">
            Control Operativo y Cuadres
          </strong>
          <p>Ingrese sus credenciales para continuar.</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void login();
            }}
          >
            <label className="field">
              Usuario / Correo
              <input
                type="text"
                autoComplete="username"
                required
                placeholder="admin@cyp.local"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="field">
              Contraseña
              <input
                type="password"
                autoComplete="current-password"
                required
                minLength={8}
                placeholder="Tu contraseña"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error && (
              <div className="inline-error" role="alert">
                <CircleAlert size={17} />
                {error}
              </div>
            )}
            <button className="btn primary full login-submit" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <>
                  Iniciar Sesión
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          <div className="login-divider">
            <span>Credenciales de referencia</span>
          </div>
          <div className="demo-access-panel static-demo-access">
            <div>
              <div className="demo-role-action as-info">
                <ShieldCheck size={15} />
                <span>
                  <strong>Administrador</strong>
                  <small>admin@cyp.local · Demo-CyP-2026!</small>
                </span>
              </div>
              <a
                className="demo-role-action"
                href="http://127.0.0.1:5174"
                target="_blank"
                rel="noreferrer"
              >
                <Users size={15} />
                <span>
                  <strong>Acceso por red local (LAN)</strong>
                  <small>PWA Cobrador · http://127.0.0.1:5174</small>
                </span>
              </a>
            </div>
          </div>
          <p className="demo-disclaimer">
            La estación se asigna internamente como EST-01. Las credenciales
            demo requieren que el servidor tenga DEMO_MODE activo.
          </p>
        </div>
        <div className="login-bottom">
          <ShieldCheck size={14} /> Cobros y Pagos Móviles
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(!!getToken()),
    [user, setUser] = useState<User | null>(null),
    [station, setStation] = useState<Station>(() => stations[0]),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [initialError, setInitialError] = useState(""),
    [refreshing, setRefreshing] = useState(false),
    [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [page, setPage] = useState<Page>(pageFromHash),
    [collapsed, setCollapsed] = useState(false),
    [expandedGroups, setExpandedGroups] = useState<NavGroup[]>([
      "ARCHIVOS",
      "COBROS",
      "PAGOS",
      "REPORTES & MONITOREO",
    ]),
    [mobileMenu, setMobileMenu] = useState(false),
    [commandOpen, setCommandOpen] = useState(false),
    [commandQuery, setCommandQuery] = useState(""),
    [notificationsOpen, setNotificationsOpen] = useState(false),
    [helpOpen, setHelpOpen] = useState(false),
    [accountOpen, setAccountOpen] = useState(false),
    [activeNavKey, setActiveNavKey] = useState(""),
    [selectedCollector, setSelectedCollector] = useState<Collector | null>(
      null,
    ),
    [operation, setOperation] = useState<Operation | null>(null),
    [accountOperation, setAccountOperation] =
      useState<AccountOperation | null>(null),
    [directorySearch, setDirectorySearch] = useState(""),
    [settlementCollector, setSettlementCollector] = useState("");
  const [clock, setClock] = useState(() => new Date());
  const [mdiWindows, setMdiWindows] = useState<MdiWindowState[]>([]);
  const logout = useCallback(() => {
    clearToken();
    setAuthenticated(false);
    setSnapshot(null);
    setUser(null);
    setAccountOpen(false);
    setMdiWindows([]);
  }, []);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await api<Snapshot>("/snapshot");
      setSnapshot(result);
      setInitialError("");
      setLastUpdated(new Date());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        logout();
        return;
      }
      setInitialError(
        error instanceof Error
          ? error.message
          : "No se pudo conectar con el servidor.",
      );
    } finally {
      setRefreshing(false);
    }
  }, [logout]);
  useEffect(() => {
    if (!authenticated) return;
    api<User | { user: User }>("/auth/me")
      .then((result) => {
        const next = "user" in result ? result.user : result;
        const user = enrichUserRole(next);
        if (isSuspendedUser(user)) {
          logout();
          toast.error("Cuenta o empresa suspendida.");
        } else if (!canAccessAdmin(user)) {
          logout();
          toast.error(
            normalizeRole(user.role) === "COLLECTOR"
              ? "Acceso no autorizado al panel administrativo. Ingrese desde la terminal móvil de cobrador."
              : "Usa una cuenta autorizada para acceder a este portal.",
          );
        } else setUser(user);
      })
      .catch(() => logout());
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, 30000);
    return () => clearInterval(interval);
  }, [authenticated, refresh, logout]);
  useEffect(() => {
    const interval = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (user && normalizeRole(user.role) === "SUPERVISOR")
      setExpandedGroups(["REPORTES & MONITOREO"]);
  }, [user]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    const hashHandler = () => {
      setPage(pageFromHash());
      setActiveNavKey("");
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("hashchange", hashHandler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("hashchange", hashHandler);
    };
  }, []);
  function navigate(next: Page, navKey = "") {
    setPage(next);
    setActiveNavKey(navKey);
    location.hash = next;
    setMobileMenu(false);
    setCommandOpen(false);
    setNotificationsOpen(false);
    setDirectorySearch("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  const openMdiWindow = useCallback((next: MdiPage, navKey = "") => {
    setActiveNavKey(navKey);
    setMdiWindows((windows) => {
      const existing = windows.find((item) => item.page === next);
      const maxZ = Math.max(140, ...windows.map((item) => item.zIndex));
      if (existing)
        return windows.map((item) => item.id === existing.id ? { ...item, zIndex: maxZ + 1, isFocused: true } : { ...item, isFocused: false });
      const offset = windows.length * 26;
      const reportLauncher = next === "reports";
      const reportWindow = isReportPage(next);
      const wide = next === "traces" || next === "pcps" || next === "sessions" || next === "clients" || isMdiOperationPage(next) || isMdiMonitoringPage(next) || reportLauncher || reportWindow;
      const compact = next === "controlPanel";
      return [
        ...windows.map((item) => ({ ...item, isFocused: false })),
        {
          id: `${next}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
          page: next,
          title: mdiTitle(next),
          x: compact ? 180 : 118 + offset,
          y: compact ? 78 : 78 + offset,
          width: compact ? 600 : reportLauncher ? 720 : wide ? 860 : 720,
          height: compact ? 390 : reportLauncher ? 430 : wide ? 520 : 440,
          zIndex: maxZ + 1,
          isFocused: true,
        },
      ];
    });
  }, []);
  const focusMdiWindow = useCallback((id: string) => {
    setMdiWindows((windows) => {
      const maxZ = Math.max(140, ...windows.map((item) => item.zIndex));
      return windows.map((item) => item.id === id ? { ...item, zIndex: maxZ + 1, isFocused: true } : { ...item, isFocused: false });
    });
  }, []);
  const moveMdiWindow = useCallback((id: string, x: number, y: number) => {
    setMdiWindows((windows) => windows.map((item) => item.id === id ? { ...item, x, y } : item));
  }, []);
  const closeMdiWindow = useCallback((id: string) => {
    setMdiWindows((windows) => windows.filter((item) => item.id !== id));
  }, []);
  const createOperationForPage = useCallback((targetPage: Page): Operation => ({
    type:
      targetPage === "payouts" || targetPage === "payments"
        ? "payout"
        : targetPage === "recurringCharges"
          ? "recurring"
          : "charge",
  }), []);
  const activeNav = activeNavKey
    ? navigation.find((n) => n.key === activeNavKey)
    : undefined;
  const [auxWindow, setAuxWindow] = useState<
    null | "facturas" | "novedades" | "pagos"
  >(null);
  const downloadBackup = async () => {
    try {
      const data = await api<unknown>("/snapshot");
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cyp-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Copia de respaldo descargada");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo generar el respaldo.",
      );
    }
  };
  const alertCount = snapshot
    ? snapshot.collectors.filter((c) => c.status !== "active").length +
      (snapshot.totals.difference !== 0 ? 1 : 0)
    : 0;
  const commandClients =
    snapshot?.clients
      .filter((c) =>
        `${c.name} ${c.code}`
          .toLowerCase()
          .includes(commandQuery.toLowerCase()),
      )
      .slice(0, 6) ?? [];
  const commandRoutes =
    snapshot?.routes
      .filter((r) =>
        `${r.name} ${r.sector}`
          .toLowerCase()
          .includes(commandQuery.toLowerCase()),
      )
      .slice(0, 3) ?? [];
  const effectiveUser = user ?? enrichUserRole({ id: "UUID-AAA", name: "Administración", role: "ADMIN" });
  return (
    <>
      <Toaster position="top-right" richColors closeButton />
      {!authenticated ? (
        <Login
          onLogin={(user, nextStation) => {
            setUser(user);
            setStation(nextStation);
            setAuthenticated(true);
          }}
        />
      ) : (
        <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
          <a className="skip-link" href="#main-content">
            Saltar al contenido principal
          </a>
          {mobileMenu && (
            <button
              className="mobile-scrim"
              aria-label="Cerrar navegación"
              onClick={() => setMobileMenu(false)}
            />
          )}
          <aside className={`sidebar ${mobileMenu ? "mobile-open" : ""}`}>
            <div className="sidebar-brand">
              <Logo compact={collapsed} />
              <button
                className="sidebar-collapse icon-button"
                aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
                onClick={() => setCollapsed(!collapsed)}
              >
                <ChevronLeft size={17} className={collapsed ? "rotate" : ""} />
              </button>
            </div>
            <button
              className="workspace-switch"
              onClick={() => setAccountOpen(true)}
            >
              <span className="workspace-icon">
                <Wallet size={18} />
              </span>
              <span>
                <strong>Mi organización</strong>
                <small>Panel de administración</small>
              </span>
              <ChevronsUpDown size={15} />
            </button>
            <nav aria-label="Navegación principal">
              {groupOrder.map((group) => {
                const open = expandedGroups.includes(group) && !collapsed;
                const groupItems = navigation.filter(
                  (item) => item.group === group,
                );
                const groupActive = groupItems.some((item) =>
                  activeNavKey ? activeNavKey === item.key : false,
                );
                return (
                  <div
                    className={`nav-group ${open ? "open" : ""}`}
                    key={group}
                  >
                    <button
                      type="button"
                      className={`nav-group-trigger ${groupActive ? "active" : ""}`}
                      onClick={() => {
                        if (collapsed) {
                          setCollapsed(false);
                          setExpandedGroups([group]);
                          return;
                        }
                        setExpandedGroups((groups) =>
                          groups.includes(group)
                            ? groups.filter((item) => item !== group)
                            : [...groups, group],
                        );
                      }}
                      aria-expanded={open}
                    >
                      <span>{group}</span>
                      <ChevronDown size={14} />
                    </button>
                    <div className="nav-group-items" hidden={!open}>
                      {groupItems.map((item) => (
                        <button
                          className={`nav-item ${
                            activeNavKey
                              ? activeNavKey === item.key
                                ? "active"
                                : ""
                              : ""
                          }`}
                          key={item.key}
                          onClick={() => {
                            if (item.action === "controlPanel") {
                              openMdiWindow("controlPanel", item.key);
                              setMobileMenu(false);
                              return;
                            }
                            if (item.page) {
                              openMdiWindow(item.page, item.key);
                              setMobileMenu(false);
                            }
                          }}
                          title={collapsed ? item.label : undefined}
                          aria-current={
                            activeNavKey === item.key ? "page" : undefined
                          }
                        >
                          <item.icon size={18} />
                          <span>{item.label}</span>
                          {item.badge === "pendingCharges" && snapshot && (
                            <small>
                              {
                                snapshot.charges.filter(
                                  (c) => c.status === "pending",
                                ).length
                              }
                            </small>
                          )}
                          {activeNavKey === item.key && <i />}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </nav>
            <div className="sidebar-bottom">
              <div className="daily-note">
                <span className="daily-note-icon">
                  <ShieldCheck size={22} />
                </span>
                <strong>
                  Un buen día termina
                  <br />
                  en equilibrio.
                </strong>
                <p>
                  Revisa tus cuadres antes
                  <br />
                  de cerrar la jornada.
                </p>
                <button onClick={() => openMdiWindow("dailySettlements", "daily-settlements")}>
                  Ir al cuadre
                  <ArrowRight size={14} />
                </button>
              </div>
              <button
                className="nav-item help-button"
                onClick={() => setHelpOpen(true)}
              >
                <CircleHelp size={19} />
                <span>Centro de ayuda</span>
                <ArrowUpRight size={15} />
              </button>
              <div className="system-status">
                <span
                  className={`live-dot ${initialError ? "warning-dot" : ""}`}
                />
                <span>
                  {initialError ? "Conexión interrumpida" : "Sistema operativo"}
                </span>
                <small>v1.0</small>
              </div>
            </div>
          </aside>
          <div className="main-shell">
            <header className="topbar">
              <div className="operational-context">
                <button
                  className="icon-button mobile-menu-button"
                  aria-label="Abrir navegación"
                  onClick={() => setMobileMenu(true)}
                >
                  <Menu size={21} />
                </button>
                <span className="station-badge">
                  <strong>{station.code}</strong>
                  <span>{station.name}</span>
                </span>
                <div className="module-context">
                  <span>Módulo activo</span>
                  <strong>{activeNav?.label ?? "Escritorio"}</strong>
                </div>
              </div>
              <div className="topbar-actions">
                <span className="server-clock">
                  {clock.toLocaleDateString("es-DO", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}
                  <strong>
                    {clock.toLocaleTimeString("es-DO", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </strong>
                </span>
                <span className="status-badge">
                  {snapshot?.totals.activeCollectors ?? 0} cobradores en calle
                </span>
                <span
                  className={`status-badge ${
                    snapshot?.totals.difference ? "warning" : "ok"
                  }`}
                >
                  {snapshot?.totals.difference
                    ? "Cuadre en progreso"
                    : "Cuadre al día"}
                </span>
                <button
                  className="command-trigger"
                  onClick={() => setCommandOpen(true)}
                >
                  <Search size={16} />
                  <span>Buscar en tu operación…</span>
                  <kbd>⌘ K</kbd>
                </button>
                <span className="header-divider" />
                <button
                  className="icon-button notification-trigger"
                  aria-label={`Notificaciones, ${alertCount} pendientes`}
                  onClick={() => setNotificationsOpen(true)}
                >
                  <Bell size={19} />
                  {alertCount > 0 && <i />}
                </button>
                <button
                  className="icon-button"
                  aria-label="Facturas"
                  title="Ventana de Facturas"
                  onClick={() => setAuxWindow("facturas")}
                >
                  <ReceiptText size={19} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Qué hay de nuevo"
                  title="Qué hay de nuevo"
                  onClick={() => setAuxWindow("novedades")}
                >
                  <CircleHelp size={19} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Ventana de Pagos"
                  title="Ventana de Pagos"
                  onClick={() => setAuxWindow("pagos")}
                >
                  <Wallet size={19} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Hacer copia de respaldo"
                  title="Hacer copia de respaldo"
                  onClick={() => void downloadBackup()}
                >
                  <Database size={19} />
                </button>
                {auxWindow === "facturas" && snapshot && (
                  <LegacyDialog
                    title="Ventana de Facturas"
                    onClose={() => setAuxWindow(null)}
                  >
                    <div className="statement-body">
                      <LegacyDenseTable
                        columns={["Fecha", "Cliente", "Importe", "Recibo"]}
                        rows={snapshot.movements
                          .filter((m) => m.type === "collection")
                          .slice(-15)
                          .reverse()
                          .map((m) => [
                            safeDateLabel(m.createdAt.slice(0, 10)),
                            snapshot.clients.find((c) => c.id === m.clientId)?.name ?? "—",
                            money(m.amount),
                            m.receiptToken ?? "—",
                          ])}
                      />
                    </div>
                  </LegacyDialog>
                )}
                {auxWindow === "novedades" && snapshot && (
                  <LegacyDialog
                    title="Qué hay de nuevo"
                    onClose={() => setAuxWindow(null)}
                  >
                    <div className="statement-body">
                      <p className="statement-meta">
                        CyP Modern — novedades frente al sistema original
                      </p>
                      <ul className="novedades-list">
                        <li>Versión modernizada: API Fastify, portal administrativo y PWA de cobrador.</li>
                        <li>Moneda única DOP con importes en centavos exactos.</li>
                        <li>Aceptar/Cancelar depósitos y Descargos Recurrentes.</li>
                        <li>Importación masiva de Cargos y Descargos desde CSV.</li>
                        <li>Estado de cuenta por cliente (Cobros y Pagos del Cliente).</li>
                        <li>Configuración General persistente y reportes de Pagos del legacy.</li>
                      </ul>
                    </div>
                  </LegacyDialog>
                )}
                {auxWindow === "pagos" && snapshot && (
                  <LegacyDialog
                    title="Ventana de Pagos"
                    onClose={() => setAuxWindow(null)}
                  >
                    <div className="statement-body">
                      <h3>Autorizaciones pendientes</h3>
                      <LegacyDenseTable
                        columns={["Cliente", "Concepto", "Autorizado", "Pagado", "Estado"]}
                        rows={snapshot.payouts
                          .filter((p) => p.status !== "cancelled" && p.paid < p.amount)
                          .map((p) => [
                            snapshot.clients.find((c) => c.id === p.clientId)?.name ?? "—",
                            p.concept,
                            money(p.amount),
                            money(p.paid),
                            p.status,
                          ])}
                      />
                      <h3>Últimos pagos</h3>
                      <LegacyDenseTable
                        columns={["Fecha", "Cliente", "Importe"]}
                        rows={snapshot.movements
                          .filter((m) => m.type === "payout")
                          .slice(-10)
                          .reverse()
                          .map((m) => [
                            safeDateLabel(m.createdAt.slice(0, 10)),
                            snapshot.clients.find((c) => c.id === m.clientId)?.name ?? "—",
                            money(m.amount),
                          ])}
                      />
                    </div>
                  </LegacyDialog>
                )}
                <button
                  className="profile-button"
                  onClick={() => setAccountOpen(true)}
                  aria-label="Abrir cuenta"
                >
                  <Avatar name={user?.name ?? "Administración"} index={3} />
                  <span className="user-chip-copy">
                    <strong>{user?.name ?? "Administración"}</strong>
                    <small>
                      {user ? normalizeRole(user.role) : "ADMIN"} · v1.0
                    </small>
                  </span>
                  <ChevronDown size={13} />
                </button>
              </div>
            </header>
            <main id="main-content" className="main-content desktop-canvas" tabIndex={-1}>
          {snapshot && mdiWindows.map((windowState) => (
            <MdiWindow
              key={windowState.id}
              windowState={windowState}
              onClose={closeMdiWindow}
              onFocus={focusMdiWindow}
              onMove={moveMdiWindow}
            >
              {windowState.page === "controlPanel" ? (
                <ControlPanelContent onLaunch={openMdiWindow} />
              ) : windowState.page === "reports" ? (
                <ReportesLauncher onLaunch={openMdiWindow} />
              ) : isReportPage(windowState.page) ? (
                <ReportView page={windowState.page} snapshot={snapshot} />
              ) : windowState.page === "clients" ? (
                <MasterDataView
                  page="clients"
                  snapshot={snapshot}
                  currentUser={effectiveUser}
                  onCollector={setSelectedCollector}
                  onRefresh={() => void refresh()}
                  onAccount={setAccountOperation}
                />
              ) : isMdiOperationPage(windowState.page) ? (
                (() => {
                  const operationPage = windowState.page;
                  return (
                    <LegacyOperationView
                      spec={operationSpec(operationPage, snapshot)}
                      currentUser={effectiveUser}
                      snapshot={snapshot}
                      onCreate={() => setOperation(createOperationForPage(operationPage))}
                      onRefresh={() => void refresh()}
                    />
                  );
                })()
              ) : isMdiMonitoringPage(windowState.page) ? (
                windowState.page === "dailySettlements" ? (
                  <DailySettlementsView snapshot={snapshot} onRefresh={() => void refresh()} />
                ) : (
                  <MonitorView
                    page={windowState.page}
                    snapshot={snapshot}
                    refreshing={refreshing}
                    currentUser={effectiveUser}
                    onRefresh={() => void refresh()}
                  />
                )
              ) : (
                <LegacyCodifierView
                  page={windowState.page}
                  snapshot={snapshot}
                  onRefresh={() => void refresh()}
                  onAccount={setAccountOperation}
                />
              )}
            </MdiWindow>
          ))}
            </main>
          </div>
          <Modal
            open={commandOpen}
            onClose={() => setCommandOpen(false)}
            title="Encuentra lo que necesitas"
            description="Busca clientes o rutas. Atajo de teclado: Control o Comando + K."
            className="command-dialog"
          >
            <label className="command-input">
              <Search size={21} />
              <input
                autoFocus
                placeholder="Nombre de cliente, código o ruta…"
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.target.value)}
              />
              {commandQuery && (
                <button
                  className="icon-button small"
                  aria-label="Limpiar búsqueda"
                  onClick={() => setCommandQuery("")}
                >
                  <X size={16} />
                </button>
              )}
            </label>
            <div className="command-results">
              {commandClients.length > 0 && (
                <span className="command-group-label">CLIENTES</span>
              )}
              {commandClients.map((client) => (
                <button
                  key={client.id}
                  onClick={() => {
                    openMdiWindow("clients", "clients");
                    setDirectorySearch(client.name);
                    setCommandOpen(false);
                  }}
                >
                  <Avatar name={client.name} />
                  <span>
                    <strong>{client.name}</strong>
                    <small>{client.code}</small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
              {commandRoutes.length > 0 && (
                <span className="command-group-label">RUTAS</span>
              )}
              {commandRoutes.map((route) => (
                <button
                  key={route.id}
                  onClick={() => {
                    openMdiWindow("routes", "control-routes");
                    const collector = snapshot?.collectors.find(
                      (c) => c.id === route.collectorId,
                    );
                    if (collector) setSelectedCollector(collector);
                    setCommandOpen(false);
                  }}
                >
                  <span className="command-route-icon">
                    <MapPinned size={19} />
                  </span>
                  <span>
                    <strong>{route.name}</strong>
                    <small>{route.sector}</small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
              {commandClients.length === 0 && commandRoutes.length === 0 && (
                <Empty
                  title="No encontramos coincidencias"
                  text="Intenta con otro nombre, código de cliente o ruta."
                />
              )}
            </div>
          </Modal>
          <Modal
            open={notificationsOpen}
            onClose={() => setNotificationsOpen(false)}
            title="Tu operación al día"
            description="Atiende lo que necesita una mirada más cercana."
            sheet
          >
            {snapshot && (
              <div className="notifications">
                {snapshot.totals.difference !== 0 && (
                  <button onClick={() => openMdiWindow("dailySettlements", "daily-settlements")}>
                    <span className="notification-icon amber">
                      <FileCheck2 size={20} />
                    </span>
                    <span>
                      <strong>Hay efectivo pendiente de cuadre</strong>
                      <p>
                        {money(snapshot.totals.difference)} por conciliar antes
                        del cierre.
                      </p>
                      <small>
                        Revisar cuadre diario
                        <ArrowRight size={12} />
                      </small>
                    </span>
                  </button>
                )}
                {snapshot.collectors
                  .filter((c) => c.status !== "active")
                  .map((collector) => (
                    <button
                      key={collector.id}
                      onClick={() => {
                        setNotificationsOpen(false);
                        setSelectedCollector(collector);
                      }}
                    >
                      <span className="notification-icon">
                        <MapPinned size={20} />
                      </span>
                      <span>
                        <strong>{collector.name}</strong>
                        <p>
                          {collector.status === "offline"
                            ? "Su última ubicación no está actualizada."
                            : "Su exposición alcanzó un límite autorizado."}
                        </p>
                        <small>
                          Ver detalle
                          <ArrowRight size={12} />
                        </small>
                      </span>
                    </button>
                  ))}
                {!alertCount && (
                  <Empty
                    title="Todo está bajo control"
                    text="No hay alertas operativas pendientes en este momento."
                  />
                )}
                <div className="notification-foot">
                  <ShieldCheck size={17} />
                  Las alertas se calculan con los últimos datos disponibles.
                </div>
              </div>
            )}
          </Modal>
          <Modal
            open={helpOpen}
            onClose={() => setHelpOpen(false)}
            title="Siempre en control"
            description="Guía rápida de los procesos operativos."
          >
            <div className="help-content">
              {[
                {
                  icon: ReceiptText,
                  title: "Cargos y cargos recurrentes",
                  text: "Registra cargos simples o genera cargos recurrentes mensuales por servicio, marcando si son obligados a cobrar y si el monto es fijo o editable.",
                },
                {
                  icon: Wallet,
                  title: "Descargos, remesas y entrega de dinero",
                  text: "Autoriza tickets de pago al beneficiario y registra el efectivo entregado al cobrador para realizar pagos en calle.",
                },
                {
                  icon: FileCheck2,
                  title: "Cuadre Diario (Arqueo)",
                  text: "Cobrado − Depositado + Entregado − Pagado = Dinero en Mano. La diferencia debe cerrar en cero y respeta LimiteCobro y LimitePago.",
                },
              ].map((item) => (
                <div key={item.title}>
                  <item.icon size={23} />
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.text}</p>
                  </div>
                </div>
              ))}
              <p className="help-demo">
                Los datos de esta demostración son ficticios. Cada operación
                requiere conexión con el servidor.
              </p>
            </div>
          </Modal>
          <Modal
            open={accountOpen}
            onClose={() => setAccountOpen(false)}
            title="Tu espacio de trabajo"
            description="Administración de Cobros y Pagos."
          >
            <div className="account-profile">
              <Avatar
                name={user?.name ?? "Administración"}
                size="avatar-xl"
                index={3}
              />
              <h3>{user?.name ?? "Administración"}</h3>
              <Badge status="active">Administrador</Badge>
              <p>
                Acceso a clientes, rutas, autorizaciones, movimientos y cierres
                diarios.
              </p>
              <button className="btn full" onClick={logout}>
                <LogOut size={17} />
                Cerrar sesión
              </button>
            </div>
          </Modal>
          {snapshot && (
            <>
              <CollectorDrawer
                collector={
                  selectedCollector
                    ? (snapshot.collectors.find(
                        (c) => c.id === selectedCollector.id,
                      ) ?? null)
                    : null
                }
                snapshot={snapshot}
                onClose={() => setSelectedCollector(null)}
                onSettle={(id) => {
                  setSelectedCollector(null);
                  setSettlementCollector(id);
                  openMdiWindow("dailySettlements", "daily-settlements");
                }}
              />
              <OperationModal
                operation={operation}
                snapshot={snapshot}
                onClose={() => setOperation(null)}
                onComplete={refresh}
              />
              <AccountModal
                operation={accountOperation}
                snapshot={snapshot}
                onClose={() => setAccountOperation(null)}
                onComplete={refresh}
              />
            </>
          )}
        </div>
      )}
    </>
  );
}

type TableRow = Record<string, unknown> & {
  __id?: string;
  __entity?: string;
  __date?: string;
  __status?: string;
  __amount?: number;
  __raw?: Record<string, unknown>;
};
type LegacyColumn = { key: string; label: string; align?: "right" | "center" };

type OperationSpec = {
  title: string;
  subtitle: string;
  filterTitle: string;
  modes: string[];
  columns: LegacyColumn[];
  rows: TableRow[];
  footer: { label: string; value: ReactNode }[];
  entity?: string;
  relationLabel?: string;
  details?: ReactNode;
};

type MonitorEntity = "collector" | "zone" | "route";
type MonitorRow = TableRow & {
  entityId: string;
  entityType: MonitorEntity;
  rawName: string;
  name: ReactNode;
  collectionLimit: ReactNode;
  payoutLimit: ReactNode;
  collected: ReactNode;
  deposited: ReactNode;
  delivered: ReactNode;
  paid: ReactNode;
  difference: ReactNode;
};
type MapData = {
  collector: {
    id: string;
    name: string;
    phone: string;
    lat: number;
    lng: number;
    cash_in_hand: number;
    collection_limit: number;
    payout_limit: number;
    last_ping: string;
  };
  stops: {
    id: string;
    order: number;
    client_name: string;
    lat: number;
    lng: number;
    amount_due: number;
    status: "pending" | "partial" | "paid" | "cancelled" | string;
    obligated: boolean;
  }[];
  route_geometry: null | unknown;
};

function ModuleRouter({
  page,
  snapshot,
  refreshing,
  currentUser,
  onRefresh,
  onCollector,
  onOperation,
  onAccount,
}: {
  page: Page;
  snapshot: Snapshot;
  refreshing: boolean;
  currentUser: User;
  onRefresh: () => void;
  onCollector: (collector: Collector) => void;
  onOperation: (operation: Operation) => void;
  onAccount: (operation: AccountOperation) => void;
}) {
  if (
    [
      "collectors",
      "clients",
      "routesZones",
      "servicesProducts",
      "delayReasons",
      "exchangeRates",
      "users",
    ].includes(page)
  )
    return (
      <MasterDataView
        page={page}
        snapshot={snapshot}
        currentUser={currentUser}
        onCollector={onCollector}
        onRefresh={onRefresh}
        onAccount={onAccount}
      />
    );
  if (
    [
      "charges",
      "recurringCharges",
      "recurringPayouts",
      "collections",
      "deposits",
      "payouts",
      "payments",
      "cashDeliveries",
    ].includes(page)
  )
    return (
      <LegacyOperationView
        spec={operationSpec(page, snapshot)}
        currentUser={currentUser}
        snapshot={snapshot}
        onCreate={() =>
          onOperation({
            type:
              page === "payouts" || page === "payments"
                ? "payout"
                : page === "recurringCharges"
                  ? "recurring"
                  : "charge",
          })
        }
        onRefresh={onRefresh}
      />
    );
  if (["monitorCollectors", "monitorZones", "monitorRoutes"].includes(page))
    return (
      <MonitorView
        page={page}
        snapshot={snapshot}
        refreshing={refreshing}
        currentUser={currentUser}
        onRefresh={onRefresh}
      />
    );
  if (page === "dailySettlements")
    return <DailySettlementsView snapshot={snapshot} onRefresh={onRefresh} />;
  return <ReportsView />;
}

function MasterDataView({
  page,
  snapshot,
  currentUser,
  onCollector,
  onRefresh,
  onAccount,
}: {
  page: Page;
  snapshot: Snapshot;
  currentUser: User;
  onCollector: (collector: Collector) => void;
  onRefresh: () => void;
  onAccount: (operation: AccountOperation) => void;
}) {
  const [search, setSearch] = useState("");
  const [quickRecord, setQuickRecord] = useState<TableRow | "new" | null>(null);
  const [collectorEditor, setCollectorEditor] = useState<TableRow | "new" | null>(null);
  const [collectorFlow, setCollectorFlow] = useState<"zones" | "limits" | "routes" | null>(null);
  const [selectedCollectorId, setSelectedCollectorId] = useState(snapshot.collectors[0]?.id ?? "");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [statement, setStatement] = useState<ClientStatement | null>(null);
  const config = masterSpec(page, snapshot, onAccount);
  const permissions = permissionsFor(currentUser);
  const rows = config.rows.filter((row) =>
    Object.values(row).join(" ").toLowerCase().includes(search.toLowerCase()),
  );
  const entity = page === "clients" ? "clients" : page;
  const openStatement = async (clientId: string) => {
    if (!clientId) return;
    try {
      const data = await api<ClientStatement>(
        `/clientes/${encodeURIComponent(clientId)}/estado`,
      );
      setStatement(data);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo cargar el estado de cuenta.",
      );
    }
  };
  const deleteRow = async (row: TableRow) => {
    if (!["clients", "collectors"].includes(page) || !row.__id) {
      toast.info("Esta vista est� en modo lectura para el mock frontend.");
      return;
    }
    const label = page === "collectors" ? "cobrador" : "cliente";
    const endpoint = page === "collectors" ? "collectors" : "clients";
    if (
      permissions.deleteNeedsConfirm &&
      !confirm(`Confirma la eliminaci�n de este ${label}.`)
    )
      return;
    await api(`/mock/admin/${endpoint}/${encodeURIComponent(row.__id)}`, {
      method: "DELETE",
    });
    toast.success(`${label[0].toUpperCase()}${label.slice(1)} eliminado`);
    if (page === "collectors") setSelectedCollectorId("");
    onRefresh();
  };
  return (
    <>
      <div className="page-title compact-title">
        <div>
          <div className="eyebrow">ARCHIVOS BASE</div>
          <h1>
            {config.title}
            <span className="title-dot">.</span>
          </h1>
          <p>{config.subtitle}</p>
        </div>
        <button
          className="btn primary"
          disabled={!permissions.canCreate}
          title={permissions.canCreate ? "Nuevo registro" : permissions.readOnlyReason}
          onClick={() =>
            page === "clients"
              ? setQuickRecord("new")
              : page === "collectors"
                ? setCollectorEditor("new")
                : page === "users"
                  ? onAccount({ type: "create" })
                  : toast.info("Vista de lectura preparada para mock frontend.")
          }
        >
          <Plus size={16} />
          Nuevo registro
        </button>
      </div>
      <section className="panel legacy-list-panel">
        <div className="table-toolbar legacy-toolbar">
          <label className="table-search">
            <Search size={17} />
            <input
              aria-label={`Buscar en ${config.title}`}
              placeholder="Buscar por nombre, código o estado..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {page === "collectors" && (
            <div className="legacy-mini-toolbar" aria-label="Acciones de cobradores">
              <button className="btn" disabled={!permissions.canCreate} title={permissions.canCreate ? "Nuevo cobrador" : permissions.readOnlyReason} onClick={() => setCollectorEditor("new")}><Plus size={15} /> Nuevo</button>
              <button className="btn" disabled={!permissions.canEdit || !selectedCollectorId} title={permissions.canEdit ? "Editar cobrador" : permissions.readOnlyReason} onClick={() => {
                const row = rows.find((item) => item.__id === selectedCollectorId);
                if (row) setCollectorEditor(row);
              }}><Pencil size={15} /> Editar</button>
              <button className="btn" disabled={!permissions.canDelete || !selectedCollectorId} title={permissions.canDelete ? "Eliminar cobrador" : permissions.readOnlyReason} onClick={async () => {
                if (permissions.deleteNeedsConfirm && !confirm("Confirma la eliminación de este cobrador.")) return;
                await api(`/mock/admin/collectors/${encodeURIComponent(selectedCollectorId)}`, { method: "DELETE" });
                toast.success("Cobrador eliminado");
                await onRefresh();
              }}><Trash2 size={15} /> Eliminar</button>
              <button className="btn" disabled={!selectedCollectorId} onClick={() => setCollectorFlow("zones")}>[Z]</button>
              <button className="btn" disabled={!selectedCollectorId} onClick={() => setCollectorFlow("limits")}>[L]</button>
              <button className="btn" disabled={!selectedCollectorId} onClick={() => setCollectorFlow("routes")}>[R]</button>
            </div>
          )}
          {page === "clients" && (
            <button
              className="btn"
              disabled={!selectedClientId}
              title="Cobros y Pagos del Cliente"
              onClick={() => void openStatement(selectedClientId)}
            >
              <ReceiptText size={16} /> Cobros y Pagos del Cliente
            </button>
          )}
          <button
            className="btn"
            onClick={() => {
              setSearch("");
              onRefresh();
            }}
          >
            <RefreshCw size={16} /> Refrescar
          </button>
          <button className="btn">
            <Download size={16} /> Exportar
          </button>
        </div>
        <LegacyTable
          columns={config.columns}
          rows={rows}
          permissions={permissions}
          selectedRowId={
            page === "collectors"
              ? selectedCollectorId
              : page === "clients"
                ? selectedClientId || undefined
                : undefined
          }
          onSelect={(row) => {
            if (!row.__id) return;
            if (page === "collectors") setSelectedCollectorId(row.__id);
            if (page === "clients") setSelectedClientId(String(row.__id));
          }}
          onEdit={(row) =>
            page === "clients"
              ? setQuickRecord(row)
              : page === "collectors"
                ? setCollectorEditor(row)
                : toast.info("Vista de lectura preparada para mock frontend.")
          }
          onDelete={deleteRow}
        />
        <div className="legacy-footerbar">
          <span>Cantidad</span>
          <strong>{rows.length}</strong>
          {page === "collectors" && (
            <button
              className="text-button"
              onClick={() => onCollector(snapshot.collectors[0])}
            >
              Ver ficha del primer cobrador
            </button>
          )}
        </div>
      </section>
      {quickRecord && page === "clients" && (
        <QuickRecordModal
          entity={entity}
          row={quickRecord === "new" ? null : quickRecord}
          snapshot={snapshot}
          onClose={() => setQuickRecord(null)}
          onSaved={async () => {
            setQuickRecord(null);
            await onRefresh();
          }}
        />
      )}
      {statement && page === "clients" && (
        <LegacyDialog
          title={`Cobros y Pagos del Cliente - ${statement.client.name}`}
          onClose={() => setStatement(null)}
          className="legacy-dialog-wide"
        >
          <div className="statement-body">
            <p className="statement-meta">
              Código: {statement.client.code} · Identif.: {statement.client.id}
            </p>
            <h3>Cargos</h3>
            <LegacyDenseTable
              columns={["Fecha", "Servicio", "Importe", "Cobrado", "Pendiente", "Estado"]}
              rows={statement.cargos.map((c) => [
                safeDateLabel(c.dueDate),
                c.service,
                money(c.amount),
                money(c.collected),
                money(Math.max(0, c.amount - c.collected)),
                c.status,
              ])}
            />
            <h3>Cobros</h3>
            <LegacyDenseTable
              columns={["Fecha", "Importe"]}
              rows={statement.cobros.map((m) => [
                safeDateLabel(m.createdAt.slice(0, 10)),
                money(m.amount),
              ])}
            />
            <h3>Autorizaciones (descargos)</h3>
            <LegacyDenseTable
              columns={["Concepto", "Autorizado", "Pagado", "Estado"]}
              rows={statement.autorizaciones.map((p) => [
                p.concept,
                money(p.amount),
                money(p.paid),
                p.status,
              ])}
            />
            <h3>Pagos al cliente</h3>
            <LegacyDenseTable
              columns={["Fecha", "Importe"]}
              rows={statement.pagos.map((m) => [
                safeDateLabel(m.createdAt.slice(0, 10)),
                money(m.amount),
              ])}
            />
            <div className="legacy-footerbar">
              <span>Cargado: <strong>{money(statement.resumen.totalCargado)}</strong></span>
              <span>Cobrado: <strong>{money(statement.resumen.totalCobrado)}</strong></span>
              <span>Pendiente: <strong>{money(statement.resumen.totalPendiente)}</strong></span>
              <span>Autorizado: <strong>{money(statement.resumen.totalAutorizado)}</strong></span>
              <span>Pagado: <strong>{money(statement.resumen.totalPagadoACliente)}</strong></span>
            </div>
          </div>
        </LegacyDialog>
      )}
      {collectorEditor && page === "collectors" && (
        <CollectorDataModal
          row={collectorEditor === "new" ? null : collectorEditor}
          snapshot={snapshot}
          onClose={() => setCollectorEditor(null)}
          onSaved={async () => {
            setCollectorEditor(null);
            await onRefresh();
          }}
        />
      )}
      {collectorFlow && selectedCollectorId && (
        <CollectorSubflowModal
          flow={collectorFlow}
          collector={snapshot.collectors.find((item) => item.id === selectedCollectorId) ?? snapshot.collectors[0]}
          snapshot={snapshot}
          onClose={() => setCollectorFlow(null)}
          onSaved={async () => {
            await onRefresh();
          }}
        />
      )}
    </>
  );
}

const DENOMS = [2000, 1000, 500, 200, 100, 50, 20, 10, 5, 1];

function LegacyOperationView({
  spec,
  snapshot,
  currentUser,
  onCreate,
  onRefresh,
}: {
  spec: OperationSpec;
  snapshot: Snapshot;
  currentUser: User;
  onCreate: () => void;
  onRefresh: () => void;
}) {
  const [mode, setMode] = useState(spec.modes[0] ?? "Todos"),
    [status, setStatus] = useState("Todos"),
    [query, setQuery] = useState(""),
    [fromDate, setFromDate] = useState("2026-09-01"),
    [toDate, setToDate] = useState("2026-09-16"),
    [quickRecord, setQuickRecord] = useState<TableRow | "new" | null>(null),
    [flash, setFlash] = useState(false),
    [selectedRow, setSelectedRow] = useState<TableRow | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [importFilas, setImportFilas] = useState<
    Record<string, unknown>[] | null
  >(null);
  const canImport = spec.entity === "charges" || spec.entity === "payouts";
  const [acceptTarget, setAcceptTarget] = useState<TableRow | null>(null);
  const [denoms, setDenoms] = useState<Record<number, string>>({});
  const denomsTotal = Object.entries(denoms).reduce(
    (sum, [d, q]) => sum + Number(d) * (Number(q) || 0),
    0,
  );
  const [recurringModal, setRecurringModal] = useState<
    TableRow | "new" | null
  >(null);
  const permissions = permissionsFor(currentUser);
  const rows = spec.rows.filter((row) => {
    const haystack =
      `${row.__id ?? ""} ${row.__status ?? ""} ${Object.values(row).join(" ")}`.toLowerCase();
    const dateOk =
      !row.__date ||
      ((!fromDate || row.__date >= fromDate) &&
        (!toDate || row.__date <= toDate));
    const statusOk =
      status === "Todos" ||
      String(row.__status ?? haystack)
        .toLowerCase()
        .includes(status.toLowerCase());
    const modeOk =
      mode === "Todos" ||
      haystack.includes(mode.replace("Por ", "").toLowerCase());
    return (
      haystack.includes(query.toLowerCase()) && dateOk && statusOk && modeOk
    );
  });
  const footer = [
    { label: "Cantidad", value: rows.length },
    {
      label: "Total",
      value: money(
        rows.reduce((sum, row) => sum + Number(row.__amount ?? 0), 0),
      ),
    },
    {
      label: "Pendiente",
      value: money(
        rows
          .filter((row) => row.__status !== "paid")
          .reduce((sum, row) => sum + Number(row.__amount ?? 0), 0),
      ),
    },
    {
      label: "Cobrado",
      value: money(
        rows
          .filter((row) => row.__status === "paid")
          .reduce((sum, row) => sum + Number(row.__amount ?? 0), 0),
      ),
    },
  ];
  const resetFilters = () => {
    setMode(spec.modes[0] ?? "Todos");
    setStatus("Todos");
    setQuery("");
    setFromDate("2026-09-01");
    setToDate("2026-09-16");
    setSelectedRow(null);
    setFlash(true);
    setTimeout(() => setFlash(false), 280);
    onRefresh();
  };
  const deleteRow = async (row: TableRow) => {
    if (!row.__id || !spec.entity) return;
    if (
      permissions.deleteNeedsConfirm &&
      !confirm("Confirma la eliminación de este registro.")
    )
      return;
    await api(`/mock/admin/${spec.entity}/${encodeURIComponent(row.__id)}`, {
      method: "DELETE",
    });
    toast.success("Registro eliminado");
    onRefresh();
  };
  const depositAction = async (
    row: TableRow,
    action: "aceptar" | "cancelar",
    desglose?: { denominacion: number; cantidad: number }[],
  ) => {
    if (!row.__id) return;
    try {
      await api(
        `/depositos/${encodeURIComponent(String(row.__id))}/${action}`,
        {
          method: "POST",
          body: JSON.stringify(
            action === "aceptar" && desglose?.length ? { desglose } : {},
          ),
        },
      );
      toast.success(
        action === "aceptar" ? "Depósito aceptado" : "Depósito cancelado",
      );
      setSelectedRow(null);
      onRefresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo completar.",
      );
    }
  };
  const onImportFile = async (file: File) => {
    const text = await file.text();
    const { filas } = parseImportCsv(
      text,
      spec.entity === "payouts" ? "payouts" : "charges",
    );
    setImportFilas(filas.length ? filas : null);
    toast.success(
      filas.length
        ? `${filas.length} fila(s) lista(s) para importar.`
        : "El archivo no contiene filas válidas.",
    );
  };
  const runImport = async () => {
    if (!importFilas?.length || !spec.entity) return;
    try {
      const result = await api<{
        creados: number;
        errores: { fila: number; mensaje: string }[];
      }>(spec.entity === "payouts" ? "/descargos/importar" : "/cargos/importar", {
        method: "POST",
        body: JSON.stringify({ filas: importFilas }),
      });
      toast.success(
        `Importación: ${result.creados} creada(s), ${result.errores.length} con error.`,
      );
      for (const e of result.errores.slice(0, 5))
        toast.error(`Fila ${e.fila}: ${e.mensaje}`);
      setImportFilas(null);
      onRefresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "La importación falló.",
      );
    }
  };
  return (
    <>
      <div className="page-title compact-title">
        <div>
          <div className="eyebrow">PROCESOS OPERATIVOS</div>
          <h1>
            {spec.title}
            <span className="title-dot">.</span>
          </h1>
          <p>{spec.subtitle}</p>
        </div>
      </div>
      <section
        className={`legacy-workspace ${spec.details ? "with-details" : ""} ${flash ? "refresh-flash" : ""}`}
      >
        <aside className="legacy-filter-panel" aria-label="Panel de filtro">
          <h2>{spec.filterTitle}</h2>
          <fieldset>
            <legend>Filtrar por</legend>
            {spec.modes.map((item) => (
              <label key={item}>
                <input
                  type="radio"
                  name="legacy-filter-mode"
                  checked={mode === item}
                  onChange={() => setMode(item)}
                />
                {item}
              </label>
            ))}
          </fieldset>
          <label className="field compact-field">
            Fecha Inicial
            <input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
            />
          </label>
          <label className="field compact-field">
            Fecha Final
            <input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
            />
          </label>
          <label className="field compact-field">
            Estado
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option>Todos</option>
              <option>pending</option>
              <option>partial</option>
              <option>paid</option>
              <option>Activo</option>
              <option>Cancelado</option>
            </select>
          </label>
          {spec.relationLabel && (
            <label className="field compact-field">
              {spec.relationLabel}
              <select>
                <option>Todas</option>
                <option>Con relación</option>
                <option>Sin relación</option>
              </select>
            </label>
          )}
        </aside>
        <div className="legacy-grid-panel">
          <div className="legacy-icon-toolbar" aria-label="Acciones">
            <button
              title={
                permissions.canCreate ? "Nuevo" : permissions.readOnlyReason
              }
              disabled={!permissions.canCreate}
              onClick={() =>
                spec.entity === "recurringPayouts"
                  ? setRecurringModal("new")
                  : setQuickRecord("new")
              }
            >
              <Plus size={16} />
            </button>
            <button title="Refrescar" onClick={resetFilters}>
              <RefreshCw size={16} />
            </button>
            <button
              title="Nuevo asistido"
              disabled={!permissions.canCreate}
              onClick={onCreate}
            >
              <Command size={16} />
            </button>
            <button title="Exportar">
              <Download size={16} />
            </button>
            {spec.entity === "deposits" && (
              <>
                <button
                  title="Aceptar depósito"
                  disabled={!selectedRow}
                  onClick={() => selectedRow && setAcceptTarget(selectedRow)}
                >
                  <ClipboardCheck size={16} />
                </button>
                <button
                  title="Cancelar depósito"
                  disabled={!selectedRow}
                  onClick={() =>
                    selectedRow && depositAction(selectedRow, "cancelar")
                  }
                >
                  <X size={16} />
                </button>
              </>
            )}
            {["collections", "deposits"].includes(String(spec.entity)) && (
              <button title="Imprimir" onClick={() => window.print()}>
                <Printer size={16} />
              </button>
            )}
            {canImport && (
              <>
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".csv,text/csv"
                  style={{ display: "none" }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void onImportFile(file);
                  }}
                />
                <button
                  title="Subir archivo"
                  disabled={!permissions.canCreate}
                  onClick={() => importFileRef.current?.click()}
                >
                  <FolderOpen size={16} />
                </button>
                <button
                  title="Importar datos"
                  disabled={!importFilas || !permissions.canCreate}
                  onClick={() => void runImport()}
                >
                  <FileCheck2 size={16} />
                </button>
              </>
            )}
            {spec.entity === "recurringPayouts" && (
              <button
                title="Archivar descargo recurrente"
                disabled={!selectedRow}
                onClick={() => {
                  if (!selectedRow?.__id) return;
                  void api(
                    `/descargos-recurrentes/${encodeURIComponent(String(selectedRow.__id))}`,
                    { method: "POST", body: JSON.stringify({ status: "archived" }) },
                  )
                    .then(() => {
                      toast.success("Descargo recurrente archivado");
                      setSelectedRow(null);
                      onRefresh();
                    })
                    .catch((error: unknown) =>
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "No se pudo archivar.",
                      ),
                    );
                }}
              >
                <Trash2 size={16} />
              </button>
            )}
            <label className="legacy-toolbar-search">
              <Search size={15} />
              <input
                placeholder="Buscar en grilla..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          <LegacyTable
            columns={spec.columns}
            rows={rows}
            dense
            permissions={permissions}
            selectedRowId={
              spec.entity === "deposits" || spec.entity === "recurringPayouts"
                ? ((selectedRow?.__id as string | undefined) ?? undefined)
                : undefined
            }
            onSelect={(row) =>
              spec.entity === "deposits" || spec.entity === "recurringPayouts"
                ? setSelectedRow(row)
                : undefined
            }
            onEdit={(row) =>
              spec.entity === "recurringPayouts"
                ? setRecurringModal(row)
                : setQuickRecord(row)
            }
            onDelete={deleteRow}
          />
          <div className="legacy-footerbar">
            {footer.map((item) => (
              <span key={item.label}>
                {item.label}: <strong>{item.value}</strong>
              </span>
            ))}
          </div>
        </div>
        {spec.details && (
          <aside className="legacy-detail-panel">{spec.details}</aside>
        )}
      </section>
      {quickRecord && spec.entity &&
        (spec.entity === "charges" && quickRecord === "new" ? (
          <ChargeDataModal
            snapshot={snapshot}
            onClose={() => setQuickRecord(null)}
            onSaved={async () => {
              setQuickRecord(null);
              await onRefresh();
            }}
          />
        ) : (
          <QuickRecordModal
            entity={spec.entity}
            row={quickRecord === "new" ? null : quickRecord}
            snapshot={snapshot}
            onClose={() => setQuickRecord(null)}
            onSaved={async () => {
              setQuickRecord(null);
              await onRefresh();
            }}
          />
        ))}
      {recurringModal && spec.entity === "recurringPayouts" && (
        <RecurringPayoutModal
          row={recurringModal === "new" ? null : recurringModal}
          snapshot={snapshot}
          onClose={() => setRecurringModal(null)}
          onSaved={async () => {
            setRecurringModal(null);
            await onRefresh();
          }}
        />
      )}
      {acceptTarget && (
        <LegacyDialog
          title="Desglose de denominaciones"
          onClose={() => setAcceptTarget(null)}
        >
          <div className="statement-body">
            <p className="statement-meta">
              Depósito de {money(Number(acceptTarget.__amount ?? 0))} — indique
              billetes y monedas:
            </p>
            {DENOMS.map((d) => (
              <label key={d} className="field compact-field">
                RD$ {d}
                <input
                  type="number"
                  min="0"
                  value={denoms[d] ?? ""}
                  onChange={(event) =>
                    setDenoms((current) => ({
                      ...current,
                      [d]: event.target.value,
                    }))
                  }
                />
              </label>
            ))}
            <div className="legacy-footerbar">
              <span>
                Desglosado: <strong>{money(denomsTotal)}</strong> de{" "}
                {money(Number(acceptTarget.__amount ?? 0))}
              </span>
            </div>
            {denomsTotal !== 0 &&
              denomsTotal !== Number(acceptTarget.__amount ?? 0) && (
                <div className="inline-error" role="alert">
                  El desglose debe cuadrar exactamente con el importe.
                </div>
              )}
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setAcceptTarget(null)}
              >
                Cancelar
              </button>
              <button
                className="btn primary"
                disabled={
                  denomsTotal !== 0 &&
                  denomsTotal !== Number(acceptTarget.__amount ?? 0)
                }
                onClick={() => {
                  const desglose = DENOMS.filter(
                    (d) => Number(denoms[d] ?? 0) > 0,
                  ).map((d) => ({
                    denominacion: d,
                    cantidad: Number(denoms[d]),
                  }));
                  void depositAction(acceptTarget, "aceptar", desglose);
                  setAcceptTarget(null);
                }}
              >
                Aceptar depósito
              </button>
            </div>
          </div>
        </LegacyDialog>
      )}
    </>
  );
}

function RecurringPayoutModal({
  row,
  snapshot,
  onClose,
  onSaved,
}: {
  row: TableRow | null;
  snapshot: Snapshot;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const raw = row?.__raw ?? {};
  const [clientId, setClientId] = useState(
    String(raw.clientId ?? snapshot.clients[0]?.id ?? ""),
  );
  const [concept, setConcept] = useState(String(raw.concept ?? ""));
  const [amount, setAmount] = useState(
    String(Number(raw.amount ?? 10000) / 100),
  );
  const [frequency, setFrequency] = useState(
    String(raw.frequency ?? "monthly"),
  );
  const [nextRunDate, setNextRunDate] = useState(
    String(raw.nextRunDate ?? snapshot.businessDate),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const cents = Math.round(Number(amount) * 100);
    if (!concept.trim() || !Number.isFinite(cents) || cents <= 0) {
      setError("Complete concepto e importe (mayor a cero).");
      return;
    }
    setBusy(true);
    try {
      await api(
        row?.__id
          ? `/descargos-recurrentes/${encodeURIComponent(String(row.__id))}`
          : "/descargos-recurrentes",
        {
          method: "POST",
          body: JSON.stringify({
            clientId,
            concept: concept.trim(),
            amount: cents,
            frequency,
            nextRunDate: nextRunDate || snapshot.businessDate,
          }),
        },
      );
      toast.success(row ? "Plantilla actualizada" : "Plantilla creada");
      await onSaved();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "No se pudo guardar la plantilla.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={row ? "Editar Descargo Recurrente" : "Nuevo Descargo Recurrente"}
      description="Plantilla de descargo periódico por cliente."
    >
      <form className="operation-form" onSubmit={save}>
        <label className="field">
          Cliente
          <select
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
          >
            {snapshot.clients.map((client) => (
              <option value={client.id} key={client.id}>
                {client.name} ({client.code})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Concepto
          <input
            value={concept}
            onChange={(event) => setConcept(event.target.value)}
            required
          />
        </label>
        <label className="field">
          Monto (RD$)
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
          />
        </label>
        <label className="field">
          Frecuencia
          <select
            value={frequency}
            onChange={(event) => setFrequency(event.target.value)}
          >
            <option value="weekly">Semanal</option>
            <option value="monthly">Mensual</option>
            <option value="quarterly">Trimestral</option>
          </select>
        </label>
        <label className="field">
          Próxima fecha
          <input
            type="date"
            value={nextRunDate}
            onChange={(event) => setNextRunDate(event.target.value)}
            required
          />
        </label>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? "Guardando..." : "Guardar (oK)"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CollectorDataModal({
  row,
  snapshot,
  onClose,
  onSaved,
}: {
  row: TableRow | null;
  snapshot: Snapshot;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const raw = row?.__raw ?? {};
  const [name, setName] = useState(String(raw.name ?? ""));
  const [ident, setIdent] = useState(String(raw.ident ?? ""));
  const [cellular, setCellular] = useState(String(raw.cellular ?? ""));
  const [accountId, setAccountId] = useState(String(raw.accountId ?? "cob"));
  const [active, setActive] = useState(String(raw.status ?? "active") !== "offline");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!name.trim()) return setError("El nombre del cobrador es requerido.");
    setBusy(true);
    try {
      await api("/mock/admin/collectors", {
        method: row?.__id ? "PATCH" : "POST",
        body: JSON.stringify({ id: row?.__id, name, ident, cellular, accountId, active }),
      });
      toast.success(row ? "Cobrador actualizado" : "Cobrador creado");
      await onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : "No se pudo guardar el cobrador.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Datos de Cobrador..." description="Creación y edición legacy-aligned de cobradores.">
      <form className="legacy-data-form" onSubmit={save}>
        <label className="field">Cobrador:<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <div className="form-grid three-cols">
          <label className="field">Ident.:<input value={ident} onChange={(event) => setIdent(event.target.value)} placeholder="001-0000000-0" /></label>
          <label className="field">Celular:<input value={cellular} onChange={(event) => setCellular(event.target.value)} placeholder="8095550000" /></label>
          <label className="field">Cuenta vinculada:<select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option>cob</option><option>admin</option><option>franyi</option></select></label>
        </div>
        <label className="checkbox-option"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /><span><strong>Estado Activo</strong><small>Permite operar y aparecer en monitores.</small></span></label>
        {error && <div className="inline-error" role="alert">{error}</div>}
        <div className="dialog-actions"><button type="button" className="btn" disabled={busy} onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy}>{busy ? "Guardando..." : "Guardar"}</button></div>
      </form>
    </Modal>
  );
}

function CollectorSubflowModal({
  flow,
  collector,
  snapshot,
  onClose,
  onSaved,
}: {
  flow: "zones" | "limits" | "routes";
  collector: Collector;
  snapshot: Snapshot;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [selectedRow, setSelectedRow] = useState("");
  const [selectedZone, setSelectedZone] = useState("Distrito Nacional");
  const [selectedRoute, setSelectedRoute] = useState(snapshot.routes[0]?.id ?? "");
  const [currency, setCurrency] = useState("Peso Dominicano");
  const [abbr, setAbbr] = useState("DOP");
  const [collectionLimit, setCollectionLimit] = useState(String((collector.collectionLimit || 0) / 100));
  const [payoutLimit, setPayoutLimit] = useState(String((collector.payoutLimit || 0) / 100));
  const title = flow === "zones" ? "Zonas del Cobrador" : flow === "limits" ? "Límites del Cobrador" : "Rutas del Cobrador";
  const saveSubflow = async (body: Record<string, unknown>) => {
    await api(`/mock/admin/collector-${flow}/${encodeURIComponent(collector.id)}`, { method: "POST", body: JSON.stringify(body) });
    await onSaved();
  };
  const add = async () => {
    if (flow === "zones") await saveSubflow({ action: "add", zone: selectedZone, from: "001", to: "999" });
    if (flow === "routes") await saveSubflow({ action: "add", routeId: selectedRoute || snapshot.routes[0]?.id });
    if (flow === "limits") await saveSubflow({ action: "add", currency, abbr, collectionLimit: Math.round(Number(collectionLimit) * 100), payoutLimit: Math.round(Number(payoutLimit) * 100) });
    toast.success("Asignación actualizada");
  };
  const remove = async () => {
    if (!selectedRow) return toast.info("Seleccione un registro para eliminar.");
    if (flow === "zones") await saveSubflow({ action: "delete", zoneId: selectedRow });
    if (flow === "routes") await saveSubflow({ action: "delete", routeId: selectedRow });
    if (flow === "limits") await saveSubflow({ action: "delete", abbr: selectedRow });
    setSelectedRow("");
    toast.success("Registro desasociado");
  };
  return (
    <Modal open onClose={onClose} title={`${title} — ${collector.name}`} description="Subflujo legacy de gestión asignada del cobrador.">
      <div className="collector-subflow">
        <div className="legacy-icon-toolbar">
          <button onClick={() => void add()}><Plus size={16} /> {flow === "limits" ? "Agregar Límite" : flow === "zones" ? "Agregar Zona" : "Agregar Ruta"}</button>
          <button onClick={() => void remove()}><Trash2 size={16} /> {flow === "limits" ? "Eliminar Límite" : flow === "zones" ? "Eliminar Zona" : "Eliminar Ruta"}</button>
          {flow === "limits" && <button className="btn primary" onClick={() => void add()}>Guardar</button>}
        </div>
        {flow === "zones" && <label className="field compact-field">Zona disponible<select value={selectedZone} onChange={(event) => setSelectedZone(event.target.value)}><option>Distrito Nacional</option><option>Mercado</option><option>Santiago Norte</option><option>Zona Este</option></select></label>}
        {flow === "routes" && <label className="field compact-field">Ruta disponible<select value={selectedRoute} onChange={(event) => setSelectedRoute(event.target.value)}>{snapshot.routes.map((route) => <option value={route.id} key={route.id}>{route.name}</option>)}</select></label>}
        {flow === "limits" && <div className="form-grid three-cols"><label className="field">Moneda<select value={abbr} onChange={(event) => { const next = event.target.value; setAbbr(next); setCurrency(next === "USD" ? "Dólar Americano" : next === "EUR" ? "Euro" : next === "NONE" ? "No definida" : "Peso Dominicano"); }}><option value="NONE">No definida</option><option value="DOP">Peso Dominicano (DOP)</option><option value="USD">Dólar Americano (USD)</option><option value="EUR">Euro (EUR)</option></select></label><label className="field">Límite de Cobro<input type="number" min="0" step="0.01" value={collectionLimit} onChange={(event) => setCollectionLimit(event.target.value)} /></label><label className="field">Límite de Pago<input type="number" min="0" step="0.01" value={payoutLimit} onChange={(event) => setPayoutLimit(event.target.value)} /></label></div>}
        <div className="table-scroll legacy-table-scroll">
          {flow === "zones" && <table className="data-table legacy-data-table dense"><thead><tr><th>Nro</th><th>Zona</th><th>Desde</th><th>Hasta</th></tr></thead><tbody>{(collector.zones ?? []).map((zone, index) => <tr key={zone.id} className={selectedRow === zone.id ? "selected-row" : undefined} onClick={() => setSelectedRow(zone.id)}><td>{index + 1}</td><td>{zone.name}</td><td>{zone.from}</td><td>{zone.to}</td></tr>)}</tbody></table>}
          {flow === "limits" && <table className="data-table legacy-data-table dense"><thead><tr><th>Moneda</th><th>Abrev</th><th>Lím. de Cobro</th><th>Lím. de Pago</th></tr></thead><tbody>{(collector.limits ?? []).map((limit) => <tr key={limit.abbr} className={selectedRow === limit.abbr ? "selected-row" : undefined} onClick={() => setSelectedRow(limit.abbr)}><td>{limit.currency}</td><td>{limit.abbr}</td><td>{money(limit.collectionLimit)}</td><td>{money(limit.payoutLimit)}</td></tr>)}</tbody></table>}
          {flow === "routes" && <table className="data-table legacy-data-table dense"><thead><tr><th>Nro_Ruta</th><th>Ruta</th></tr></thead><tbody>{(collector.assignedRoutes ?? []).map((routeId, index) => <tr key={routeId} className={selectedRow === routeId ? "selected-row" : undefined} onClick={() => setSelectedRow(routeId)}><td>{index + 1}</td><td>{snapshot.routes.find((route) => route.id === routeId)?.name ?? routeId}</td></tr>)}</tbody></table>}
        </div>
        <div className="dialog-actions"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={onClose}>oK</button></div>
      </div>
    </Modal>
  );
}

function ChargeDataModal({
  snapshot,
  onClose,
  onSaved,
}: {
  snapshot: Snapshot;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [client, setClient] = useState(snapshot.clients[0]);
  const [clientSearchOpen, setClientSearchOpen] = useState(false);
  const [currency, setCurrency] = useState("Peso Dominicano (DOP)");
  const [service, setService] = useState("Cuota de Préstamo");
  const [concept, setConcept] = useState("Servicio mensual");
  const [base, setBase] = useState("2000.00");
  const [rate, setRate] = useState("1.00");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const total = Math.round(Number(base || 0) * Number(rate || 0) * 100);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!client) return setError("Seleccione un cliente.");
    if (!Number.isFinite(total) || total <= 0)
      return setError("El importe total debe ser mayor a cero.");
    setBusy(true);
    try {
      await api("/mock/admin/charges", {
        method: "POST",
        body: JSON.stringify({
          clientId: client.id,
          service,
          concept,
          currency,
          amount: total,
          dueDate: snapshot.businessDate,
          required: service === "Cuota de Préstamo",
          note,
        }),
      });
      toast.success("Cargo guardado correctamente");
      await onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : "No se pudo guardar el cargo.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Datos del Cargo..." description="Registro legacy-aligned de cargo a cliente.">
      <form className="legacy-data-form" onSubmit={save}>
        <fieldset className="legacy-fieldset">
          <legend>Cliente</legend>
          <div className="legacy-client-picker">
            <label className="field compact-field">
              Código
              <input value={client?.code ?? ""} onChange={(event) => {
                const found = snapshot.clients.find((item) => item.code === event.target.value || item.id === event.target.value);
                if (found) setClient(found);
              }} />
            </label>
            <label className="field compact-field grow-field">
              Nombre
              <input value={client?.name ?? ""} disabled readOnly />
            </label>
            <button type="button" className="btn" onClick={() => setClientSearchOpen(true)}>[...]</button>
          </div>
        </fieldset>
        <div className="form-grid three-cols">
          <label className="field">Moneda<select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>Peso Dominicano (DOP)</option><option>Dólar Americano (USD)</option><option>Euro (EUR)</option></select></label>
          <label className="field">Servicio<select value={service} onChange={(event) => setService(event.target.value)}><option>Cuota de Préstamo</option><option>Servicio Mensual</option><option>Mantenimiento</option></select></label>
          <label className="field">Concepto<input value={concept} onChange={(event) => setConcept(event.target.value)} required /></label>
        </div>
        <div className="form-grid three-cols">
          <label className="field">Monto Base<input type="number" min="0.01" step="0.01" value={base} onChange={(event) => setBase(event.target.value)} required /></label>
          <label className="field">Tasa/Multiplicador<input type="number" min="0.01" step="0.01" value={rate} onChange={(event) => setRate(event.target.value)} required /></label>
          <label className="field">Total Calculado<input value={(total / 100).toFixed(2)} readOnly disabled /></label>
        </div>
        <label className="field">Nota<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Nota libre del cargo" /></label>
        {error && <div className="inline-error" role="alert">{error}</div>}
        <div className="dialog-actions"><button type="button" className="btn" disabled={busy} onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy}>{busy ? "Guardando..." : "Guardar (oK)"}</button></div>
      </form>
      {clientSearchOpen && (
        <ClientSearchSubmodal
          clients={snapshot.clients}
          onClose={() => setClientSearchOpen(false)}
          onSelect={(next) => { setClient(next); setClientSearchOpen(false); }}
        />
      )}
    </Modal>
  );
}

function ClientSearchSubmodal({ clients, onSelect, onClose }: { clients: Snapshot["clients"]; onSelect: (client: Snapshot["clients"][number]) => void; onClose: () => void; }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(clients[0]?.id ?? "");
  const rows = clients.filter((client) => `${client.code} ${client.id} ${client.name}`.toLowerCase().includes(query.toLowerCase()));
  const selectedClient = clients.find((client) => client.id === selected) ?? rows[0];
  return (
    <div className="nested-modal-scrim" role="dialog" aria-modal="true" onKeyDown={(event) => event.key === "Escape" && onClose()}>
      <div className="nested-modal-card">
        <header><strong>Seleccionar cliente...</strong><button className="icon-button" onClick={onClose}><X size={16} /></button></header>
        <label className="legacy-toolbar-search wide">Digite:<input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="table-scroll legacy-table-scroll">
          <table className="data-table legacy-data-table dense"><thead><tr><th>Cód.</th><th>Identif.</th><th>Cliente</th></tr></thead><tbody>{rows.map((client) => <tr key={client.id} className={selected === client.id ? "selected-row" : undefined} onClick={() => setSelected(client.id)} onDoubleClick={() => onSelect(client)}><td>{client.code}</td><td>{client.id}</td><td>{client.name}</td></tr>)}</tbody></table>
        </div>
        <div className="dialog-actions"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => selectedClient && onSelect(selectedClient)}>oK</button></div>
      </div>
    </div>
  );
}

function QuickRecordModal({
  entity,
  row,
  snapshot,
  onClose,
  onSaved,
}: {
  entity: string;
  row: TableRow | null;
  snapshot: Snapshot;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const raw = row?.__raw ?? {};
  const [name, setName] = useState(
    String(raw.name ?? raw.service ?? raw.concept ?? ""),
  );
  const [clientId, setClientId] = useState(
    String(raw.clientId ?? snapshot.clients[0]?.id ?? ""),
  );
  const [collectorId, setCollectorId] = useState(
    String(raw.collectorId ?? snapshot.collectors[0]?.id ?? ""),
  );
  const [amount, setAmount] = useState(
    String(Number(raw.amount ?? row?.__amount ?? 10000) / 100),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isClient = entity === "clients";
  const [phone, setPhone] = useState(String(raw.phone ?? ""));
  const [alias, setAlias] = useState(String(raw.alias ?? ""));
  const [sector, setSector] = useState(String(raw.sector ?? ""));
  const [cellular, setCellular] = useState(String(raw.cellular ?? ""));
  const [email, setEmail] = useState(String(raw.email ?? ""));
  const [note, setNote] = useState(String(raw.note ?? ""));
  const [address, setAddress] = useState(String(raw.address ?? ""));
  const [routeId, setRouteId] = useState(
    String(raw.routeId ?? snapshot.routes[0]?.id ?? ""),
  );
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const cents = Math.round(Number(amount) * 100);
    if (!isClient && (!Number.isFinite(cents) || cents <= 0)) {
      setError("El monto debe ser mayor a cero.");
      return;
    }
    if (!name.trim()) {
      setError("El nombre o concepto es requerido.");
      return;
    }
    setBusy(true);
    try {
      await api(`/mock/admin/${entity}`, {
        method: row?.__id ? "PATCH" : "POST",
        body: JSON.stringify({
          id: row?.__id,
          name: isClient ? name.trim() : undefined,
          code: isClient
            ? String(raw.code ?? `C-${snapshot.clients.length + 1}`)
            : undefined,
          phone: isClient ? phone : String(raw.phone ?? "8095550000"),
          address: isClient ? address : String(raw.address ?? "Dirección pendiente"),
          routeId: isClient ? routeId : String(raw.routeId ?? snapshot.routes[0]?.id),
          alias: isClient ? alias : undefined,
          sector: isClient ? sector : undefined,
          cellular: isClient ? cellular : undefined,
          email: isClient ? email : undefined,
          note: isClient ? note : undefined,
          clientId,
          collectorId,
          service:
            !isClient && !entity.includes("payout") ? name.trim() : undefined,
          concept: entity.includes("payout") ? name.trim() : undefined,
          amount: cents,
          dueDate: snapshot.businessDate,
          status: raw.status ?? "pending",
          required: Boolean(raw.required),
        }),
      });
      toast.success(row ? "Registro actualizado" : "Registro creado");
      await onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={row ? "Editar registro" : "Nuevo registro"}
      description="Formulario rápido para evaluación frontend con mock local."
    >
      <form className="operation-form" onSubmit={save}>
        <label className="field">
          {isClient ? "Nombre" : "Concepto"}
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        {isClient && (
          <>
            <label className="field">
              Teléfono
              <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="8095550000" />
            </label>
            <label className="field">
              Celular
              <input value={cellular} onChange={(event) => setCellular(event.target.value)} placeholder="8095550000" />
            </label>
            <label className="field">
              Alias
              <input value={alias} onChange={(event) => setAlias(event.target.value)} />
            </label>
            <label className="field">
              Sector/Zona
              <input value={sector} onChange={(event) => setSector(event.target.value)} />
            </label>
            <label className="field">
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label className="field">
              Dirección
              <input value={address} onChange={(event) => setAddress(event.target.value)} />
            </label>
            <label className="field">
              Ruta
              <select value={routeId} onChange={(event) => setRouteId(event.target.value)}>
                {snapshot.routes.map((route) => (
                  <option value={route.id} key={route.id}>
                    {route.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Nota
              <textarea value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
          </>
        )}
        {!isClient && (
          <>
            <label className="field">
              Cliente
              <select
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
              >
                {snapshot.clients.map((client) => (
                  <option value={client.id} key={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Cobrador
              <select
                value={collectorId}
                onChange={(event) => setCollectorId(event.target.value)}
              >
                {snapshot.collectors.map((collector) => (
                  <option value={collector.id} key={collector.id}>
                    {collector.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Monto (RD$)
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
              />
            </label>
          </>
        )}
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="btn"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function LegacyTable({
  columns,
  rows,
  dense = false,
  permissions,
  selectedRowId,
  onSelect,
  onEdit,
  onDelete,
  sortable = true,
}: {
  columns: LegacyColumn[];
  rows: TableRow[];
  dense?: boolean;
  permissions?: AdminPermissions;
  selectedRowId?: string;
  onSelect?: (row: TableRow) => void;
  onEdit?: (row: TableRow) => void;
  onDelete?: (row: TableRow) => void;
  sortable?: boolean;
}) {
  const actionTitle = permissions?.readOnlyReason ?? "Acciones de registro";
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [hiddenCols, setHiddenCols] = useState<string[]>([]);
  const [chooserOpen, setChooserOpen] = useState(false);
  const visibleColumns = columns.filter((c) => !hiddenCols.includes(c.key));
  const displayRows = useMemo(() => {
    if (!sortKey) return rows;
    const sorted = [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const an = Number(av);
      const bn = Number(bv);
      const numeric =
        String(av ?? "").trim() !== "" &&
        String(bv ?? "").trim() !== "" &&
        !Number.isNaN(an) &&
        !Number.isNaN(bn);
      const r = numeric
        ? an - bn
        : String(av ?? "").localeCompare(String(bv ?? ""));
      return sortDir === "asc" ? r : -r;
    });
    return sorted;
  }, [rows, sortKey, sortDir]);
  const toggleSort = (key: string) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
      return;
    }
    setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
  };
  return (
    <div className="table-scroll legacy-table-scroll">
      <div className="legacy-column-chooser-bar">
        <button type="button" className="text-button" onClick={() => setChooserOpen((v) => !v)}>
          Columnas
        </button>
        {chooserOpen && (
          <div className="legacy-column-menu">
            {columns.map((column) => (
              <label key={column.key}>
                <input
                  type="checkbox"
                  checked={!hiddenCols.includes(column.key)}
                  onChange={(event) =>
                    setHiddenCols((current) =>
                      event.target.checked
                        ? current.filter((k) => k !== column.key)
                        : [...current, column.key],
                    )
                  }
                />
                {column.label}
              </label>
            ))}
          </div>
        )}
      </div>
      <table className={`data-table legacy-data-table ${dense ? "dense" : ""}`}>
        <thead>
          <tr>
            {visibleColumns.map((column) => (
              <th
                key={column.key}
                className={`${column.align ? `align-${column.align}` : ""} ${sortable ? "sortable-col" : ""}`.trim() || undefined}
                onClick={sortable ? () => toggleSort(column.key) : undefined}
              >
                {column.label}
                {sortable && sortKey === column.key && (
                  <span className="sort-indicator">{sortDir === "asc" ? " ▲" : " ▼"}</span>
                )}
              </th>
            ))}
            {(onEdit || onDelete) && <th className="align-center">Acciones</th>}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, index) => (
            <tr
              key={row.__id ?? index}
              className={selectedRowId && row.__id === selectedRowId ? "selected-row" : undefined}
              onClick={() => onSelect?.(row)}
              onDoubleClick={() => onEdit?.(row)}
            >
              {visibleColumns.map((column) => (
                <td
                  key={column.key}
                  className={column.align ? `align-${column.align}` : undefined}
                >
                  {(row[column.key] as ReactNode) ?? "—"}
                </td>
              ))}
              {(onEdit || onDelete) && (
                <td className="align-center row-actions-cell">
                  {onEdit && (
                    <button
                      className="icon-button small"
                      title={permissions?.canEdit ? "Editar" : actionTitle}
                      disabled={!permissions?.canEdit}
                      onClick={() => onEdit(row)}
                      aria-label="Editar registro"
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                  {onDelete && (
                    <button
                      className="icon-button small danger-action"
                      title={permissions?.canDelete ? "Eliminar" : actionTitle}
                      disabled={!permissions?.canDelete}
                      onClick={() => onDelete(row)}
                      aria-label="Eliminar registro"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!displayRows.length && (
        <Empty
          title="Sin registros"
          text="No hay datos para los filtros aplicados."
        />
      )}
    </div>
  );
}

function masterSpec(
  page: Page,
  snapshot: Snapshot,
  onAccount: (operation: AccountOperation) => void,
): {
  title: string;
  subtitle: string;
  columns: LegacyColumn[];
  rows: TableRow[];
} {
  const routeName = (routeId: string) =>
    snapshot.routes.find((route) => route.id === routeId)?.name ?? "Sin ruta";
  const routeNameForCollector = (collectorId?: string) =>
    snapshot.collectors.find((collector) => collector.id === collectorId)
      ?.routeId
      ? routeName(
          snapshot.collectors.find(
            (collector) => collector.id === collectorId,
          )!.routeId,
        )
      : "Sin ruta";
  if (page === "collectors")
    return {
      title: "Cobradores",
      subtitle: "Lista operativa de cobradores, límites y estado en ruta.",
      columns: [
        { key: "code", label: "Código" },
        { key: "name", label: "Cobrador" },
        { key: "route", label: "Ruta" },
        { key: "status", label: "Estado" },
        { key: "collectionLimit", label: "Lím. Cobro", align: "right" },
        { key: "payoutLimit", label: "Lím. Pago", align: "right" },
        { key: "cash", label: "En Mano", align: "right" },
      ],
      rows: snapshot.collectors.map((collector, index) => ({
        __id: collector.id,
        __entity: "collectors",
        __raw: collector as unknown as Record<string, unknown>,
        code: `COB-${String(index + 1).padStart(3, "0")}`,
        name: collector.name,
        route: routeName(collector.routeId),
        status: (
          <Badge status={collector.status}>
            {collector.status === "active"
              ? "Activo"
              : collector.status === "limit"
                ? "Límite"
                : "Inactivo"}
          </Badge>
        ),
        collectionLimit: money(collector.collectionLimit),
        payoutLimit: money(collector.payoutLimit),
        cash: money(collector.cashInHand),
      })),
    };
  if (page === "clients")
    return {
      title: "Clientes",
      subtitle: "Maestro de clientes asignados a rutas, zonas y cobradores.",
      columns: [
        { key: "code", label: "Código" },
        { key: "name", label: "Cliente" },
        { key: "route", label: "Ruta" },
        { key: "address", label: "Dirección" },
        { key: "phone", label: "Teléfono" },
        { key: "state", label: "Estado" },
      ],
      rows: snapshot.clients.map((client) => ({
        __id: client.id,
        __entity: "clients",
        __raw: client as unknown as Record<string, unknown>,
        code: client.code,
        name: client.name,
        route: routeName(client.routeId),
        address: client.address,
        phone: client.phone,
        state: <Badge status="active">Activo</Badge>,
      })),
    };
  if (page === "routesZones")
    return {
      title: "Rutas y Zonas",
      subtitle: "Relación de rutas operativas y zonas de cobro.",
      columns: [
        { key: "type", label: "Tipo" },
        { key: "code", label: "Código" },
        { key: "name", label: "Nombre" },
        { key: "sector", label: "Zona/Sector" },
        { key: "collector", label: "Cobrador" },
        { key: "clients", label: "Clientes", align: "right" },
      ],
      rows: snapshot.routes.map((route, index) => ({
        type: "Ruta",
        code: `R-${String(index + 1).padStart(3, "0")}`,
        name: route.name,
        sector: route.sector,
        collector:
          snapshot.collectors.find(
            (collector) => collector.id === route.collectorId,
          )?.name ?? "Sin asignar",
        clients: snapshot.clients.filter(
          (client) => client.routeId === route.id,
        ).length,
      })),
    };
  if (page === "servicesProducts") {
    const services = Array.from(
      new Set([
        ...snapshot.charges.map((charge) => charge.service),
        ...snapshot.payouts.map((payout) => payout.concept),
      ]),
    );
    return {
      title: "Servicios y Productos",
      subtitle:
        "Conceptos de cargos y descargos, con marca de obligado a cobrar.",
      columns: [
        { key: "code", label: "Código" },
        { key: "service", label: "Servicio / Producto" },
        { key: "abbr", label: "Abrev." },
        { key: "required", label: "Obligado" },
        { key: "amount", label: "Monto Referencia", align: "right" },
      ],
      rows: services.map((service, index) => {
        const charge = snapshot.charges.find(
          (item) => item.service === service,
        );
        return {
          code: `SRV-${String(index + 1).padStart(3, "0")}`,
          service,
          abbr: abbreviation(service),
          required: charge?.required ? "Sí" : "No",
          amount: charge ? money(charge.amount) : "Editable",
        };
      }),
    };
  }
  if (page === "delayReasons")
    return {
      title: "Motivos de Atraso",
      subtitle:
        "Relación cliente / motivo para cuentas con atraso o pago parcial.",
      columns: [
        { key: "client", label: "Cliente" },
        { key: "charge", label: "Servicio" },
        { key: "due", label: "Fecha" },
        { key: "reason", label: "Motivo" },
        { key: "state", label: "Estado" },
      ],
      rows: snapshot.charges
        .filter((charge) => charge.status !== "paid")
        .map((charge) => ({
          client:
            snapshot.clients.find((client) => client.id === charge.clientId)
              ?.name ?? "Cliente",
          charge: charge.service,
          due: safeDateLabel(charge.dueDate),
          reason:
            charge.status === "partial"
              ? "Pago parcial registrado"
              : "Pendiente en ruta",
          state: charge.status === "partial" ? "Atraso parcial" : "Atraso",
        })),
    };
  if (page === "exchangeRates")
    return {
      title: "Tasas de Cambio",
      subtitle: "Tabla independiente para remesas y operaciones multimoneda.",
      columns: [
        { key: "date", label: "Fecha" },
        { key: "currency", label: "Moneda" },
        { key: "abbr", label: "Abrev." },
        { key: "buy", label: "Compra", align: "right" },
        { key: "sell", label: "Venta", align: "right" },
      ],
      rows: [
        {
          date: "16/09/2026",
          currency: "Peso Dominicano",
          abbr: "DOP",
          buy: "1.00",
          sell: "1.00",
        },
        {
          date: "16/09/2026",
          currency: "Dólar Estadounidense",
          abbr: "USD",
          buy: "59.20",
          sell: "60.15",
        },
        {
          date: "16/09/2026",
          currency: "Euro",
          abbr: "EUR",
          buy: "64.30",
          sell: "65.80",
        },
      ],
    };
  if (page === "users")
    return {
      title: "Usuarios",
      subtitle:
        "Cuentas reales para administración y cobradores. Cada persona entra con su propio correo y contraseña.",
      columns: [
        { key: "user", label: "Usuario" },
        { key: "account", label: "Cuenta" },
        { key: "role", label: "Rol" },
        { key: "state", label: "Estado" },
        { key: "actions", label: "Acciones" },
      ],
      rows: snapshot.accounts.map((account) => ({
        user: account.name,
        account: account.email,
        role:
          account.role === "admin"
            ? "Administración"
            : `Cobrador · ${routeNameForCollector(account.collectorId)}`,
        state: (
          <Badge status={account.status === "active" ? "active" : "offline"}>
            {account.status === "active" ? "Activo" : "Desactivado"}
          </Badge>
        ),
        actions: (
          <div className="row-actions">
            <button
              type="button"
              className="text-button"
              title="Restablecer contraseña"
              onClick={() =>
                onAccount({ type: "password", account })
              }
            >
              <KeyRound size={15} /> Clave
            </button>
            <button
              type="button"
              className="text-button"
              title={
                account.status === "active"
                  ? "Desactivar cuenta"
                  : "Activar cuenta"
              }
              onClick={() =>
                onAccount({
                  type: "status",
                  account,
                  status: account.status === "active" ? "disabled" : "active",
                })
              }
            >
              {account.status === "active" ? "Desactivar" : "Activar"}
            </button>
          </div>
        ),
      })),
    };
  return {
    title: "Usuarios",
    subtitle: "Cuentas del sistema separadas de las tasas de cambio.",
    columns: [
      { key: "user", label: "Usuario" },
      { key: "account", label: "Cuenta" },
      { key: "role", label: "Rol" },
      { key: "state", label: "Estado" },
    ],
    rows: [],
  };
}

function operationSpec(page: Page, snapshot: Snapshot): OperationSpec {
  const client = (id?: string) =>
    snapshot.clients.find((item) => item.id === id);
  const collector = (id: string) =>
    snapshot.collectors.find((item) => item.id === id);
  const chargeColumns: LegacyColumn[] = [
    { key: "n", label: "Nro." },
    { key: "date", label: "Fecha" },
    { key: "code", label: "Cód." },
    { key: "ident", label: "Identif." },
    { key: "client", label: "Cliente" },
    { key: "abbr", label: "Abrev." },
    { key: "service", label: "Servicio" },
  ];
  if (page === "charges") {
    const total = snapshot.charges.reduce((sum, item) => sum + item.amount, 0);
    const received = snapshot.charges.reduce(
      (sum, item) => sum + item.collected,
      0,
    );
    return {
      title: "Cargos",
      subtitle:
        "Registro y consulta de cargos directos por cliente, zona o ruta.",
      filterTitle: "Filtro de Cargos",
      entity: "charges",
      modes: ["Todos", "Por Cliente", "Por Zona", "Por Ruta"],
      relationLabel: "Relación de Pago",
      columns: chargeColumns,
      rows: snapshot.charges.map((charge, index) => ({
        __id: charge.id,
        __entity: "charges",
        __date: charge.dueDate,
        __status: charge.status,
        __amount: charge.amount,
        __raw: charge as unknown as Record<string, unknown>,
        n: index + 1,
        date: safeDateLabel(charge.dueDate),
        code: client(charge.clientId)?.code,
        ident: charge.id.slice(0, 8),
        client: client(charge.clientId)?.name,
        abbr: abbreviation(charge.service),
        service: charge.service,
      })),
      footer: [
        { label: "Cantidad", value: snapshot.charges.length },
        { label: "Total", value: money(total) },
        { label: "Recib.", value: money(received) },
        { label: "Pend.", value: money(total - received) },
      ],
    };
  }
  if (page === "recurringCharges")
    return {
      title: "Cargos Recurrentes",
      subtitle: "Generación de cargos fijos mensuales y servicios periódicos.",
      filterTitle: "Filtro de Cargos Recurrentes",
      entity: "recurringCharges",
      modes: ["Todos", "Por Cliente"],
      columns: [
        { key: "n", label: "Nro." },
        { key: "date", label: "Fecha" },
        { key: "frequency", label: "Frecuencia" },
        { key: "ident", label: "Identif." },
        { key: "client", label: "Cliente" },
        { key: "service", label: "Servicio" },
      ],
      rows: snapshot.charges
        .filter((charge) => charge.required)
        .map((charge, index) => ({
          __id: charge.id,
          __entity: "recurringCharges",
          __date: charge.dueDate,
          __status: charge.status,
          __amount: charge.amount,
          __raw: charge as unknown as Record<string, unknown>,
          n: index + 1,
          date: safeDateLabel(charge.dueDate),
          frequency: "Mensual",
          ident: charge.id.slice(0, 8),
          client: client(charge.clientId)?.name,
          service: charge.service,
        })),
      footer: [
        {
          label: "Cantidad",
          value: snapshot.charges.filter((charge) => charge.required).length,
        },
      ],
    };
  if (page === "recurringPayouts") {
    const rows = snapshot.payoutRecurring ?? [];
    return {
      title: "Descargos Recurrentes",
      subtitle: "Órdenes de descargo periódicas por cliente, con frecuencia.",
      filterTitle: "Filtro de Descargos Recurrentes",
      entity: "recurringPayouts",
      modes: ["Todos", "Por Cliente"],
      columns: [
        { key: "n", label: "Nro." },
        { key: "date", label: "Fecha" },
        { key: "frequency", label: "Frecuencia" },
        { key: "ident", label: "Identif." },
        { key: "client", label: "Cliente" },
        { key: "concept", label: "Concepto" },
        { key: "status", label: "Estado" },
      ],
      rows: rows.map((template, index) => ({
        __id: template.id,
        __date: template.nextRunDate,
        __status: template.status,
        __amount: template.amount,
        __raw: template as unknown as Record<string, unknown>,
        n: index + 1,
        date: safeDateLabel(template.nextRunDate),
        frequency:
          template.frequency === "weekly"
            ? "Semanal"
            : template.frequency === "quarterly"
              ? "Trimestral"
              : "Mensual",
        ident: template.id.slice(0, 8),
        client: client(template.clientId)?.name,
        concept: template.concept,
        status: template.status,
      })),
      footer: [
        { label: "Cantidad", value: rows.length },
        {
          label: "Total",
          value: money(rows.reduce((sum, item) => sum + item.amount, 0)),
        },
      ],
    };
  }
  if (page === "collections") {
    const rows = snapshot.movements.filter(
      (movement) => movement.type === "collection",
    );
    return {
      title: "Cobros",
      subtitle: "Cobranza en calle y cobranza administrativa de respaldo.",
      filterTitle: "Filtro de Cobros",
      entity: "collections",
      modes: ["Todos", "Por Cliente", "Por Cobrador", "Por Zona", "Por Ruta"],
      columns: [
        { key: "n", label: "Nro." },
        { key: "ident", label: "Identif." },
        { key: "client", label: "Cliente" },
        { key: "date", label: "Fecha" },
        { key: "line", label: "Línea" },
        { key: "receipt", label: "Recibo" },
        { key: "amount", label: "Importe", align: "right" },
        { key: "active", label: "Activo" },
        { key: "registry", label: "Registro" },
      ],
      rows: rows.map((movement, index) => ({
        __id: movement.id,
        __date: movement.createdAt.slice(0, 10),
        __status: "Activo",
        __amount: movement.amount,
        __raw: movement as unknown as Record<string, unknown>,
        n: index + 1,
        ident: client(movement.clientId)?.code,
        client: client(movement.clientId)?.name,
        date: dateLabel(movement.createdAt.slice(0, 10)),
        line: collector(movement.collectorId)?.name,
        receipt:
          movement.receiptToken?.slice(0, 10) ?? movement.id.slice(0, 10),
        amount: money(movement.amount),
        active: "Sí",
        registry: timeLabel(movement.createdAt),
      })),
      footer: [
        { label: "Cantidad", value: rows.length },
        {
          label: "Total",
          value: money(rows.reduce((sum, item) => sum + item.amount, 0)),
        },
        { label: "Cancelado", value: money(0) },
      ],
    };
  }
  if (page === "deposits") {
    const rows = snapshot.movements.filter(
      (movement) => movement.type === "deposit",
    );
    const acepOf = (movement: Snapshot["movements"][number]) =>
      movement.cancelledAt
        ? "Cancelado"
        : movement.acceptedAt
          ? "Aceptado"
          : "Pendiente";
    return {
      title: "Depósitos por Cobradores",
      subtitle: "Depósitos recibidos desde ruta, con panel de detalle lateral.",
      filterTitle: "Filtro de Depósitos",
      entity: "deposits",
      modes: ["Todos", "Por Cobrador"],
      columns: [
        { key: "n", label: "Nro." },
        { key: "date", label: "Fecha" },
        { key: "collector", label: "Cobrador" },
        { key: "currency", label: "Moneda" },
        { key: "amount", label: "Importe", align: "right" },
        { key: "acep", label: "Acep." },
      ],
      rows: rows.map((movement, index) => ({
        __id: movement.id,
        __date: movement.createdAt.slice(0, 10),
        __status: acepOf(movement),
        __amount: movement.amount,
        __raw: movement as unknown as Record<string, unknown>,
        n: index + 1,
        date: dateLabel(movement.createdAt.slice(0, 10)),
        collector: collector(movement.collectorId)?.name,
        currency: "DOP",
        amount: money(movement.amount),
        acep: acepOf(movement),
      })),
      footer: [
        { label: "Cantidad", value: rows.length },
        {
          label: "Total",
          value: money(rows.reduce((sum, item) => sum + item.amount, 0)),
        },
      ],
      details: (
        <>
          <h2>Detalles</h2>
          <p>
            Seleccione un depósito para revisar recibos, moneda y comprobante.
          </p>
          <button className="btn full">
            <RefreshCw size={16} /> Refrescar
          </button>
          <div className="detail-metric">
            <span>Total mostrado</span>
            <strong>
              {money(rows.reduce((sum, item) => sum + item.amount, 0))}
            </strong>
          </div>
        </>
      ),
    };
  }
  if (page === "payouts")
    return {
      title: "Listado de Descargos",
      subtitle: "Tickets y órdenes de pago generadas para beneficiarios.",
      filterTitle: "Filtro de Descargos",
      entity: "payouts",
      modes: ["Todos", "Por Cliente", "Por Zona", "Por Ruta"],
      columns: [
        { key: "n", label: "Nro." },
        { key: "ident", label: "Identificación" },
        { key: "client", label: "Cliente" },
        { key: "date", label: "Fecha" },
        { key: "currency", label: "Moneda" },
        { key: "service", label: "Servicio" },
      ],
      rows: snapshot.payouts.map((payout, index) => ({
        __id: payout.id,
        __entity: "payouts",
        __date: snapshot.businessDate,
        __status: payout.status,
        __amount: payout.amount,
        __raw: payout as unknown as Record<string, unknown>,
        n: index + 1,
        ident: client(payout.clientId)?.code,
        client: client(payout.clientId)?.name,
        date: "16/09/2026",
        currency: "DOP",
        service: payout.concept,
      })),
      footer: [
        { label: "Cantidad", value: snapshot.payouts.length },
        {
          label: "Total",
          value: money(
            snapshot.payouts.reduce((sum, item) => sum + item.amount, 0),
          ),
        },
      ],
    };
  if (page === "payments") {
    const rows = snapshot.movements.filter(
      (movement) => movement.type === "payout",
    );
    return {
      title: "Pagos",
      subtitle: "Pagos ejecutados por cobrador, cliente, zona o ruta.",
      filterTitle: "Filtro de Pagos",
      entity: "payments",
      modes: ["Todos", "Por Cliente", "Por Cobrador", "Por Zona", "Por Ruta"],
      columns: [
        { key: "n", label: "Nro." },
        { key: "ident", label: "Identif." },
        { key: "client", label: "Cliente" },
        { key: "date", label: "Fecha" },
        { key: "amount", label: "Importe", align: "right" },
        { key: "note", label: "Nota" },
      ],
      rows: rows.map((movement, index) => ({
        __id: movement.id,
        __date: movement.createdAt.slice(0, 10),
        __status: "Activo",
        __amount: movement.amount,
        __raw: movement as unknown as Record<string, unknown>,
        n: index + 1,
        ident: client(movement.clientId)?.code,
        client: client(movement.clientId)?.name,
        date: dateLabel(movement.createdAt.slice(0, 10)),
        amount: money(movement.amount),
        note: "Pago confirmado en ruta",
      })),
      footer: [
        { label: "Cantidad", value: rows.length },
        {
          label: "Total",
          value: money(rows.reduce((sum, item) => sum + item.amount, 0)),
        },
      ],
    };
  }
  const rows = snapshot.movements.filter(
    (movement) => movement.type === "office_delivery",
  );
  return {
    title: "Entregas de Dinero",
    subtitle: "Efectivo entregado al cobrador para realizar pagos en calle.",
    filterTitle: "Filtro de Entregas",
    entity: "cashDeliveries",
    modes: ["Todos", "Por Cobrador"],
    columns: [
      { key: "n", label: "Nro." },
      { key: "date", label: "Fecha" },
      { key: "collector", label: "Cobrador" },
      { key: "currency", label: "Moneda" },
      { key: "amount", label: "Importe", align: "right" },
      { key: "checks", label: "Cheques", align: "right" },
      { key: "checkAmount", label: "Imp. Ch...", align: "right" },
      { key: "active", label: "Activo" },
    ],
    rows: rows.map((movement, index) => ({
      n: index + 1,
      date: dateLabel(movement.createdAt.slice(0, 10)),
      collector: collector(movement.collectorId)?.name,
      currency: "DOP",
      amount: money(movement.amount),
      checks: 0,
      checkAmount: money(0),
      active: "Sí",
    })),
    footer: [
      { label: "Cantidad", value: rows.length },
      {
        label: "Total",
        value: money(rows.reduce((sum, item) => sum + item.amount, 0)),
      },
    ],
  };
}

function MonitorView({
  page,
  snapshot,
  refreshing,
  onRefresh,
}: {
  page: Page;
  snapshot: Snapshot;
  refreshing: boolean;
  currentUser: User;
  onRefresh: () => void;
}) {
  const [auto, setAuto] = useState(true),
    [seconds, setSeconds] = useState("30"),
    [currency, setCurrency] = useState("DOP"),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<MonitorRow | null>(null),
    [mapData, setMapData] = useState<MapData | null>(null),
    [mapLoading, setMapLoading] = useState(false),
    [mapError, setMapError] = useState("");
  const rows = monitorRows(page, snapshot).filter((row) =>
    `${row.rawName} ${row.entityId}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const title =
    page === "monitorCollectors"
      ? "Monitor de Cobradores"
      : page === "monitorZones"
        ? "Monitor de Zonas"
        : "Monitor de Rutas";
  useEffect(() => {
    if (!selected) {
      setMapData(null);
      setMapError("");
      return;
    }
    let cancelled = false;
    setMapLoading(true);
    setMapError("");
    api<MapData>(
      `/monitoring/${selected.entityType}/${encodeURIComponent(selected.entityId)}/map-data`,
    )
      .then((data) => {
        if (!cancelled) setMapData(data);
      })
      .catch((error) => {
        if (!cancelled)
          setMapError(
            error instanceof Error
              ? error.message
              : "No pudimos cargar CobranzaMapas.",
          );
      })
      .finally(() => {
        if (!cancelled) setMapLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);
  return (
    <>
      <div className="page-title compact-title">
        <div>
          <div className="eyebrow">MONITORES</div>
          <h1>
            {title}
            <span className="title-dot">.</span>
          </h1>
          <p>Diferencia = (Cobrado - Depositado) + (Entregado - Pagado).</p>
        </div>
      </div>
      <section className="panel monitor-panel">
        <div className="monitor-header">
          <label>
            <input
              type="checkbox"
              checked={auto}
              onChange={(event) => setAuto(event.target.checked)}
            />{" "}
            Auto.
          </label>
          <label>
            Refresco{" "}
            <input
              value={seconds}
              onChange={(event) => setSeconds(event.target.value)}
              inputMode="numeric"
            />{" "}
            seg.
          </label>
          <label>
            Moneda{" "}
            <select
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              <option>DOP</option>
              <option>USD</option>
              <option>EUR</option>
            </select>
          </label>
          <label className="monitor-search">
            <Search size={15} />
            <input
              aria-label={`Buscar en ${title}`}
              placeholder={
                page === "monitorCollectors"
                  ? "Buscar cobrador..."
                  : page === "monitorZones"
                    ? "Buscar zona..."
                    : "Buscar ruta..."
              }
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button className="btn" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw className={refreshing ? "spin" : ""} size={16} />{" "}
            Refrescar
          </button>
        </div>
        <MonitorLedgerTable page={page} rows={rows} onSelect={setSelected} />
        <div className="legacy-footerbar">
          <span>Página 1 de 1</span>
          <span>
            Registros: <strong>{rows.length}</strong>
          </span>
          <span>
            Próximo refresco: <strong>{auto ? `${seconds}s` : "Manual"}</strong>
          </span>
          <span>Click sobre una fila para abrir CobranzaMapas.</span>
        </div>
      </section>
      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={
          selected ? `CobranzaMapas · ${selected.rawName}` : "CobranzaMapas"
        }
        description="Ubicación, ruta, paradas y exposición financiera en tiempo real."
        className="map-monitor-dialog"
      >
        {mapLoading && <Loading label="Cargando datos de CobranzaMapas…" />}
        {mapError && !mapLoading && (
          <Empty
            title="No pudimos cargar el mapa"
            text={mapError}
            action={
              <button
                className="btn"
                onClick={() => selected && setSelected({ ...selected })}
              >
                <RefreshCw size={16} /> Reintentar
              </button>
            }
          />
        )}
        {mapData && !mapLoading && !mapError && (
          <CobranzaMapasModal
            data={mapData}
            entityType={selected?.entityType ?? "collector"}
            title={selected?.rawName ?? "Ruta"}
          />
        )}
      </Modal>
    </>
  );
}

function MonitorLedgerTable({
  page,
  rows,
  onSelect,
}: {
  page: Page;
  rows: MonitorRow[];
  onSelect: (row: MonitorRow) => void;
}) {
  const entityLabel =
    page === "monitorCollectors"
      ? "Cobrador"
      : page === "monitorZones"
        ? "Zona"
        : "Ruta";
  return (
    <div className="table-scroll legacy-table-scroll">
      <table className="data-table legacy-data-table dense monitor-ledger-table">
        <thead>
          <tr>
            <th>{entityLabel}</th>
            <th className="align-right">Lím. de Cobro</th>
            <th className="align-right">Lím. de Pago</th>
            <th className="align-right">Cobrado</th>
            <th className="align-right">Depositado</th>
            <th className="align-right">Entregado</th>
            <th className="align-right">Pagado</th>
            <th className="align-right">Diferencia</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.entityType}-${row.entityId}`}>
              <td>
                <button
                  className="monitor-row-action"
                  onClick={() => onSelect(row)}
                  aria-label={`Abrir mapa de ${row.rawName}`}
                >
                  <MapPinned size={15} />
                  <span>{row.name}</span>
                </button>
              </td>
              <td className="align-right">{row.collectionLimit}</td>
              <td className="align-right">{row.payoutLimit}</td>
              <td className="align-right">{row.collected}</td>
              <td className="align-right">{row.deposited}</td>
              <td className="align-right">{row.delivered}</td>
              <td className="align-right">{row.paid}</td>
              <td className="align-right">{row.difference}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <Empty title="Sin resultados" text="Ajusta la búsqueda del monitor." />
      )}
    </div>
  );
}

function CobranzaMapasModal({
  data,
  entityType,
  title,
}: {
  data: MapData;
  entityType: MonitorEntity;
  title: string;
}) {
  const [focusedMarker, setFocusedMarker] = useState<MapMarker | null>(null);
  const adapted: AdaptedMap =
    entityType === "zone"
      ? transformZoneToMap(title, data.stops)
      : entityType === "route"
        ? transformRouteToMap(title, data.stops)
        : transformCollectorToMap(data.collector, data.stops);
  const pending = data.stops.filter((stop) => stop.status !== "paid"),
    obligated = data.stops.filter((stop) => stop.obligated),
    totalDue = data.stops.reduce((sum, stop) => sum + stop.amount_due, 0);
  const pointStyle = (lat: number, lng: number) => ({
    top: `${86 - (((lat - adapted.bounds.minLat) / Math.max(adapted.bounds.maxLat - adapted.bounds.minLat, 0.001)) * 70 + 8)}%`,
    left: `${((lng - adapted.bounds.minLng) / Math.max(adapted.bounds.maxLng - adapted.bounds.minLng, 0.001)) * 78 + 9}%`,
  });
  const openMarker = (marker: MapMarker) =>
    dispatchMarkerClick(marker, {
      onFocus: setFocusedMarker,
      onOpenClient: setFocusedMarker,
      onOpenCollection: setFocusedMarker,
    });
  const selectedMarker = focusedMarker ?? adapted.markers[0];
  return (
    <div className="cobranza-map-modal">
      <div className="map-modal-summary">
        <div>
          <span>Entidad</span>
          <strong>{title}</strong>
          <small>
            {data.collector.name} · {data.collector.phone}
          </small>
        </div>
        <div>
          <span>Dinero en mano</span>
          <strong>{moneyFromUnits(data.collector.cash_in_hand)}</strong>
          <small>
            Límite cobro {moneyFromUnits(data.collector.collection_limit)}
          </small>
        </div>
        <div>
          <span>Pendientes</span>
          <strong>
            {pending.length}/{data.stops.length}
          </strong>
          <small>{obligated.length} obligados a cobrar</small>
        </div>
        <div>
          <span>Total ruta</span>
          <strong>{moneyFromUnits(totalDue)}</strong>
          <small>Último ping {timeLabel(data.collector.last_ping)}</small>
        </div>
      </div>
      <div className="cobranza-map-grid">
        <section
          className="cobranza-map-canvas"
          aria-label="CobranzaMapas operativo"
        >
          <div className="map-grid-lines" />
          <div className="route-polyline" />
          {adapted.markers.map((marker) =>
            marker.type === "collector" ? (
              <button
                className={`collector-live-pin ${selectedMarker?.id === marker.id ? "focused" : ""}`}
                key={marker.id}
                style={pointStyle(marker.lat, marker.lng)}
                onClick={() => openMarker(marker)}
                aria-label={`Abrir popup de ${marker.label}`}
              >
                <MapPinned size={16} />
              </button>
            ) : (
              <button
                className={`stop-pin ${marker.color} ${marker.obligated ? "obligated" : ""} ${selectedMarker?.id === marker.id ? "focused" : ""}`}
                key={marker.id}
                style={pointStyle(marker.lat, marker.lng)}
                title={marker.popupTitle}
                onClick={() => openMarker(marker)}
              >
                {marker.order}
              </button>
            ),
          )}
          {selectedMarker && (
            <div
              className="map-popup-card"
              style={pointStyle(selectedMarker.lat, selectedMarker.lng)}
            >
              <strong>{selectedMarker.popupTitle}</strong>
              <span>{selectedMarker.popupSubtitle}</span>
              {selectedMarker.amountDue !== undefined && (
                <small>
                  {moneyFromUnits(selectedMarker.amountDue)} pendiente
                </small>
              )}
            </div>
          )}
          <div className="map-module-label">
            <strong>CobranzaMapas</strong>
            <span>Adapter activo · {data.stops.length} PCP</span>
          </div>
        </section>
        <aside className="map-stops-panel">
          <div className="map-stops-heading">
            <strong>Paradas</strong>
            <span>{data.stops.length} puntos</span>
          </div>
          <div className="map-stops-list">
            {adapted.markers
              .filter((marker) => marker.type === "stop")
              .map((marker) => (
                <button
                  className={`map-stop-row ${selectedMarker?.id === marker.id ? "active" : ""}`}
                  key={marker.id}
                  onClick={() => openMarker(marker)}
                >
                  <span className="stop-order">{marker.order}</span>
                  <span>
                    <strong>{marker.clientName}</strong>
                    <small>{marker.popupSubtitle}</small>
                  </span>
                  <strong>{moneyFromUnits(marker.amountDue ?? 0)}</strong>
                </button>
              ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function DailySettlementsView({
  snapshot,
  onRefresh,
}: {
  snapshot: Snapshot;
  onRefresh: () => void;
}) {
  const rows = snapshot.settlements.length
    ? snapshot.settlements.map((settlement) => ({
        date: dateLabel(settlement.date),
        total: money(settlement.collected + settlement.officeDelivered),
        cash: money(settlement.collected),
        check: money(0),
        balance: money(settlement.difference),
      }))
    : [
        {
          date: dateLabel(snapshot.businessDate),
          total: money(
            snapshot.totals.collected + snapshot.totals.officeDelivered,
          ),
          cash: money(snapshot.totals.collected),
          check: money(0),
          balance: money(snapshot.totals.difference),
        },
      ];
  return (
    <>
      <div className="page-title compact-title">
        <div>
          <div className="eyebrow">ARQUEO</div>
          <h1>
            Cuadres Diarios<span className="title-dot">.</span>
          </h1>
          <p>Consulta de cierres por rango de fecha y moneda.</p>
        </div>
      </div>
      <section className="legacy-workspace settlement-legacy-workspace">
        <aside className="legacy-filter-panel">
          <h2>Filtro de Cuadres</h2>
          <label className="field compact-field">
            Fecha Inicial
            <input type="date" defaultValue="2026-09-01" />
          </label>
          <label className="field compact-field">
            Fecha Final
            <input type="date" defaultValue="2026-09-16" />
          </label>
          <label className="field compact-field">
            Moneda
            <select>
              <option>DOP</option>
              <option>USD</option>
              <option>EUR</option>
            </select>
          </label>
          <button className="btn full" onClick={onRefresh}>
            <RefreshCw size={16} /> Refrescar
          </button>
        </aside>
        <div className="legacy-grid-panel">
          <div className="legacy-icon-toolbar">
            <button onClick={onRefresh}>
              <RefreshCw size={16} />
            </button>
            <button>
              <Download size={16} />
            </button>
          </div>
          <LegacyTable
            dense
            columns={[
              { key: "date", label: "Fecha" },
              { key: "total", label: "Total", align: "right" },
              { key: "cash", label: "Efectivo", align: "right" },
              { key: "check", label: "Cheque", align: "right" },
              { key: "balance", label: "Balance", align: "right" },
            ]}
            rows={rows}
          />
        </div>
      </section>
    </>
  );
}

function ReportsView() {
  return (
    <section className="panel reports-placeholder">
      <FileCheck2 size={34} />
      <h1>Reportes</h1>
      <p>
        Sección base preparada para reportes generales, exportaciones y
        consultas históricas.
      </p>
      <button className="btn">
        <Download size={16} /> Preparar exportación
      </button>
    </section>
  );
}

function monitorRows(page: Page, snapshot: Snapshot): MonitorRow[] {
  if (page === "monitorCollectors") {
    return snapshot.collectors.map((collector) =>
      ledgerForEntity(collector.id, "collector", collector.name, snapshot, [
        collector.id,
      ]),
    );
  }

  if (page === "monitorRoutes") {
    return snapshot.routes.map((route) =>
      ledgerForEntity(route.id, "route", route.name, snapshot, [
        route.collectorId,
      ]),
    );
  }

  const zones = new Map<string, Set<string>>();
  snapshot.routes.forEach((route) => {
    const collectorIds = zones.get(route.sector) ?? new Set<string>();
    collectorIds.add(route.collectorId);
    zones.set(route.sector, collectorIds);
  });

  return Array.from(zones.entries()).map(([zone, collectorIds]) =>
    ledgerForEntity(zone, "zone", zone, snapshot, Array.from(collectorIds)),
  );
}

function ledgerForEntity(
  entityId: string,
  entityType: MonitorEntity,
  name: string,
  snapshot: Snapshot,
  collectorIds: string[],
): MonitorRow {
  const collectorIdSet = new Set(collectorIds);
  const collectors = snapshot.collectors.filter((collector) =>
    collectorIdSet.has(collector.id),
  );
  const movements = snapshot.movements.filter((movement) =>
    collectorIdSet.has(movement.collectorId),
  );
  const collectionLimit = collectors.reduce(
      (sum, collector) => sum + collector.collectionLimit,
      0,
    ),
    payoutLimit = collectors.reduce(
      (sum, collector) => sum + collector.payoutLimit,
      0,
    ),
    collected = sumMovements(movements, "collection"),
    deposited = sumMovements(movements, "deposit"),
    delivered = sumMovements(movements, "office_delivery"),
    paid = sumMovements(movements, "payout");
  const difference = collected - deposited + (delivered - paid);
  return {
    entityId,
    entityType,
    rawName: name,
    name,
    collectionLimit: money(collectionLimit),
    payoutLimit: money(payoutLimit),
    collected: money(collected),
    deposited: money(deposited),
    delivered: money(delivered),
    paid: money(paid),
    difference: (
      <span className={difference === 0 ? "balanced-text" : "warning-text"}>
        {money(difference)}
      </span>
    ),
  };
}

function sumMovements(
  movements: Snapshot["movements"],
  type: Snapshot["movements"][number]["type"],
) {
  return movements
    .filter((movement) => movement.type === type)
    .reduce((sum, movement) => sum + movement.amount, 0);
}

function moneyFromUnits(value: number) {
  return `RD$ ${new Intl.NumberFormat("es-DO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`;
}

function safeDateLabel(value: string) {
  const dateOnly = value.includes("T") ? value.slice(0, 10) : value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return dateLabel(dateOnly);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("es-DO", { day: "numeric", month: "short" });
}

function abbreviation(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 4)
    .toUpperCase();
}

function Routes({
  snapshot,
  onCollector,
}: {
  snapshot: Snapshot;
  onCollector: (collector: Collector) => void;
}) {
  const [filter, setFilter] = useState("all");
  const collectors = snapshot.collectors.filter(
    (c) => filter === "all" || c.status === filter,
  );
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">
            <span className="live-dot" /> TU EQUIPO EN CAMPO
          </div>
          <h1>
            Conectados en cada ruta<span className="title-dot">.</span>
          </h1>
          <p>Ubicación reportada, estado y efectivo de cada cobrador.</p>
        </div>
        <label className="route-filter">
          <ListFilter size={16} />
          <select
            aria-label="Filtrar estado de cobrador"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">Todos los estados</option>
            <option value="active">En ruta</option>
            <option value="offline">Sin conexión</option>
            <option value="limit">Límite alcanzado</option>
          </select>
        </label>
      </div>
      <section className="panel full-map-panel">
        <CollectorMap collectors={collectors} onSelect={onCollector} large />
      </section>
      <div className="route-cards">
        {collectors.map((collector, index) => {
          const route = snapshot.routes.find((r) => r.id === collector.routeId);
          return (
            <button
              className="panel route-card"
              key={collector.id}
              onClick={() => onCollector(collector)}
            >
              <div className="route-card-header">
                <Avatar initials={collector.initials} index={index} />
                <Badge status={collector.status} />
              </div>
              <h2>{collector.name}</h2>
              <p>
                <MapPinned size={14} />
                {route?.name} · {route?.sector}
              </p>
              <div className="route-card-amount">
                <span>Efectivo en mano</span>
                <strong>{money(collector.cashInHand)}</strong>
              </div>
              <div className="route-card-footer">
                <span>
                  {
                    snapshot.clients.filter(
                      (c) => c.routeId === collector.routeId,
                    ).length
                  }{" "}
                  clientes asignados
                </span>
                <ArrowUpRight size={18} />
              </div>
            </button>
          );
        })}
      </div>
      {!collectors.length && (
        <Empty
          title="Sin cobradores en este estado"
          text="Prueba con otro filtro para ver a tu equipo."
        />
      )}
    </>
  );
}

function Movements({ snapshot }: { snapshot: Snapshot }) {
  const [type, setType] = useState("all"),
    [search, setSearch] = useState(""),
    [limit, setLimit] = useState(15);
  const labels = {
    collection: "Cobro",
    deposit: "Depósito",
    office_delivery: "Entrega de oficina",
    payout: "Pago a cliente",
  };
  const filtered = [...snapshot.movements]
    .filter(
      (m) =>
        (type === "all" || m.type === type) &&
        `${snapshot.clients.find((c) => c.id === m.clientId)?.name ?? ""} ${snapshot.collectors.find((c) => c.id === m.collectorId)?.name ?? ""} ${m.id}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">TRAZABILIDAD OPERATIVA</div>
          <h1>
            La historia de cada movimiento<span className="title-dot">.</span>
          </h1>
          <p>Cada entrada, cada salida y su responsable, en un solo lugar.</p>
        </div>
        <button
          className="btn"
          onClick={() =>
            exportCsv(`cyp-movimientos-${snapshot.businessDate}.csv`, [
              ["Referencia", "Fecha", "Tipo", "Cobrador", "Monto"],
              ...filtered.map((m) => [
                m.id,
                m.createdAt,
                labels[m.type],
                snapshot.collectors.find((c) => c.id === m.collectorId)?.name ??
                  "",
                m.amount / 100,
              ]),
            ])
          }
        >
          <Download size={16} />
          Exportar CSV
        </button>
      </div>
      <section className="panel">
        <SectionHeading
          title="Libro de movimientos"
          subtitle={`${filtered.length} operaciones confirmadas`}
        />
        <div className="table-toolbar">
          <label className="table-search">
            <Search size={17} />
            <input
              aria-label="Buscar movimiento"
              placeholder="Cliente, cobrador o referencia…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="route-filter">
            <ListFilter size={16} />
            <select
              aria-label="Tipo de movimiento"
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              <option value="all">Todos los movimientos</option>
              {Object.entries(labels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {filtered.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Movimiento</th>
                  <th>Cliente</th>
                  <th>Cobrador</th>
                  <th>Fecha y hora</th>
                  <th className="align-right">Monto</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className="movement-type">
                        <span
                          className={`activity-symbol ${m.type === "collection" || m.type === "deposit" ? "in" : "out"}`}
                        >
                          {m.type === "collection" || m.type === "deposit" ? (
                            <ArrowDownLeft size={17} />
                          ) : (
                            <ArrowUpRight size={17} />
                          )}
                        </span>
                        <span>
                          <strong>{labels[m.type]}</strong>
                          <small title={m.id}>{m.id.slice(0, 14)}</small>
                        </span>
                      </div>
                    </td>
                    <td>
                      {snapshot.clients.find((c) => c.id === m.clientId)
                        ?.name ?? "Oficina central"}
                    </td>
                    <td>
                      {
                        snapshot.collectors.find((c) => c.id === m.collectorId)
                          ?.name
                      }
                    </td>
                    <td>
                      {dateLabel(
                        new Date(m.createdAt).toLocaleDateString("en-CA", {
                          timeZone: "America/Santo_Domingo",
                        }),
                      )}
                      <small className="cell-subtitle">
                        {timeLabel(m.createdAt)}
                      </small>
                    </td>
                    <td className="align-right amount-cell">
                      {money(m.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Aún no hay movimientos aquí"
            text="Los cobros, pagos, entregas y depósitos confirmados aparecerán en este libro."
          />
        )}
        {filtered.length > limit && (
          <div className="load-more">
            <button
              className="btn"
              onClick={() => setLimit((value) => value + 15)}
            >
              <Plus size={16} />
              Mostrar más movimientos
            </button>
          </div>
        )}
      </section>
    </>
  );
}

