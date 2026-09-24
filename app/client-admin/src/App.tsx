import {
  isValidElement,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
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
  Gamepad2,
  Globe,
  History,
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
  Upload,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
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
  type Charge,
  type Client,
  type ClientMachine,
  type ClientMachineLog,
  type Collector,
  type ClientStatement,
  type Movement,
  type Page,
  type Payout,
  type PublicAccount,
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
const mdiTitle = (page: MdiPage) => {
  if (page === "controlPanel") return "Panel de Control";
  if (isReportPage(page)) return reportTitle(page);
  return pageTitles[page];
};

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

type MdiWindowSize = Pick<MdiWindowState, "width" | "height">;

const focusWindowCollection = (windows: MdiWindowState[], focusedId: string, zIndex: number) =>
  windows.map((item) => {
    if (item.id === focusedId) return { ...item, zIndex, isFocused: true };
    return { ...item, isFocused: false };
  });

const mdiWindowSize = (page: MdiPage): MdiWindowSize => {
  if (page === "controlPanel") return { width: 600, height: 390 };
  if (page === "reports") return { width: 720, height: 430 };
  if (page === "traces" || page === "pcps" || page === "sessions" || page === "clients") return { width: 860, height: 520 };
  if (isMdiOperationPage(page) || isMdiMonitoringPage(page) || isReportPage(page)) return { width: 860, height: 520 };
  return { width: 720, height: 440 };
};

const reactNodeKey = (value: ReactNode): string => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "boolean" || value == null) return "empty";
  if (Array.isArray(value)) return value.map(reactNodeKey).join("-");
  if (isValidElement(value)) {
    if (value.key !== null) return String(value.key);
    const props = value.props as { children?: ReactNode; id?: unknown; value?: unknown; className?: unknown };
    if (typeof props.id === "string" || typeof props.id === "number") return String(props.id);
    if (typeof props.value === "string" || typeof props.value === "number") return String(props.value);
    if (props.children !== undefined) return reactNodeKey(props.children);
    if (typeof value.type === "string") return value.type;
  }
  return "node";
};

const handleKeyboardActivation = (event: ReactKeyboardEvent<HTMLElement>, action: () => void) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
};

const operationTypeForPage = (targetPage: Page): Operation["type"] => {
  if (targetPage === "payouts" || targetPage === "payments") return "payout";
  if (targetPage === "recurringCharges") return "recurring";
  return "charge";
};

const monitorTitleForPage = (page: Page) => {
  if (page === "monitorCollectors") return "Monitor de Cobradores";
  if (page === "monitorZones") return "Monitor de Zonas";
  return "Monitor de Rutas";
};

const adaptedMapForEntity = (entityType: MonitorEntity, title: string, data: MapData): AdaptedMap => {
  if (entityType === "zone") return transformZoneToMap(title, data.stops);
  if (entityType === "route") return transformRouteToMap(title, data.stops);
  return transformCollectorToMap(data.collector, data.stops);
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

function ControlPanelContent({ onLaunch }: Readonly<{ onLaunch: (page: Page, navKey: string) => void }>) {
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

function ReportesLauncher({ onLaunch }: Readonly<{ onLaunch: (page: ReportPageId, navKey: string) => void }>) {
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

function ReportLayout({ title, snapshot, children }: Readonly<{ title: string; snapshot: Snapshot; children?: ReactNode }>) {
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

function ReportView({ page, snapshot }: Readonly<{ page: ReportPageId; snapshot: Snapshot }>) {
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

function MdiWindow({ windowState, onClose, onFocus, onMove, children }: Readonly<{ windowState: MdiWindowState; onClose: (id: string) => void; onFocus: (id: string) => void; onMove: (id: string, x: number, y: number) => void; children: ReactNode }>) {
  const [drag, setDrag] = useState<null | { startX: number; startY: number; x: number; y: number }>(null);
  useEffect(() => {
    if (!drag) return;
    const onMouseMove = (event: MouseEvent) => onMove(windowState.id, Math.max(8, drag.x + event.clientX - drag.startX), Math.max(8, drag.y + event.clientY - drag.startY));
    const onMouseUp = () => setDrag(null);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp, { once: true });
    return () => { document.removeEventListener("mousemove", onMouseMove); document.removeEventListener("mouseup", onMouseUp); };
  }, [drag, onMove, windowState.id]);
  const focusIfNeeded = () => {
    if (!windowState.isFocused) onFocus(windowState.id);
  };
  const startDrag = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button,input,select,textarea,a")) return;
    event.preventDefault();
    event.stopPropagation();
    onFocus(windowState.id);
    setDrag({ startX: event.clientX, startY: event.clientY, x: windowState.x, y: windowState.y });
  };
  return (
    <section className={`mdi-window ${windowState.isFocused ? "focused" : ""}`} style={{ left: windowState.x, top: windowState.y, width: windowState.width, height: windowState.height, zIndex: windowState.zIndex }} onPointerDownCapture={focusIfNeeded} role="dialog" aria-label={windowState.title}>
      <div className="mdi-window-titlebar" onMouseDown={startDrag}><span>{windowState.title}</span><button type="button" aria-label={`Cerrar ${windowState.title}`} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onClose(windowState.id); }}><X size={15} /></button></div>
      <div className="mdi-window-content">{children}</div><span className="mdi-resize-cue" aria-hidden="true" />
    </section>
  );
}

type LegacyToolbarAction = () => void;

const stopToolbarEvent = (event: ReactMouseEvent<HTMLElement>) => {
  event.stopPropagation();
};

const runToolbarAction = (action?: LegacyToolbarAction) => (event: ReactMouseEvent<HTMLButtonElement>) => {
  event.stopPropagation();
  action?.();
};

function LegacyToolbar({ onToggleFilters, filtersVisible = true, onFirst, onPrevious, onNext, onLast, onNew, onEdit, onAccept, onDelete, onRefresh, onPrint, disableNew = false, disableEdit = false, disableAccept = false, disableDelete = false, showEdit = true, deleteIcon = "trash", deleteTitle = "Eliminar", extra }: Readonly<{ onToggleFilters?: () => void; filtersVisible?: boolean; onFirst?: () => void; onPrevious?: () => void; onNext?: () => void; onLast?: () => void; onNew?: () => void; onEdit?: () => void; onAccept?: () => void; onDelete?: () => void; onRefresh?: () => void; onPrint?: () => void; disableNew?: boolean; disableEdit?: boolean; disableAccept?: boolean; disableDelete?: boolean; showEdit?: boolean; deleteIcon?: "trash" | "x"; deleteTitle?: string; extra?: ReactNode }>) {
  return (
    <div className="legacy-mdi-toolbar" aria-label="Barra de herramientas legacy" onMouseDown={stopToolbarEvent} onClick={stopToolbarEvent}>
      {onToggleFilters && <button type="button" className={filtersVisible ? "nav-tool active" : "nav-tool"} title="Mostrar/Ocultar filtros" onClick={runToolbarAction(onToggleFilters)}><KeyRound size={15} /></button>}
      <button type="button" className="nav-tool" title="Mover al inicio" onClick={runToolbarAction(onFirst)}>|&lt;</button>
      <button type="button" className="nav-tool" title="Subir" onClick={runToolbarAction(onPrevious)}>&lt;</button>
      <button type="button" className="nav-tool" title="Bajar" onClick={runToolbarAction(onNext)}>&gt;</button>
      <button type="button" className="nav-tool" title="Mover al final" onClick={runToolbarAction(onLast)}>&gt;|</button>
      <span className="mdi-toolbar-separator" />
      <button type="button" title="Nuevo" disabled={disableNew} onClick={runToolbarAction(onNew)}><Plus size={15} /></button>
      {showEdit && <button type="button" title="Editar" disabled={disableEdit} onClick={runToolbarAction(onEdit)}><Pencil size={15} /></button>}
      {onAccept && <button type="button" title="Aceptar depósito" disabled={disableAccept} onClick={runToolbarAction(onAccept)}><ClipboardCheck size={15} /></button>}
      <button type="button" className="danger-tool" title={deleteTitle} disabled={disableDelete} onClick={runToolbarAction(onDelete)}>{deleteIcon === "x" ? <X size={15} /> : <Trash2 size={15} />}</button>
      <button type="button" title="Refrescar" onClick={runToolbarAction(onRefresh)}><RefreshCw size={15} /></button>
      {onPrint && <button type="button" title="Imprimir" onClick={runToolbarAction(onPrint)}><Printer size={15} /></button>}
      {extra && <span className="mdi-toolbar-extra">{extra}</span>}
    </div>
  );
}

function LegacyCheck({ checked = true }: Readonly<{ checked?: boolean }>) { return <input type="checkbox" checked={checked} readOnly aria-label={checked ? "Activo" : "Inactivo"} />; }
function LegacyDenseTable({ columns, rows }: Readonly<{ columns: readonly string[]; rows: readonly ReactNode[][] }>) {
  return (
    <div className="legacy-mdi-table-wrap">
      <table className="legacy-mdi-table">
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rowKey = row.map(reactNodeKey).join("|");
            return (
              <tr key={rowKey}>
                {row.map((cell, cellIndex) => (
                  <td key={`${columns[cellIndex] ?? "cell"}-${reactNodeKey(cell)}`}>{cell}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function LegacySidePanel({ children }: Readonly<{ children: ReactNode }>) { return <aside className="legacy-mdi-side-panel">{children}</aside>; }

function LegacyDialog({ title, onClose, children, className = "", overlayClassName = "" }: Readonly<{ title: string; onClose: () => void; children: ReactNode; className?: string; overlayClassName?: string }>) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<null | { startX: number; startY: number; x: number; y: number }>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const overlays = document.querySelectorAll(".legacy-dialog-overlay");
      if (event.key === "Escape" && overlays[overlays.length - 1] === overlayRef.current) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);
  useEffect(() => {
    if (!drag) return;
    const onMouseMove = (event: MouseEvent) => setOffset({ x: drag.x + event.clientX - drag.startX, y: drag.y + event.clientY - drag.startY });
    const onMouseUp = () => setDrag(null);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp, { once: true });
    return () => { document.removeEventListener("mousemove", onMouseMove); document.removeEventListener("mouseup", onMouseUp); };
  }, [drag]);
  const startDialogDrag = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button,input,select,textarea,a")) return;
    event.preventDefault();
    event.stopPropagation();
    setDrag({ startX: event.clientX, startY: event.clientY, x: offset.x, y: offset.y });
  };
  return createPortal(
    <div ref={overlayRef} className={`legacy-dialog-overlay ${overlayClassName}`} role="presentation">
      <section className={`legacy-dialog ${className}`} style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="legacy-dialog-titlebar" onMouseDown={startDialogDrag}>
          <span>{title}</span>
          <button type="button" aria-label={`Cerrar ${title}`} onMouseDown={(event) => event.stopPropagation()} onClick={onClose}>X</button>
        </div>
        <div className="legacy-dialog-body">{children}</div>
      </section>
    </div>,
    document.body,
  );
}

type CollectorFormDraft = {
  name: string;
  ident: string;
  cellular: string;
  accountId: string;
};

function CollectorFormLegacyDialog({ collector, onClose, onSave }: Readonly<{ collector?: Collector; onClose: () => void; onSave: (draft: CollectorFormDraft) => void }>) {
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

function LegacyAlertDialog({ message, onClose, title = "Mensaje", overlayClassName = "" }: Readonly<{ message: string; onClose: () => void; title?: string; overlayClassName?: string }>) {
  return (
    <LegacyDialog title={title} onClose={onClose} className="legacy-confirm-dialog" overlayClassName={overlayClassName}>
      <div className="legacy-confirm-content"><span className="legacy-question-icon">!</span><p>{message}</p></div>
      <div className="legacy-dialog-actions centered"><button type="button" autoFocus onClick={onClose}>Aceptar</button></div>
    </LegacyDialog>
  );
}

function LegacyConfirmDialog({ title = "Confirm", message, onYes, onNo }: Readonly<{ title?: string; message: string; onYes: () => void; onNo: () => void }>) {
  return (
    <LegacyDialog title={title} onClose={onNo} className="legacy-confirm-dialog">
      <div className="legacy-confirm-content"><span className="legacy-question-icon">?</span><p>{message}</p></div>
      <div className="legacy-dialog-actions centered"><button type="button" onClick={onYes}>Sí</button><button type="button" onClick={onNo}>No</button></div>
    </LegacyDialog>
  );
}

type CollectorZoneAssignment = NonNullable<Collector["zones"]>[number];
type CollectorLimitAssignment = NonNullable<Collector["limits"]>[number];

type CollectorCashBalanceRow = {
  date: string;
  initial: number;
  collected: number;
  deposited: number;
  delivered: number;
  paid: number;
  final: number;
};

function defaultCollectorZones(collector: Collector): CollectorZoneAssignment[] {
  return collector.zones?.length ? collector.zones : [{ id: "zone-default", name: "Zona Centro", from: "001", to: "999" }];
}

function defaultCollectorLimits(collector: Collector): CollectorLimitAssignment[] {
  return collector.limits?.length ? collector.limits : [{ currency: "Peso Dominicano", abbr: "DOP", collectionLimit: collector.collectionLimit, payoutLimit: collector.payoutLimit }];
}

function buildCollectorBalanceRows(collector: Collector, fromDate: string, toDate: string): CollectorCashBalanceRow[] {
  const initial = Math.max(0, Math.round((collector.cashInHand || 0) * 0.35));
  const collected = Math.max(0, Math.round((collector.collectionLimit || 0) * 0.42));
  const deposited = Math.max(0, Math.round(collected * 0.68));
  const delivered = Math.max(0, Math.round((collector.payoutLimit || 0) * 0.55));
  const paid = Math.max(0, Math.round(delivered * 0.74));
  const final = initial + collected - deposited + delivered - paid;
  return [
    { date: fromDate, initial, collected, deposited, delivered, paid, final },
    { date: toDate, initial: final, collected: Math.round(collected * 0.45), deposited: Math.round(deposited * 0.5), delivered: Math.round(delivered * 0.35), paid: Math.round(paid * 0.4), final: final + Math.round(collected * 0.45) - Math.round(deposited * 0.5) + Math.round(delivered * 0.35) - Math.round(paid * 0.4) },
  ];
}

function CollectorZonesLegacyDialog({ collector, onClose }: Readonly<{ collector: Collector; onClose: () => void }>) {
  const initialZones = defaultCollectorZones(collector);
  const [zones, setZones] = useState<CollectorZoneAssignment[]>(() => initialZones);
  const [selectedZoneId, setSelectedZoneId] = useState(zones[0]?.id ?? "");
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const refreshZones = () => {
    const reloaded = defaultCollectorZones(collector);
    setZones(reloaded);
    setSelectedZoneId(reloaded[0]?.id ?? "");
    toast.success("Zonas recargadas");
  };
  const removeSelected = () => {
    setZones((current) => current.filter((zone) => zone.id !== selectedZoneId));
    setSelectedZoneId("");
    setConfirmDelete(false);
    toast.success("Zona eliminada del cobrador");
  };
  return (
    <LegacyDialog title="Zonas del Cobrador..." onClose={onClose} className="collector-relation-dialog">
      <div className="legacy-relation-manager">
        <div className="legacy-relation-toolbar"><button type="button" onClick={() => setAdding(true)}>Agregar</button><button type="button" onClick={() => setConfirmDelete(true)} disabled={!selectedZoneId}>Eliminar</button><button type="button" onClick={refreshZones}>Refrescar</button></div>
        <LegacyDenseTable columns={["Nro", "Zona", "Desde", "Hasta"]} rows={zones.map((zone, index) => [<button type="button" className={`mdi-row-select ${selectedZoneId === zone.id ? "selected" : ""}`} onClick={() => setSelectedZoneId(zone.id)}>{index + 1}</button>, zone.name, zone.from, zone.to])} />
        <div className="legacy-mdi-pager"><button type="button">|&lt;</button><button type="button">&lt;</button><span>Página 1 de 1</span><button type="button">&gt;</button><button type="button">&gt;|</button></div>
        <div className="legacy-relation-footer"><button type="button" onClick={() => toast.success("Zonas guardadas")}>Guardar</button><button type="button" onClick={onClose}>Cancelar</button></div>
      </div>
      {adding && <ZoneSelectDialog onClose={() => setAdding(false)} onSelect={(name) => { const next = { id: `zone-${Date.now()}`, name, from: "001", to: "999" }; setZones((current) => [...current, next]); setSelectedZoneId(next.id); setAdding(false); toast.success("Zona agregada al cobrador"); }} />}
      {confirmDelete && <LegacyConfirmDialog message="¿Está seguro que desea eliminar la Zona actual del Cobrador?" onYes={removeSelected} onNo={() => setConfirmDelete(false)} />}
    </LegacyDialog>
  );
}

function ZoneSelectDialog({ onClose, onSelect }: Readonly<{ onClose: () => void; onSelect: (name: string) => void }>) {
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

function LineSelectDialog({ onClose, onSelect }: Readonly<{ onClose: () => void; onSelect: (limit: CollectorLimitAssignment) => void }>) {
  const options: CollectorLimitAssignment[] = [
    { currency: "Peso Dominicano", abbr: "DOP", collectionLimit: 2500000, payoutLimit: 1000000 },
    { currency: "Dólar Americano", abbr: "USD", collectionLimit: 500000, payoutLimit: 200000 },
    { currency: "Euro", abbr: "EUR", collectionLimit: 450000, payoutLimit: 175000 },
  ];
  const [selectedAbbr, setSelectedAbbr] = useState(options[0].abbr);
  const selected = options.find((option) => option.abbr === selectedAbbr) ?? options[0];
  return (
    <LegacyDialog title="Seleccionar..." onClose={onClose} className="legacy-select-dialog">
      <div className="legacy-dialog-form">
        <label>Seleccione:<select autoFocus value={selectedAbbr} onChange={(event) => setSelectedAbbr(event.target.value)}>{options.map((option) => <option key={option.abbr} value={option.abbr}>{option.currency}</option>)}</select></label>
        <div className="legacy-dialog-actions centered"><button type="button" onClick={() => onSelect(selected)}>oK</button><button type="button" onClick={onClose}>Cancelar</button></div>
      </div>
    </LegacyDialog>
  );
}

function RouteSelectDialog({ routes, assignedRouteIds, onClose, onSelect }: Readonly<{ routes: readonly Snapshot["routes"][number][]; assignedRouteIds: readonly string[]; onClose: () => void; onSelect: (routeId: string) => void }>) {
  const availableRoutes = routes.filter((route) => !assignedRouteIds.includes(route.id));
  const [selectedRouteId, setSelectedRouteId] = useState(availableRoutes[0]?.id ?? "");
  return (
    <LegacyDialog title="Seleccionar..." onClose={onClose} className="legacy-select-dialog">
      <div className="legacy-dialog-form">
        <label>Seleccione:<select autoFocus value={selectedRouteId} onChange={(event) => setSelectedRouteId(event.target.value)}>{availableRoutes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}</select></label>
        <div className="legacy-dialog-actions centered"><button type="button" disabled={!selectedRouteId} onClick={() => onSelect(selectedRouteId)}>oK</button><button type="button" onClick={onClose}>Cancelar</button></div>
      </div>
    </LegacyDialog>
  );
}

function CollectorLimitsLegacyDialog({ collector, onClose }: Readonly<{ collector: Collector; onClose: () => void }>) {
  const initialLimits = defaultCollectorLimits(collector);
  const [limits, setLimits] = useState<CollectorLimitAssignment[]>(() => initialLimits);
  const [selectedAbbr, setSelectedAbbr] = useState(limits[0]?.abbr ?? "");
  const [adding, setAdding] = useState(false);
  const addLimit = (limit: CollectorLimitAssignment) => {
    const next = limits.some((current) => current.abbr === limit.abbr) ? { ...limit, abbr: `${limit.abbr}${limits.length + 1}` } : limit;
    setLimits((current) => [...current, next]);
    setSelectedAbbr(next.abbr);
    setAdding(false);
    toast.success("Línea agregada al cobrador");
  };
  const removeLimit = () => {
    setLimits((current) => current.filter((limit) => limit.abbr !== selectedAbbr));
    setSelectedAbbr("");
  };
  const refreshLimits = () => {
    const reloaded = defaultCollectorLimits(collector);
    setLimits(reloaded);
    setSelectedAbbr(reloaded[0]?.abbr ?? "");
    toast.success("Límites recargados");
  };
  return (
    <LegacyDialog title="Líneas / Límites del Cobrador" onClose={onClose} className="collector-relation-dialog limits-dialog">
      <div className="legacy-relation-manager">
        <div className="legacy-relation-toolbar"><button type="button" onClick={() => setAdding(true)}>Agregar</button><button type="button" onClick={removeLimit} disabled={!selectedAbbr}>Eliminar</button><button type="button" onClick={refreshLimits}>Refrescar</button></div>
        <LegacyDenseTable columns={["Moneda", "Abrev", "Lim. de Cobro", "Lim. de Pago"]} rows={limits.map((limit) => [<button type="button" className={`mdi-row-select ${selectedAbbr === limit.abbr ? "selected" : ""}`} onClick={() => setSelectedAbbr(limit.abbr)}>{limit.currency}</button>, limit.abbr, money(limit.collectionLimit), money(limit.payoutLimit)])} />
        <div className="legacy-relation-footer"><button type="button" onClick={() => toast.success("Límites guardados")}>Guardar</button><button type="button" onClick={onClose}>Cancelar</button></div>
      </div>
      {adding && <LineSelectDialog onClose={() => setAdding(false)} onSelect={addLimit} />}
    </LegacyDialog>
  );
}

function CollectorRoutesLegacyDialog({ collector, snapshot, onClose }: Readonly<{ collector: Collector; snapshot: Snapshot; onClose: () => void }>) {
  const initialRoutes = collector.assignedRoutes?.length ? collector.assignedRoutes : [collector.routeId];
  const [routes, setRoutes] = useState<string[]>(() => initialRoutes);
  const [selectedRouteId, setSelectedRouteId] = useState(routes[0] ?? "");
  const [adding, setAdding] = useState(false);
  const addRoute = (routeId: string) => {
    setRoutes((current) => [...current, routeId]);
    setSelectedRouteId(routeId);
    setAdding(false);
    toast.success("Ruta agregada al cobrador");
  };
  const removeRoute = () => {
    setRoutes((current) => current.filter((routeId) => routeId !== selectedRouteId));
    setSelectedRouteId("");
  };
  const refreshRoutes = () => {
    setRoutes(initialRoutes);
    setSelectedRouteId(initialRoutes[0] ?? "");
    toast.success("Rutas recargadas");
  };
  return (
    <LegacyDialog title="Rutas del Cobrador..." onClose={onClose} className="collector-relation-dialog routes-dialog">
      <div className="legacy-relation-manager">
        <div className="legacy-relation-toolbar"><button type="button" onClick={() => snapshot.routes.some((route) => !routes.includes(route.id)) ? setAdding(true) : toast.info("No hay rutas disponibles para agregar.")}>Agregar</button><button type="button" onClick={removeRoute} disabled={!selectedRouteId}>Eliminar</button><button type="button" onClick={refreshRoutes}>Refrescar</button></div>
        <LegacyDenseTable columns={["Nro_Ruta", "Ruta"]} rows={routes.map((routeId, index) => [<button type="button" className={`mdi-row-select ${selectedRouteId === routeId ? "selected" : ""}`} onClick={() => setSelectedRouteId(routeId)}>{index + 1}</button>, snapshot.routes.find((route) => route.id === routeId)?.name ?? routeId])} />
        <div className="legacy-mdi-pager"><button type="button">|&lt;</button><button type="button">&lt;</button><span>Página 1 de 1</span><button type="button">&gt;</button><button type="button">&gt;|</button></div>
        <div className="legacy-relation-footer"><button type="button" onClick={() => toast.success("Rutas guardadas")}>Guardar</button><button type="button" onClick={onClose}>Cancelar</button></div>
      </div>
      {adding && <RouteSelectDialog routes={snapshot.routes} assignedRouteIds={routes} onClose={() => setAdding(false)} onSelect={addRoute} />}
    </LegacyDialog>
  );
}

function CollectorCashBalancesDialog({ collector, onClose }: Readonly<{ collector: Collector; onClose: () => void }>) {
  const today = new Date().toISOString().slice(0, 10);
  const [currency, setCurrency] = useState("Peso Dominicano");
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [rows, setRows] = useState<CollectorCashBalanceRow[]>(() => buildCollectorBalanceRows(collector, today, today));
  const refreshBalances = () => {
    setRows(buildCollectorBalanceRows(collector, fromDate, toDate));
    toast.success("Balances de efectivo actualizados");
  };
  return (
    <LegacyDialog title="Balances de Efectivo del Cobrador" onClose={onClose} className="collector-balance-dialog">
      <div className="collector-balance-layout">
        <div className="collector-balance-filters">
          <label>Moneda<select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>Peso Dominicano</option><option>Dólar Americano</option><option>Euro</option></select></label>
          <label>Fecha Inicial<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
          <label>Fecha Final<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
          <button type="button" onClick={refreshBalances}><RefreshCw size={14} />Refrescar</button>
        </div>
        <LegacyDenseTable columns={["Fecha", "Inicial", "Cobrado", "Depositado", "Entregado", "Pagado", "Final"]} rows={rows.map((row) => [row.date, money(row.initial), money(row.collected), money(row.deposited), money(row.delivered), money(row.paid), money(row.final)])} />
        <div className="legacy-relation-footer"><button type="button" onClick={onClose}>OK</button><button type="button" onClick={onClose}>Cancelar</button></div>
      </div>
    </LegacyDialog>
  );
}

function CollectorsLegacyView({ snapshot, onRefresh }: Readonly<{ snapshot: Snapshot; onRefresh: () => void }>) {
  const [collectors, setCollectors] = useState<Collector[]>(() => snapshot.collectors);
  const [selectedCollectorId, setSelectedCollectorId] = useState(snapshot.collectors[0]?.id ?? "");
  const [formMode, setFormMode] = useState<"new" | "edit" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [relationDialog, setRelationDialog] = useState<"zones" | "limits" | "routes" | "balances" | null>(null);
  const selectedCollector = collectors.find((collector) => collector.id === selectedCollectorId) ?? collectors[0];
  const selectCollector = (collectorId: string) => setSelectedCollectorId(collectorId);
  const moveSelectedCollector = (direction: "first" | "up" | "down" | "last") => {
    const currentIndex = collectors.findIndex((collector) => collector.id === selectedCollectorId);
    if (currentIndex < 0) return toast.info("Seleccione un cobrador.");
    const targetIndexByDirection = {
      first: 0,
      up: Math.max(0, currentIndex - 1),
      down: Math.min(collectors.length - 1, currentIndex + 1),
      last: collectors.length - 1,
    } satisfies Record<typeof direction, number>;
    const targetIndex = targetIndexByDirection[direction];
    if (targetIndex === currentIndex) return toast.info("El cobrador ya está en esa posición.");
    setCollectors((current) => {
      const reordered = [...current];
      const [selected] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, selected);
      return reordered;
    });
  };
  const refreshCollectors = () => {
    setCollectors(snapshot.collectors);
    setSelectedCollectorId(snapshot.collectors[0]?.id ?? "");
    onRefresh();
    toast.success("Cobradores recargados");
  };
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
      <LegacyToolbar onFirst={() => moveSelectedCollector("first")} onPrevious={() => moveSelectedCollector("up")} onNext={() => moveSelectedCollector("down")} onLast={() => moveSelectedCollector("last")} onNew={() => setFormMode("new")} onEdit={() => selectedCollector ? setFormMode("edit") : toast.info("Seleccione un cobrador.")} onDelete={() => selectedCollector ? setConfirmDelete(true) : toast.info("Seleccione un cobrador.")} onRefresh={refreshCollectors} extra={<><button type="button" disabled={!selectedCollector} onClick={() => setRelationDialog("zones")}>Z</button><button type="button" disabled={!selectedCollector} onClick={() => setRelationDialog("limits")}>L</button><button type="button" disabled={!selectedCollector} onClick={() => setRelationDialog("routes")}>R</button><button type="button" disabled={!selectedCollector} title="Balances de Efectivo" onClick={() => setRelationDialog("balances")}><Wallet size={15} /></button></>} />
      <div className="legacy-mdi-table-wrap">
        <table className="legacy-mdi-table collectors-grid">
          <thead><tr><th>Cod.</th><th>Cobrador</th><th>Celular</th><th>Cuenta</th><th>Act.</th></tr></thead>
          <tbody>
            {collectors.map((collector, index) => {
              const isSelected = selectedCollectorId === collector.id;
              return (
                <tr key={collector.id} className={isSelected ? "selected-row" : ""} role="button" tabIndex={0} onClick={() => selectCollector(collector.id)} onKeyDown={(event) => handleKeyboardActivation(event, () => selectCollector(collector.id))}>
                  <td><span className={`mdi-row-select ${isSelected ? "selected" : ""}`}>{String(index + 1).padStart(3, "0")}</span></td>
                  <td>{collector.name}</td>
                  <td>{collector.cellular ?? "809-000-0000"}</td>
                  <td>{collector.accountId ?? "cob"}</td>
                  <td><LegacyCheck checked={collector.status !== "offline"} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {formMode && <CollectorFormLegacyDialog collector={formMode === "edit" ? selectedCollector : undefined} onClose={() => setFormMode(null)} onSave={saveCollector} />}
      {confirmDelete && <LegacyConfirmDialog message="¿Inactivar datos?" onYes={inactivateCollector} onNo={() => setConfirmDelete(false)} />}
      {relationDialog === "zones" && selectedCollector && <CollectorZonesLegacyDialog collector={selectedCollector} onClose={() => setRelationDialog(null)} />}
      {relationDialog === "limits" && selectedCollector && <CollectorLimitsLegacyDialog collector={selectedCollector} onClose={() => setRelationDialog(null)} />}
      {relationDialog === "routes" && selectedCollector && <CollectorRoutesLegacyDialog collector={selectedCollector} snapshot={snapshot} onClose={() => setRelationDialog(null)} />}
      {relationDialog === "balances" && selectedCollector && <CollectorCashBalancesDialog collector={selectedCollector} onClose={() => setRelationDialog(null)} />}
    </div>
  );
}

type PcpStationRecord = {
  id: string;
  internalId: string;
  number: number;
  station: string;
  deviceId: string;
  license: string;
  version: string;
  receivedVersion: string;
  description: string;
  group: string;
  type: string;
  active: boolean;
};

type PcpStationDraft = Omit<PcpStationRecord, "id" | "active" | "version" | "receivedVersion"> & {
  active: boolean;
  version?: string;
  receivedVersion?: string;
};

const defaultPcpStations = (): PcpStationRecord[] => [
  { id: "station-adm001", internalId: "1", number: 1, station: "ADM001", deviceId: "PC-ADM001", license: "CYP-ADM-001", version: "1.0.0", receivedVersion: "1.0.0", description: "Oficina principal administrativa", group: "Cobros", type: "Administración", active: true },
  { id: "station-ecp001", internalId: "2", number: 2, station: "ECP001", deviceId: "TERM-ECP001", license: "CYP-ECP-001", version: "1.0.0", receivedVersion: "1.0.0", description: "Terminal Centro", group: "Cobros", type: "Cobros y Pagos", active: true },
  { id: "station-ecp002", internalId: "3", number: 3, station: "ECP002", deviceId: "TERM-ECP002", license: "CYP-ECP-002", version: "1.0.0", receivedVersion: "1.0.0", description: "Terminal Norte", group: "Cobros", type: "Cobros y Pagos", active: false },
];

function emptyPcpStationDraft(): PcpStationDraft {
  return {
    internalId: "-1",
    number: 0,
    station: "",
    deviceId: "",
    license: "",
    description: "",
    group: "Cobros",
    type: "Cobros y Pagos",
    active: true,
    version: "1.0.0",
    receivedVersion: "1.0.0",
  };
}

function stationToDraft(station: PcpStationRecord): PcpStationDraft {
  return {
    internalId: station.internalId,
    number: station.number,
    station: station.station,
    deviceId: station.deviceId,
    license: station.license,
    description: station.description,
    group: station.group,
    type: station.type,
    active: station.active,
    version: station.version,
    receivedVersion: station.receivedVersion,
  };
}

function PcpStationDialog({ station, onClose, onSave }: Readonly<{ station?: PcpStationRecord; onClose: () => void; onSave: (draft: PcpStationDraft) => void }>) {
  const [draft, setDraft] = useState<PcpStationDraft>(() => station ? stationToDraft(station) : emptyPcpStationDraft());
  const [validationMessage, setValidationMessage] = useState("");
  const update = (field: keyof PcpStationDraft, value: string | number | boolean) => setDraft((current) => ({ ...current, [field]: value }));
  const validateStationName = () => {
    const stationCode = draft.station.trim();
    if (!stationCode) {
      setValidationMessage("El campo Nombre no puede estar vacío");
      return "";
    }
    return stationCode;
  };
  const obtainData = () => {
    const stationCode = validateStationName();
    if (!stationCode) return;
    setDraft((current) => ({ ...current, deviceId: `TERM-${stationCode}-${String(Date.now()).slice(-3)}`, description: current.description || `Terminal operativa ${stationCode}` }));
    toast.success("Datos de estación obtenidos");
  };
  const obtainLicense = () => {
    const stationCode = validateStationName();
    if (!stationCode) return;
    setDraft((current) => ({ ...current, license: `CYP-${stationCode}-${String(Date.now()).slice(-4)}` }));
    toast.success("Licencia generada");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.station.trim()) return toast.error("La estación es requerida.");
    if (draft.number < 0) return toast.error("El número de estación no puede ser negativo.");
    onSave(draft);
  };
  return (
    <LegacyDialog title="Datos de la Estación de PCP" onClose={onClose} className="pcp-station-dialog">
      <form className="legacy-dialog-form pcp-station-form" onSubmit={submit}>
        <div className="legacy-tabs compact" role="tablist" aria-label="Datos de la Estación de PCP"><button type="button" className="active">General</button></div>
        <fieldset className="legacy-config-fieldset station-general-fieldset">
          <legend>General</legend>
          <div className="station-internal-id">{draft.internalId}</div>
          <label>Estación:<input autoFocus value={draft.station} onChange={(event) => update("station", event.target.value)} /></label>
          <div className="legacy-dialog-row two-cols">
            <label>Nro.:<input type="number" value={draft.number} onChange={(event) => update("number", Number(event.target.value))} /></label>
            <label>ID:<input value={draft.deviceId} onChange={(event) => update("deviceId", event.target.value)} /></label>
          </div>
          <div className="legacy-dialog-row license-row">
            <label>Lic.:<input value={draft.license} onChange={(event) => update("license", event.target.value)} /></label>
            <button type="button" onClick={obtainData}>Obtener Datos</button>
            <button type="button" onClick={obtainLicense}>Obtener Licencia</button>
          </div>
          <label>Descrip.:<input value={draft.description} onChange={(event) => update("description", event.target.value)} /></label>
          <div className="legacy-dialog-row two-cols">
            <label>Grupo:<select value={draft.group} onChange={(event) => update("group", event.target.value)}><option>Cobros</option><option>Grupo Principal</option><option>df</option><option>GRUPO MAYITO</option></select></label>
            <label>Tipo:<select value={draft.type} onChange={(event) => update("type", event.target.value)}><option>Cobros y Pagos</option><option>Cobros</option><option>Pagos</option><option>Administración</option></select></label>
          </div>
        </fieldset>
        <div className="legacy-dialog-actions centered"><button type="submit">oK</button><button type="button" onClick={onClose}>Cancelar</button></div>
      </form>
      {validationMessage && <LegacyAlertDialog message={validationMessage} onClose={() => setValidationMessage("")} />}
    </LegacyDialog>
  );
}

type DelayReasonRecord = {
  id: string;
  reason: string;
  active: boolean;
};

const defaultDelayReasons = (): DelayReasonRecord[] => [
  { id: "delay-local-closed", reason: "Local cerrado", active: true },
  { id: "delay-client-absent", reason: "Cliente ausente", active: true },
  { id: "delay-promise", reason: "Promesa de pago", active: true },
  { id: "delay-no-cash", reason: "Sin efectivo disponible", active: true },
];

function DelayReasonValueDialog({ reason, onClose, onSave }: Readonly<{ reason?: DelayReasonRecord; onClose: () => void; onSave: (value: string) => void }>) {
  const [value, setValue] = useState(reason?.reason ?? "");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) return toast.error("El valor es requerido.");
    onSave(value.trim());
  };
  return (
    <LegacyDialog title="Entre un valor..." onClose={onClose} className="legacy-select-dialog">
      <form className="legacy-dialog-form" onSubmit={submit}>
        <label>Valor:<input type="text" autoFocus value={value} onChange={(event) => setValue(event.target.value)} /></label>
        <div className="legacy-dialog-actions centered"><button type="submit">oK</button><button type="button" onClick={onClose}>Cancelar</button></div>
      </form>
    </LegacyDialog>
  );
}

function DelayReasonsLegacyView(): ReactNode {
  const [reasons, setReasons] = useState<DelayReasonRecord[]>(() => defaultDelayReasons());
  const [selectedReasonId, setSelectedReasonId] = useState(reasons[0]?.id ?? "");
  const [formMode, setFormMode] = useState<"new" | "edit" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selectedReason = reasons.find((reason) => reason.id === selectedReasonId) ?? reasons[0];
  const moveSelectedReason = (direction: "first" | "up" | "down" | "last") => {
    const currentIndex = reasons.findIndex((reason) => reason.id === selectedReasonId);
    if (currentIndex < 0) return toast.info("Seleccione un motivo.");
    const targetIndexByDirection = {
      first: 0,
      up: Math.max(0, currentIndex - 1),
      down: Math.min(reasons.length - 1, currentIndex + 1),
      last: reasons.length - 1,
    } satisfies Record<typeof direction, number>;
    const targetIndex = targetIndexByDirection[direction];
    if (targetIndex === currentIndex) return toast.info("El motivo ya está en esa posición.");
    setReasons((current) => {
      const reordered = [...current];
      const [selected] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, selected);
      return reordered;
    });
  };
  const refreshReasons = () => {
    const reloaded = defaultDelayReasons();
    setReasons(reloaded);
    setSelectedReasonId(reloaded[0]?.id ?? "");
    toast.success("Motivos recargados");
  };
  const saveReason = (value: string) => {
    if (formMode === "edit" && selectedReason) {
      setReasons((current) => current.map((reason) => reason.id === selectedReason.id ? { ...reason, reason: value } : reason));
      toast.success("Motivo actualizado");
    } else {
      const next = { id: `delay-local-${Date.now()}`, reason: value, active: true };
      setReasons((current) => [...current, next]);
      setSelectedReasonId(next.id);
      toast.success("Motivo creado");
    }
    setFormMode(null);
  };
  const deleteReason = () => {
    if (!selectedReason) return;
    setReasons((current) => current.filter((reason) => reason.id !== selectedReason.id));
    setSelectedReasonId("");
    setConfirmDelete(false);
    toast.success("Motivo eliminado");
  };
  return (
    <div className="legacy-mdi-view">
      <LegacyToolbar onFirst={() => moveSelectedReason("first")} onPrevious={() => moveSelectedReason("up")} onNext={() => moveSelectedReason("down")} onLast={() => moveSelectedReason("last")} onNew={() => setFormMode("new")} onEdit={() => selectedReason ? setFormMode("edit") : toast.info("Seleccione un motivo.")} onDelete={() => selectedReason ? setConfirmDelete(true) : toast.info("Seleccione un motivo.")} onRefresh={refreshReasons} />
      <div className="legacy-mdi-table-wrap">
        <table className="legacy-mdi-table delay-reasons-grid">
          <thead><tr><th>Nro.</th><th>Motivo</th><th>Activo</th></tr></thead>
          <tbody>
            {reasons.map((reason, index) => {
              const isSelected = selectedReasonId === reason.id;
              return (
                <tr key={reason.id} className={isSelected ? "selected-row" : ""} role="button" tabIndex={0} onClick={() => setSelectedReasonId(reason.id)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedReasonId(reason.id))}>
                  <td><span className={`mdi-row-select ${isSelected ? "selected" : ""}`}>{index + 1}</span></td>
                  <td>{reason.reason}</td>
                  <td><LegacyCheck checked={reason.active} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {formMode && <DelayReasonValueDialog reason={formMode === "edit" ? selectedReason : undefined} onClose={() => setFormMode(null)} onSave={saveReason} />}
      {confirmDelete && <LegacyConfirmDialog message="¿Realmente desea borrar los datos?" onYes={deleteReason} onNo={() => setConfirmDelete(false)} />}
    </div>
  );
}

type RouteRecord = {
  id: string;
  number: string;
  name: string;
  from: string;
  to: string;
  active: boolean;
};

type RouteDraft = Omit<RouteRecord, "id" | "active"> & { active: boolean };

function defaultRouteRecords(snapshot: Snapshot): RouteRecord[] {
  return snapshot.routes.map((route, index) => ({
    id: route.id,
    number: String(index + 1),
    name: route.name,
    from: "001",
    to: "999",
    active: true,
  }));
}

function emptyRouteDraft(): RouteDraft {
  return { number: "", name: "", from: "", to: "", active: true };
}

function routeToDraft(route: RouteRecord): RouteDraft {
  return { number: route.number, name: route.name, from: route.from, to: route.to, active: route.active };
}

function RouteDataDialog({ route, onClose, onSave }: Readonly<{ route?: RouteRecord; onClose: () => void; onSave: (draft: RouteDraft) => void }>) {
  const [draft, setDraft] = useState<RouteDraft>(() => route ? routeToDraft(route) : emptyRouteDraft());
  const [validationMessage, setValidationMessage] = useState("");
  const update = (field: keyof RouteDraft, value: string | boolean) => setDraft((current) => ({ ...current, [field]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.number.trim()) {
      setValidationMessage("El campo 'Número de Ruta' no puede estar vacío");
      return;
    }
    onSave(draft);
  };
  return (
    <LegacyDialog title="Datos de Ruta..." onClose={onClose} className="route-data-dialog">
      <form className="legacy-dialog-form legacy-route-form" onSubmit={submit}>
        <div className="route-form-row route-code-row">
          <span className="route-form-label">Ruta:</span>
          <input className="route-code-input" autoFocus value={draft.number} onChange={(event) => update("number", event.target.value)} />
          <input className="route-name-input" value={draft.name} onChange={(event) => update("name", event.target.value)} />
        </div>
        <label className="route-form-row"><span className="route-form-label">Desde:</span><input type="text" value={draft.from} onChange={(event) => update("from", event.target.value)} /></label>
        <label className="route-form-row"><span className="route-form-label">Hasta:</span><input type="text" value={draft.to} onChange={(event) => update("to", event.target.value)} /></label>
        <div className="legacy-dialog-actions centered route-form-actions"><button type="submit">oK</button><button type="button" onClick={onClose}>Cancelar</button></div>
      </form>
      {validationMessage && <LegacyAlertDialog message={validationMessage} onClose={() => setValidationMessage("")} />}
    </LegacyDialog>
  );
}

function RouteClientsDialog({ route, clients, onClose }: Readonly<{ route?: RouteRecord; clients: readonly Client[]; onClose: () => void }>) {
  const [assignedClients, setAssignedClients] = useState(() => clients.slice(0, Math.min(8, clients.length)));
  const [selectedClientId, setSelectedClientId] = useState(assignedClients[0]?.id ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const addClient = () => {
    const available = clients.find((client) => !assignedClients.some((assigned) => assigned.id === client.id));
    if (!available) return toast.info("No hay clientes disponibles.");
    setAssignedClients((current) => [...current, available]);
    setSelectedClientId(available.id);
    toast.success("Cliente agregado a la ruta");
  };
  const deleteClient = () => {
    setAssignedClients((current) => current.filter((client) => client.id !== selectedClientId));
    setSelectedClientId("");
    setConfirmDelete(false);
    toast.success("Cliente eliminado de la ruta");
  };
  return (
    <LegacyDialog title="Clientes de la Ruta..." onClose={onClose} className="route-clients-dialog">
      <div className="legacy-relation-manager">
        <div className="legacy-relation-toolbar"><button type="button" onClick={addClient}>Agregar</button><button type="button" disabled={!selectedClientId} onClick={() => setConfirmDelete(true)}>Eliminar</button><button type="button" onClick={() => toast.success("Clientes recargados")}>Refrescar</button></div>
        <div className="legacy-mdi-table-wrap">
          <table className="legacy-mdi-table route-clients-grid">
            <thead><tr><th>Nro</th><th>Código</th><th>Cliente</th><th>Teléfono</th></tr></thead>
            <tbody>{assignedClients.map((client, index) => {
              const isSelected = selectedClientId === client.id;
              return <tr key={client.id} className={isSelected ? "selected-row" : ""} role="button" tabIndex={0} onClick={() => setSelectedClientId(client.id)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedClientId(client.id))}><td><span className={`mdi-row-select ${isSelected ? "selected" : ""}`}>{index + 1}</span></td><td>{client.code}</td><td>{client.name}</td><td>{client.phone}</td></tr>;
            })}</tbody>
          </table>
        </div>
        <div className="legacy-mdi-pager"><button type="button">|&lt;</button><button type="button">&lt;</button><span>{route?.name ?? "Ruta"} · Página 1 de 1</span><button type="button">&gt;</button><button type="button">&gt;|</button><button type="button" onClick={onClose}>Cerrar</button></div>
      </div>
      {confirmDelete && <LegacyConfirmDialog message="¿Realmente desea borrar los datos?" onYes={deleteClient} onNo={() => setConfirmDelete(false)} />}
    </LegacyDialog>
  );
}

function RoutesLegacyView({ snapshot }: Readonly<{ snapshot: Snapshot }>): ReactNode {
  const [routesData, setRoutesData] = useState<RouteRecord[]>(() => defaultRouteRecords(snapshot));
  const [selectedRouteId, setSelectedRouteId] = useState(routesData[0]?.id ?? "");
  const [formMode, setFormMode] = useState<"new" | "edit" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [clientsOpen, setClientsOpen] = useState(false);
  const selectedRoute = routesData.find((route) => route.id === selectedRouteId) ?? routesData[0];
  const moveSelectedRoute = (direction: "first" | "up" | "down" | "last") => {
    const currentIndex = routesData.findIndex((route) => route.id === selectedRouteId);
    if (currentIndex < 0) return toast.info("Seleccione una ruta.");
    const targetIndexByDirection = { first: 0, up: Math.max(0, currentIndex - 1), down: Math.min(routesData.length - 1, currentIndex + 1), last: routesData.length - 1 } satisfies Record<typeof direction, number>;
    const targetIndex = targetIndexByDirection[direction];
    if (targetIndex === currentIndex) return toast.info("La ruta ya está en esa posición.");
    setRoutesData((current) => {
      const reordered = [...current];
      const [selected] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, selected);
      return reordered;
    });
  };
  const refreshRoutes = () => {
    const reloaded = defaultRouteRecords(snapshot);
    setRoutesData(reloaded);
    setSelectedRouteId(reloaded[0]?.id ?? "");
    toast.success("Rutas recargadas");
  };
  const saveRoute = (draft: RouteDraft) => {
    if (formMode === "edit" && selectedRoute) {
      setRoutesData((current) => current.map((route) => route.id === selectedRoute.id ? { ...route, ...draft } : route));
      toast.success("Ruta actualizada");
    } else {
      const next = { id: `route-local-${Date.now()}`, ...draft };
      setRoutesData((current) => [...current, next]);
      setSelectedRouteId(next.id);
      toast.success("Ruta creada");
    }
    setFormMode(null);
  };
  const inactivateRoute = () => {
    if (!selectedRoute) return;
    setRoutesData((current) => current.map((route) => route.id === selectedRoute.id ? { ...route, active: false } : route));
    setConfirmDelete(false);
    toast.success("Ruta inactivada");
  };
  return (
    <div className="legacy-mdi-view">
      <LegacyToolbar onFirst={() => moveSelectedRoute("first")} onPrevious={() => moveSelectedRoute("up")} onNext={() => moveSelectedRoute("down")} onLast={() => moveSelectedRoute("last")} onNew={() => setFormMode("new")} onEdit={() => selectedRoute ? setFormMode("edit") : toast.info("Seleccione una ruta.")} onDelete={() => selectedRoute ? setConfirmDelete(true) : toast.info("Seleccione una ruta.")} onRefresh={refreshRoutes} extra={<button type="button" disabled={!selectedRoute} title="Clientes de la Ruta" onClick={() => setClientsOpen(true)}><Users size={15} /> Clientes</button>} />
      <div className="legacy-mdi-table-wrap">
        <table className="legacy-mdi-table routes-grid">
          <thead><tr><th>Nro.</th><th>Ruta</th><th>Desde</th><th>Hasta</th><th>Activo</th></tr></thead>
          <tbody>{routesData.map((route) => {
            const isSelected = selectedRouteId === route.id;
            return <tr key={route.id} className={isSelected ? "selected-row" : ""} role="button" tabIndex={0} onClick={() => setSelectedRouteId(route.id)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedRouteId(route.id))}><td><span className={`mdi-row-select ${isSelected ? "selected" : ""}`}>{route.number}</span></td><td>{route.name}</td><td>{route.from}</td><td>{route.to}</td><td><LegacyCheck checked={route.active} /></td></tr>;
          })}</tbody>
        </table>
      </div>
      {formMode && <RouteDataDialog route={formMode === "edit" ? selectedRoute : undefined} onClose={() => setFormMode(null)} onSave={saveRoute} />}
      {confirmDelete && <LegacyConfirmDialog message="¿Inactivar datos?" onYes={inactivateRoute} onNo={() => setConfirmDelete(false)} />}
      {clientsOpen && <RouteClientsDialog route={selectedRoute} clients={snapshot.clients} onClose={() => setClientsOpen(false)} />}
    </div>
  );
}

type SessionRecord = {
  id: string;
  user: string;
  station: string;
  start: string;
  status: "Activa" | "Cerrada";
};

function defaultSessionRecords(snapshot: Snapshot): SessionRecord[] {
  const accounts = snapshot.accounts.length ? snapshot.accounts : [
    { id: "session-admin", email: "admin@cyp.local", role: "admin", status: "active", name: "Administración" },
    { id: "session-collector", email: "collector@cyp.local", role: "collector", status: "active", name: "Cobrador" },
  ];
  return accounts.map((account, index) => ({
    id: `session-${account.id ?? index}`,
    user: account.email,
    station: account.role === "admin" ? "ADM001" : "ECP001",
    start: "18/09/2026 08:00",
    status: account.status === "active" ? "Activa" : "Cerrada",
  }));
}

function SessionToolbar({ filtersVisible, selectedSession, onToggleFilters, onFirst, onPrevious, onNext, onLast, onCloseSession, onRefresh }: Readonly<{ filtersVisible: boolean; selectedSession?: SessionRecord; onToggleFilters: () => void; onFirst: () => void; onPrevious: () => void; onNext: () => void; onLast: () => void; onCloseSession: () => void; onRefresh: () => void }>) {
  const action = (handler: () => void) => (event: ReactMouseEvent<HTMLButtonElement>) => { event.stopPropagation(); handler(); };
  return (
    <div className="legacy-mdi-toolbar session-toolbar" aria-label="Barra de herramientas de sesiones" onMouseDown={stopToolbarEvent} onClick={stopToolbarEvent}>
      <button type="button" className={filtersVisible ? "nav-tool active" : "nav-tool"} title="Mostrar/Ocultar filtros" onClick={action(onToggleFilters)}><KeyRound size={15} /></button>
      <button type="button" className="nav-tool" title="Mover al inicio" onClick={action(onFirst)}>|&lt;</button>
      <button type="button" className="nav-tool" title="Subir" onClick={action(onPrevious)}>&lt;</button>
      <button type="button" className="nav-tool" title="Bajar" onClick={action(onNext)}>&gt;</button>
      <button type="button" className="nav-tool" title="Mover al final" onClick={action(onLast)}>&gt;|</button>
      <span className="mdi-toolbar-separator" />
      <button type="button" className="danger-tool" title="Cerrar sesión" disabled={!selectedSession} onClick={action(onCloseSession)}><FileCheck2 size={15} /> X</button>
      <button type="button" title="Refrescar" onClick={action(onRefresh)}><RefreshCw size={15} /></button>
    </div>
  );
}

function SessionsLegacyView({ snapshot }: Readonly<{ snapshot: Snapshot }>): ReactNode {
  const [sessions, setSessions] = useState<SessionRecord[]>(() => defaultSessionRecords(snapshot));
  const [selectedSessionId, setSelectedSessionId] = useState(sessions[0]?.id ?? "");
  const [filtersVisible, setFiltersVisible] = useState(true);
  const [filterMode, setFilterMode] = useState<"all" | "user">("all");
  const [selectedUser, setSelectedUser] = useState(sessions[0]?.user ?? "");
  const [fromDate, setFromDate] = useState("2026-09-18");
  const [toDate, setToDate] = useState("2026-09-18");
  const [statusFilter, setStatusFilter] = useState("Todas");
  const [confirmClose, setConfirmClose] = useState(false);
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? sessions[0];
  const visibleSessions = sessions.filter((session) => (filterMode === "all" || session.user === selectedUser) && (statusFilter === "Todas" || session.status === statusFilter));
  const moveSelectedSession = (direction: "first" | "up" | "down" | "last") => {
    const currentIndex = sessions.findIndex((session) => session.id === selectedSessionId);
    if (currentIndex < 0) return toast.info("Seleccione una sesión.");
    const targetIndexByDirection = { first: 0, up: Math.max(0, currentIndex - 1), down: Math.min(sessions.length - 1, currentIndex + 1), last: sessions.length - 1 } satisfies Record<typeof direction, number>;
    const targetIndex = targetIndexByDirection[direction];
    if (targetIndex === currentIndex) return toast.info("La sesión ya está en esa posición.");
    setSessions((current) => {
      const reordered = [...current];
      const [selected] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, selected);
      return reordered;
    });
  };
  const refreshSessions = () => {
    const reloaded = defaultSessionRecords(snapshot);
    setSessions(reloaded);
    setSelectedSessionId("");
    setFilterMode("all");
    setSelectedUser(reloaded[0]?.user ?? "");
    setFromDate("2026-09-18");
    setToDate("2026-09-18");
    setStatusFilter("Todas");
    toast.success("Sesiones recargadas");
  };
  const closeSelectedSession = () => {
    if (!selectedSession) return;
    setSessions((current) => current.map((session) => session.id === selectedSession.id ? { ...session, status: "Cerrada" } : session));
    setConfirmClose(false);
    toast.success("Sesión cerrada");
  };
  return (
    <div className="sessions-mdi-view">
      <SessionToolbar filtersVisible={filtersVisible} selectedSession={selectedSession} onToggleFilters={() => setFiltersVisible((visible) => !visible)} onFirst={() => moveSelectedSession("first")} onPrevious={() => moveSelectedSession("up")} onNext={() => moveSelectedSession("down")} onLast={() => moveSelectedSession("last")} onCloseSession={() => selectedSession ? setConfirmClose(true) : toast.info("Seleccione una sesión.")} onRefresh={refreshSessions} />
      <div className="sessions-workspace">
        {filtersVisible && (
          <aside className="sessions-filter-panel" aria-label="Filtros de sesiones">
            <label className="session-radio-line"><input type="radio" name="session-filter" checked={filterMode === "all"} onChange={() => setFilterMode("all")} /> <span>Todas</span></label>
            <label className="session-radio-line"><input type="radio" name="session-filter" checked={filterMode === "user"} onChange={() => setFilterMode("user")} /> <span>del Usuario:</span></label>
            <select value={selectedUser} onChange={(event) => { setSelectedUser(event.target.value); setFilterMode("user"); }}>{sessions.map((session) => <option key={session.id} value={session.user}>{session.user}</option>)}</select>
            <label>Fecha inicial:<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
            <label>Fecha final:<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
            <label>Estado:<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>Todas</option><option>Activa</option><option>Cerrada</option></select></label>
          </aside>
        )}
        <div className="sessions-grid-panel">
          <div className="legacy-mdi-table-wrap">
            <table className="legacy-mdi-table sessions-grid">
              <thead><tr><th>Nro.</th><th>Usuario</th><th>Estacion</th><th>Inicio</th><th>Estado</th></tr></thead>
              <tbody>{visibleSessions.map((session, index) => {
                const isSelected = selectedSessionId === session.id;
                return <tr key={session.id} className={isSelected ? "selected-row" : ""} role="button" tabIndex={0} onClick={() => setSelectedSessionId(session.id)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedSessionId(session.id))}><td><span className={`mdi-row-select ${isSelected ? "selected" : ""}`}>{index + 1}</span></td><td>{session.user}</td><td>{session.station}</td><td>{session.start}</td><td>{session.status}</td></tr>;
              })}</tbody>
            </table>
          </div>
        </div>
      </div>
      {confirmClose && <LegacyConfirmDialog message="¿Desea cerrar la sesión?" onYes={closeSelectedSession} onNo={() => setConfirmClose(false)} />}
    </div>
  );
}






type ClientLegacyRecord = {
  id: string;
  code: string;
  identification: string;
  name: string;
  alias: string;
  address: string;
  location: string;
  zone: string;
  routeId: string;
  phone: string;
  cellular: string;
  email: string;
  note: string;
  active: boolean;
  lat?: number;
  lng?: number;
};

type ClientLegacyDraft = Omit<ClientLegacyRecord, "id" | "active"> & { active: boolean };

type ClientFilterMode = "all" | "identification" | "name" | "zone" | "route";
type ClientFinanceTab = "Cargos" | "Cargos Rec." | "Cobros" | "Descargos" | "Descargos Rec." | "Pagos";

const clientFinanceTabs: ClientFinanceTab[] = ["Cargos", "Cargos Rec.", "Cobros", "Descargos", "Descargos Rec.", "Pagos"];

const clientRecordFromSnapshot = (client: Client, routes: Snapshot["routes"]): ClientLegacyRecord => ({
  id: client.id,
  code: client.code,
  identification: client.identification || client.id,
  name: client.name,
  alias: client.alias ?? "",
  address: client.address,
  location: client.sector ?? routes.find((route) => route.id === client.routeId)?.sector ?? "",
  zone: client.sector ?? routes.find((route) => route.id === client.routeId)?.sector ?? "No Definida",
  routeId: client.routeId,
  phone: client.phone,
  cellular: client.cellular ?? "",
  email: client.email ?? "",
  note: client.note ?? "",
  active: true,
  lat: client.lat,
  lng: client.lng,
});

const defaultClientRecords = (snapshot: Snapshot): ClientLegacyRecord[] => snapshot.clients.map((client) => clientRecordFromSnapshot(client, snapshot.routes));

const nextClientCode = (clients: readonly ClientLegacyRecord[]) => {
  const numericCodes = clients
    .map((client) => client.code.trim().match(/(\d+)\s*$/)?.[1] ?? "")
    .filter(Boolean);
  const maxCode = Math.max(0, ...numericCodes.map(Number));
  const width = Math.max(3, ...numericCodes.map((code) => code.length));
  return String(maxCode + 1).padStart(width, "0");
};

function ClientDataDialog({ client, zones, routes, defaultCode = "", onClose, onSave }: Readonly<{ client?: ClientLegacyRecord; zones: readonly string[]; routes: Snapshot["routes"]; defaultCode?: string; onClose: () => void; onSave: (draft: ClientLegacyDraft) => Promise<void> | void }>) {
  const [draft, setDraft] = useState<ClientLegacyDraft>({
    code: client?.code ?? defaultCode,
    identification: client?.identification ?? "",
    name: client?.name ?? "",
    alias: client?.alias ?? "",
    address: client?.address ?? "",
    location: client?.location ?? "",
    zone: client?.zone ?? "No Definida",
    routeId: client?.routeId ?? routes[0]?.id ?? "",
    phone: client?.phone ?? "",
    cellular: client?.cellular ?? "",
    email: client?.email ?? "",
    note: client?.note ?? "",
    active: client?.active ?? true,
  });
  const [error, setError] = useState("");
  const zoneOptions = ["No Definida", ...zones.filter((zone) => zone !== "No Definida")];
  const update = (field: keyof ClientLegacyDraft, value: string | boolean) => setDraft((current) => ({ ...current, [field]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim()) {
      setError("El campo Nombre no puede estar vacío");
      return;
    }
    await onSave(draft);
  };
  return (
    <LegacyDialog title="Datos del Cliente..." onClose={onClose} className="client-form-dialog">
      <form className="client-form" onSubmit={submit}>
        <label className="client-form-row"><span>Código:</span><input autoFocus value={draft.code} onChange={(event) => update("code", event.target.value)} /></label>
        <label className="client-form-row"><span>Identificación:</span><span className="client-ident-field"><input value={draft.identification} onChange={(event) => update("identification", event.target.value)} /><button type="button">G</button></span></label>
        <label className="client-form-row"><span>Cliente:</span><input value={draft.name} onChange={(event) => update("name", event.target.value)} /></label>
        <label className="client-form-row"><span>Conocido por:</span><input value={draft.alias} onChange={(event) => update("alias", event.target.value)} /></label>
        <label className="client-form-row"><span>Dirección:</span><input value={draft.address} onChange={(event) => update("address", event.target.value)} /></label>
        <label className="client-form-row"><span>Ubicación:</span><input value={draft.location} onChange={(event) => update("location", event.target.value)} /></label>
        <label className="client-form-row"><span>Zona:</span><select value={draft.zone} onChange={(event) => update("zone", event.target.value)}>{zoneOptions.map((zone) => <option key={zone}>{zone}</option>)}</select></label>
        <label className="client-form-row"><span>Ruta:</span><select value={draft.routeId} onChange={(event) => update("routeId", event.target.value)}>{routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}</select></label>
        <div className="client-contact-row">
          <label>Teléfono:<input value={draft.phone} onChange={(event) => update("phone", event.target.value)} /></label>
          <label>Celular:<input value={draft.cellular} onChange={(event) => update("cellular", event.target.value)} /></label>
          <label>EMail:<input value={draft.email} onChange={(event) => update("email", event.target.value)} /></label>
        </div>
        <label className="client-form-row"><span>Nota:</span><input value={draft.note} onChange={(event) => update("note", event.target.value)} /></label>
        <div className="legacy-dialog-actions"><button type="submit">oK</button><button type="button" onClick={onClose}>Cancelar</button></div>
      </form>
      {error && <LegacyAlertDialog message={error} onClose={() => setError("")} />}
    </LegacyDialog>
  );
}

function ClientFinancePager() {
  return <div className="legacy-mdi-pager client-finance-pager"><button type="button">|&lt;</button><button type="button">&lt;</button><span>Página [ 1 ] de 1</span><button type="button">&gt;</button><button type="button">&gt;|</button></div>;
}

function ClientFinanceTable({ columns, rows }: Readonly<{ columns: readonly string[]; rows: readonly ReactNode[][] }>) {
  return <div className="client-finance-grid"><LegacyDenseTable columns={columns} rows={rows.length ? rows : [["", "Sin registros", "", "", "", "", "", ""]]} /><ClientFinancePager /></div>;
}

function ClientFinancialDialog({ client, snapshot, onClose }: Readonly<{ client: ClientLegacyRecord; snapshot: Snapshot; onClose: () => void }>) {
  const [tab, setTab] = useState<ClientFinanceTab>("Cargos");
  const [currency, setCurrency] = useState("Peso Dominicano");
  const [fromDate, setFromDate] = useState("2026-09-18");
  const [toDate, setToDate] = useState("2026-09-18");
  const clientCharges = snapshot.charges.filter((charge) => charge.clientId === client.id);
  const clientPayouts = snapshot.payouts.filter((payout) => payout.clientId === client.id);
  const clientCollections = snapshot.movements.filter((movement) => movement.type === "collection" && movement.clientId === client.id);
  const clientPayments = snapshot.movements.filter((movement) => movement.type === "payout" && movement.clientId === client.id);
  const refreshButton = <button type="button" className="legacy-refresh-button" onClick={() => toast.success("Datos recargados")}>Refrescar</button>;
  return (
    <LegacyDialog title="Datos de Cobros y Pagos del Cliente..." onClose={onClose} className="client-finance-dialog">
      <div className="client-finance-view">
        <div className="client-finance-header"><span>Código: <strong>{client.code}</strong></span><span>Cliente: <strong>{client.name}</strong></span><label>Moneda:<select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>No definido</option><option>Peso Dominicano</option><option>Dólar Americano</option><option>Euro</option></select></label></div>
        <div className="legacy-tabs client-finance-tabs" role="tablist" aria-label="Cobros y Pagos del Cliente">{clientFinanceTabs.map((item) => <button type="button" key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</div>
        {(tab === "Cargos" || tab === "Cobros" || tab === "Descargos" || tab === "Pagos") && <div className="client-finance-filters"><label>Fecha Inicial:<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label>Fecha Final:<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>{refreshButton}</div>}
        {(tab === "Cargos Rec." || tab === "Descargos Rec.") && <div className="client-finance-filters compact-only">{refreshButton}</div>}
        {tab === "Cargos" && <ClientFinanceTable columns={["Nro.", "Fecha", "Servicio", "Concepto", "Importe", "Recibos", "Pendiente", "Activo"]} rows={clientCharges.map((charge, index) => [index + 1, safeDateLabel(charge.dueDate), charge.service, charge.service, money(charge.amount), money(charge.collected), money(Math.max(0, charge.amount - charge.collected)), <LegacyCheck checked={charge.status !== "cancelled"} />])} />}
        {tab === "Cargos Rec." && <ClientFinanceTable columns={["Nro.", "Fecha", "Servicio", "Concepto", "Importe", "Activo"]} rows={snapshot.payoutRecurring.filter((item) => item.clientId === client.id).map((item, index) => [index + 1, safeDateLabel(item.nextRunDate), "Recurrente", item.concept, money(item.amount), <LegacyCheck checked={item.status === "active"} />])} />}
        {tab === "Cobros" && <ClientFinanceTable columns={["Nro.", "Fecha", "En Linea", "En Cen.", "Importe", "Activo", "Cobrador"]} rows={clientCollections.map((movement, index) => [index + 1, safeDateLabel(movement.createdAt.slice(0, 10)), "Sí", "No", money(movement.amount), <LegacyCheck />, snapshot.collectors.find((collector) => collector.id === movement.collectorId)?.name ?? ""]) } />}
        {tab === "Descargos" && <ClientFinanceTable columns={["Nro.", "Fecha", "Servicio", "Concepto", "Importe", "Activo"]} rows={clientPayouts.map((payout, index) => [index + 1, "18/09/2026", payout.concept, payout.concept, money(payout.amount), <LegacyCheck checked={payout.status !== "cancelled"} />])} />}
        {tab === "Descargos Rec." && <ClientFinanceTable columns={["Nro.", "Fecha", "Servicio", "Concepto", "Importe", "Activo"]} rows={snapshot.payoutRecurring.filter((item) => item.clientId === client.id).map((item, index) => [index + 1, safeDateLabel(item.nextRunDate), "Descargo", item.concept, money(item.amount), <LegacyCheck checked={item.status === "active"} />])} />}
        {tab === "Pagos" && <ClientFinanceTable columns={["Nro.", "Fecha", "EnLinea", "En Cen.", "Importe", "Activo", "Cobrador"]} rows={clientPayments.map((movement, index) => [index + 1, safeDateLabel(movement.createdAt.slice(0, 10)), "Sí", "No", money(movement.amount), <LegacyCheck />, snapshot.collectors.find((collector) => collector.id === movement.collectorId)?.name ?? ""]) } />}
      </div>
    </LegacyDialog>
  );
}

type ClientMapStyle = "Hybrid" | "Roadmap" | "Satellite" | "Terrain";

function ClientMapDialog({ client, onClose, onSave }: Readonly<{ client: ClientLegacyRecord; onClose: () => void; onSave: (lat: number, lng: number) => Promise<boolean> }>) {
  const [mapStyle, setMapStyle] = useState<ClientMapStyle>("Hybrid");
  const [latitude, setLatitude] = useState(String(client.lat ?? 19.4517));
  const [longitude, setLongitude] = useState(String(client.lng ?? -69.9700));
  const [pinPosition, setPinPosition] = useState({ x: 50, y: 50 });
  const [saving, setSaving] = useState(false);
  const save = async (closeAfterSave: boolean) => {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      toast.error("Indica una latitud y longitud válidas.");
      return;
    }
    setSaving(true);
    try {
      const saved = await onSave(lat, lng);
      if (saved && closeAfterSave) onClose();
    } finally {
      setSaving(false);
    }
  };
  const placePin = (event: ReactMouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    setLatitude((19.95 - y * 1.05).toFixed(6));
    setLongitude((-70.85 + x * 1.05).toFixed(6));
    setPinPosition({ x: x * 100, y: y * 100 });
  };
  return (
    <LegacyDialog title="Mapa del Cliente..." onClose={onClose} className={`client-map-dialog map-style-${mapStyle.toLowerCase()}`}>
      <div className="client-map-view">
        <div className="client-map-toolbar" role="group" aria-label="Tipo de mapa">
          {(["Hybrid", "Roadmap", "Satellite", "Terrain"] as const).map((style) => <button key={style} type="button" className={mapStyle === style ? "active" : ""} onClick={() => setMapStyle(style)}>{style}</button>)}
        </div>
        <div className="client-map-canvas" role="button" tabIndex={0} aria-label="Seleccionar ubicación en el mapa" onClick={placePin} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); setLatitude((19.95 - (event.currentTarget.clientHeight / 2 / bounds.height) * 1.05).toFixed(6)); setLongitude((-70.85 + (event.currentTarget.clientWidth / 2 / bounds.width) * 1.05).toFixed(6)); } }}>
          <div className="client-map-river" />
          <div className="client-map-road road-one" /><div className="client-map-road road-two" /><div className="client-map-road road-three" />
          <div className="client-map-label map-label-one">Centro</div><div className="client-map-label map-label-two">Los Jardines</div><div className="client-map-label map-label-three">Av. Principal</div>
          <span className="client-map-pin" style={{ left: `${pinPosition.x}%`, top: `${pinPosition.y}%` }}><MapPinned size={24} /><small>{client.name}</small></span>
          <span className="client-map-hint">Haz clic para marcar la ubicación</span>
        </div>
        <div className="client-map-coordinates"><label>Latitud:<input value={latitude} onChange={(event) => setLatitude(event.target.value)} /></label><label>Longitud:<input value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label></div>
        <div className="client-map-actions"><button type="button" onClick={() => { setLatitude(String(client.lat ?? 19.4517)); setLongitude(String(client.lng ?? -69.9700)); setPinPosition({ x: 50, y: 50 }); }}>Ajustar</button><button type="button" onClick={() => void save(true)} disabled={saving}>oK</button><button type="button" className="primary" onClick={() => void save(false)} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button><button type="button" onClick={onClose}>Cerrar</button></div>
      </div>
    </LegacyDialog>
  );
}

type ClientMachineDraft = Pick<ClientMachine, "number" | "entry" | "exit" | "value" | "percentage">;

function ClientMachineFormDialog({ machine, defaultNumber, onClose, onSave }: Readonly<{ machine?: ClientMachine; defaultNumber: number; onClose: () => void; onSave: (draft: ClientMachineDraft) => Promise<boolean> }>) {
  const [draft, setDraft] = useState<ClientMachineDraft>({ number: machine?.number ?? defaultNumber, entry: machine?.entry ?? "", exit: machine?.exit ?? "", value: machine?.value ?? 0, percentage: machine?.percentage ?? 0 });
  const [saving, setSaving] = useState(false);
  const update = (field: keyof ClientMachineDraft, value: string) => setDraft((current) => ({ ...current, [field]: field === "entry" || field === "exit" ? value : Number(value) }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!Number.isInteger(draft.number) || draft.number < 1) return toast.error("El número de tragamonedas debe ser mayor que cero.");
    if (!Number.isFinite(draft.value) || draft.value < 0 || !Number.isFinite(draft.percentage) || draft.percentage < 0 || draft.percentage > 100) return toast.error("Revisa el valor y el porciento.");
    setSaving(true);
    try { if (await onSave(draft)) onClose(); } finally { setSaving(false); }
  };
  return <LegacyDialog title="Tragamonedas..." onClose={onClose} className="client-machine-form-dialog"><form className="client-machine-form" onSubmit={(event) => void submit(event)}><label>Nro.:<input type="number" min="1" value={draft.number} onChange={(event) => update("number", event.target.value)} /></label><label>Entrada:<input value={draft.entry} onChange={(event) => update("entry", event.target.value)} /></label><label>Salida:<input value={draft.exit} onChange={(event) => update("exit", event.target.value)} /></label><label>Valor Mon.:<input type="number" min="0" step="0.0001" value={draft.value} onChange={(event) => update("value", event.target.value)} /></label><label>Porciento:<input type="number" min="0" max="100" step="0.01" value={draft.percentage} onChange={(event) => update("percentage", event.target.value)} /></label><div className="legacy-dialog-actions centered"><button type="submit" disabled={saving}>{saving ? "Guardando…" : "oK"}</button><button type="button" onClick={onClose}>Cancelar</button></div></form></LegacyDialog>;
}

function ClientMachineLogsDialog({ client, machines, logs, onClose, onRefresh }: Readonly<{ client: ClientLegacyRecord; machines: readonly ClientMachine[]; logs: readonly ClientMachineLog[]; onClose: () => void; onRefresh: () => Promise<void> }>) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const visibleLogs = logs.filter((log) => (!fromDate || log.registeredAt.slice(0, 10) >= fromDate) && (!toDate || log.registeredAt.slice(0, 10) <= toDate));
  const rows = visibleLogs.map((log) => [new Date(log.registeredAt).toLocaleString("es-DO"), machines.find((machine) => machine.id === log.machineId)?.number ?? "", log.previousEntry, log.entry, log.entryDifference, log.previousExit, log.exit, log.exitDifference, log.difference, log.currency, log.amount.toFixed(2), `${log.percentage}%`, log.charge.toFixed(2), log.modifiedAt ? new Date(log.modifiedAt).toLocaleString("es-DO") : "", log.cancelledAt ? new Date(log.cancelledAt).toLocaleString("es-DO") : ""]);
  return <LegacyDialog title="Registros de Máquina Tragamonedas..." onClose={onClose} className="client-machine-logs-dialog"><div className="client-machine-logs"><div className="client-machine-log-filters"><label>Fecha Inicial:<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label>Fecha Final:<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label><button type="button" className="legacy-refresh-button" onClick={() => { setFromDate(""); setToDate(""); void onRefresh(); }}>Refrescar</button><button type="button" onClick={onClose}>Cancelar</button></div><div className="client-machine-log-grid"><LegacyDenseTable columns={["Registro", "Nro.", "Ent. Ant.", "Entrada", "Dif_Entr...", "Sal. Ant.", "Salida", "Dif_Sali...", "Diferencia", "Mon.", "Importe", "Porc.", "Cargo", "Modificación", "Cancelación"]} rows={rows} /></div><ClientFinancePager /></div><span className="sr-only">Registros de {client.name}</span></LegacyDialog>;
}

function ClientMachinesDialog({ client, onClose }: Readonly<{ client: ClientLegacyRecord; onClose: () => void }>) {
  const [machines, setMachines] = useState<ClientMachine[]>([]);
  const [logs, setLogs] = useState<ClientMachineLog[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [formMode, setFormMode] = useState<"new" | "edit" | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const [machineRows, logRows] = await Promise.all([
        api<ClientMachine[]>(`/clientes/${encodeURIComponent(client.id)}/tragamonedas`),
        api<ClientMachineLog[]>(`/clientes/${encodeURIComponent(client.id)}/tragamonedas/registros`),
      ]);
      setMachines(machineRows); setLogs(logRows);
      setSelectedId((selected) => machineRows.some((machine) => machine.id === selected) ? selected : machineRows[0]?.id ?? "");
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudieron cargar las tragamonedas."); }
  }, [client.id]);
  useEffect(() => { void refresh(); }, [refresh]);
  const selected = machines.find((machine) => machine.id === selectedId);
  const saveMachine = async (draft: ClientMachineDraft) => {
    const isEdit = formMode === "edit" && selected;
    try {
      const saved = await api<ClientMachine>(`/clientes/${encodeURIComponent(client.id)}/tragamonedas${isEdit ? `/${encodeURIComponent(selected.id)}` : ""}`, {
        method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(draft),
      });
      setMachines((current) => isEdit ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved]);
      setSelectedId(saved.id); setFormMode(null); toast.success(isEdit ? "Tragamonedas actualizada" : "Tragamonedas agregada");
      const refreshedLogs = await api<ClientMachineLog[]>(`/clientes/${encodeURIComponent(client.id)}/tragamonedas/registros`);
      setLogs(refreshedLogs);
      return true;
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo guardar la tragamonedas."); return false; }
  };
  const rows = machines.map((machine) => [machine.number, machine.entry, machine.exit, machine.value.toFixed(2), `${machine.percentage}%`, new Date(machine.registeredAt).toLocaleString("es-DO")]);
  return <LegacyDialog title="Tragamonedas del Cliente..." onClose={onClose} className="client-machines-dialog"><div className="client-machines-view"><div className="client-machines-toolbar"><button type="button" title="Agregar" onClick={() => setFormMode("new")}><Plus size={15} />Agregar</button><button type="button" title="Modificar" disabled={!selected} onClick={() => selected ? setFormMode("edit") : undefined}><Pencil size={15} />Modificar</button><button type="button" title="Refrescar" onClick={() => void refresh()}><RefreshCw size={15} />Refrescar</button><button type="button" title="Registros" onClick={() => setLogsOpen(true)}><History size={15} />Registros</button><span className="client-machines-client">{client.code} · {client.name}</span></div><div className="client-machines-grid"><div className="legacy-mdi-table-wrap"><table className="legacy-mdi-table"><thead><tr>{["Nro.", "Entrada", "Salida", "Valor", "Porc.", "Registro"].map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{machines.map((machine) => <tr key={machine.id} className={machine.id === selectedId ? "selected-row" : ""} role="button" tabIndex={0} onClick={() => setSelectedId(machine.id)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedId(machine.id))}><td>{machine.number}</td><td>{machine.entry}</td><td>{machine.exit}</td><td>{machine.value.toFixed(2)}</td><td>{machine.percentage}%</td><td>{new Date(machine.registeredAt).toLocaleString("es-DO")}</td></tr>)}</tbody></table></div></div><div className="legacy-footerbar"><span>Cantidad</span><strong>{machines.length}</strong></div></div>{formMode && <ClientMachineFormDialog machine={formMode === "edit" ? selected : undefined} defaultNumber={Math.max(0, ...machines.map((machine) => machine.number)) + 1} onClose={() => setFormMode(null)} onSave={saveMachine} />}{logsOpen && <ClientMachineLogsDialog client={client} machines={machines} logs={logs} onClose={() => setLogsOpen(false)} onRefresh={refresh} />}</LegacyDialog>;
}

function ClientToolbar({ filtersVisible, onToggleFilters, onFirst, onPrevious, onNext, onLast, onNew, onEdit, onDelete, onRefresh, onFinance, onMap, onMachines }: Readonly<{ filtersVisible: boolean; onToggleFilters: () => void; onFirst: () => void; onPrevious: () => void; onNext: () => void; onLast: () => void; onNew: () => void; onEdit: () => void; onDelete: () => void; onRefresh: () => void; onFinance: () => void; onMap: () => void; onMachines: () => void }>) {
  const action = (handler: () => void) => (event: ReactMouseEvent<HTMLButtonElement>) => { event.stopPropagation(); handler(); };
  return (
    <div className="legacy-mdi-toolbar clients-toolbar" aria-label="Barra de herramientas de clientes" onMouseDown={stopToolbarEvent} onClick={stopToolbarEvent}>
      <button type="button" className={filtersVisible ? "nav-tool active" : "nav-tool"} title="Mostrar/Ocultar filtros" onClick={action(onToggleFilters)}><KeyRound size={15} /></button>
      <button type="button" className="nav-tool" title="Mover al inicio" onClick={action(onFirst)}>|&lt;</button>
      <button type="button" className="nav-tool" title="Subir" onClick={action(onPrevious)}>&lt;</button>
      <button type="button" className="nav-tool" title="Bajar" onClick={action(onNext)}>&gt;</button>
      <button type="button" className="nav-tool" title="Mover al final" onClick={action(onLast)}>&gt;|</button>
      <span className="mdi-toolbar-separator" />
      <button type="button" title="Nuevo" onClick={action(onNew)}><Plus size={15} /></button>
      <button type="button" title="Editar" onClick={action(onEdit)}><Pencil size={15} /></button>
      <button type="button" className="danger-tool" title="Eliminar" onClick={action(onDelete)}><Trash2 size={15} /></button>
      <button type="button" title="Refrescar" onClick={action(onRefresh)}><RefreshCw size={15} /></button>
      <button type="button" title="Cobros y Pagos" onClick={action(onFinance)}>$</button>
      <button type="button" title="Mapa" onClick={action(onMap)}><MapPinned size={15} /></button>
      <button type="button" title="Tragamonedas del Cliente" onClick={action(onMachines)}><Gamepad2 size={15} /></button>
    </div>
  );
}

function ClientsLegacyView({ snapshot, onRefresh }: Readonly<{ snapshot: Snapshot; onRefresh: () => Promise<void> }>): ReactNode {
  const [clientsData, setClientsData] = useState<ClientLegacyRecord[]>(() => defaultClientRecords(snapshot));
  const [selectedClientId, setSelectedClientId] = useState(clientsData[0]?.id ?? "");
  const [filtersVisible, setFiltersVisible] = useState(true);
  const [filterMode, setFilterMode] = useState<ClientFilterMode>("all");
  const [identificationFilter, setIdentificationFilter] = useState("");
  const [nameFilter, setNameFilter] = useState("");
  const [zoneFilter, setZoneFilter] = useState("No Definida");
  const [routeFilter, setRouteFilter] = useState(snapshot.routes[0]?.id ?? "");
  const [statusFilter, setStatusFilter] = useState("Activo");
  const [formMode, setFormMode] = useState<"new" | "edit" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [financeOpen, setFinanceOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [machinesOpen, setMachinesOpen] = useState(false);
  useEffect(() => {
    setClientsData(defaultClientRecords(snapshot));
    setSelectedClientId((selected) => snapshot.clients.some((client) => client.id === selected) ? selected : snapshot.clients[0]?.id ?? "");
  }, [snapshot.clients, snapshot.routes]);
  const zones = Array.from(new Set(["No Definida", ...clientsData.map((client) => client.zone).filter(Boolean), ...snapshot.routes.map((route) => route.sector).filter(Boolean)]));
  const selectedClient = clientsData.find((client) => client.id === selectedClientId) ?? clientsData[0];
  const visibleClients = clientsData.filter((client) => {
    const statusMatches = statusFilter === "Todos" || (statusFilter === "Activo" ? client.active : !client.active);
    if (!statusMatches) return false;
    if (filterMode === "identification") return client.identification.toLowerCase().includes(identificationFilter.toLowerCase());
    if (filterMode === "name") return client.name.toLowerCase().includes(nameFilter.toLowerCase());
    if (filterMode === "zone") return client.zone === zoneFilter;
    if (filterMode === "route") return client.routeId === routeFilter;
    return true;
  });
  const moveSelectedClient = (direction: "first" | "up" | "down" | "last") => {
    const currentIndex = clientsData.findIndex((client) => client.id === selectedClientId);
    if (currentIndex < 0) return toast.info("Seleccione un cliente.");
    const targetIndexByDirection = { first: 0, up: Math.max(0, currentIndex - 1), down: Math.min(clientsData.length - 1, currentIndex + 1), last: clientsData.length - 1 } satisfies Record<typeof direction, number>;
    const targetIndex = targetIndexByDirection[direction];
    if (targetIndex === currentIndex) return toast.info("El cliente ya está en esa posición.");
    setClientsData((current) => {
      const reordered = [...current];
      const [selected] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, selected);
      return reordered;
    });
  };
  const refreshClients = async () => {
    setFilterMode("all");
    setIdentificationFilter("");
    setNameFilter("");
    setZoneFilter("No Definida");
    setRouteFilter(snapshot.routes[0]?.id ?? "");
    setStatusFilter("Activo");
    await onRefresh();
    toast.success("Clientes recargados");
  };
  const clientPayload = (draft: ClientLegacyDraft, coordinates?: { lat: number; lng: number }) => ({
    code: draft.code.trim(), name: draft.name.trim(), identification: draft.identification.trim(),
    alias: draft.alias, address: draft.address, sector: draft.zone === "No Definida" ? draft.location : draft.zone,
    routeId: draft.routeId, phone: draft.phone, cellular: draft.cellular, email: draft.email, note: draft.note,
    ...(coordinates ? { lat: coordinates.lat, lng: coordinates.lng } : draft.lat !== undefined && draft.lng !== undefined ? { lat: draft.lat, lng: draft.lng } : {}),
  });
  const saveClient = async (draft: ClientLegacyDraft) => {
    try {
      const isEdit = formMode === "edit" && selectedClient;
      const saved = await api<Client>(isEdit ? `/clientes/${encodeURIComponent(selectedClient.id)}` : "/clientes", {
        method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(clientPayload(draft, isEdit && selectedClient.lat !== undefined && selectedClient.lng !== undefined ? { lat: selectedClient.lat, lng: selectedClient.lng } : undefined)),
      });
      const record = { ...clientRecordFromSnapshot(saved, snapshot.routes), ...draft, id: saved.id, lat: saved.lat, lng: saved.lng, active: isEdit ? selectedClient.active : true };
      setClientsData((current) => isEdit ? current.map((client) => client.id === record.id ? record : client) : [...current, record]);
      setSelectedClientId(record.id);
      setFormMode(null);
      await onRefresh();
      toast.success(isEdit ? "Cliente actualizado" : "Cliente creado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el cliente.");
    }
  };
  const saveClientLocation = async (lat: number, lng: number) => {
    if (!selectedClient) return false;
    const payload = clientPayload({ ...selectedClient, active: selectedClient.active }, { lat, lng });
    try {
      const saved = await api<Client>(`/clientes/${encodeURIComponent(selectedClient.id)}`, {
        method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(payload),
      });
      setClientsData((current) => current.map((client) => client.id === saved.id ? { ...client, lat, lng } : client));
      await onRefresh();
      toast.success("Ubicación del cliente guardada");
      return true;
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo guardar la ubicación."); return false; }
  };
  const inactivateClient = () => {
    if (!selectedClient) return;
    setClientsData((current) => current.map((client) => client.id === selectedClient.id ? { ...client, active: false } : client));
    setConfirmDelete(false);
    toast.success("Cliente inactivado");
  };
  return (
    <div className="clients-mdi-view">
      <ClientToolbar filtersVisible={filtersVisible} onToggleFilters={() => setFiltersVisible((visible) => !visible)} onFirst={() => moveSelectedClient("first")} onPrevious={() => moveSelectedClient("up")} onNext={() => moveSelectedClient("down")} onLast={() => moveSelectedClient("last")} onNew={() => setFormMode("new")} onEdit={() => selectedClient ? setFormMode("edit") : toast.info("Seleccione un cliente.")} onDelete={() => selectedClient ? setConfirmDelete(true) : toast.info("Seleccione un cliente.")} onRefresh={() => void refreshClients()} onFinance={() => selectedClient ? setFinanceOpen(true) : toast.info("Seleccione un cliente.")} onMap={() => selectedClient ? setMapOpen(true) : toast.info("Seleccione un cliente.")} onMachines={() => selectedClient ? setMachinesOpen(true) : toast.info("Seleccione un cliente.")} />
      <div className="clients-workspace">
        {filtersVisible && <aside className="clients-filter-panel" aria-label="Filtros de clientes">
          <label className="client-radio-line"><input type="radio" name="client-filter" checked={filterMode === "all"} onChange={() => setFilterMode("all")} /> <span>Todos</span></label>
          <label className="client-radio-line"><input type="radio" name="client-filter" checked={filterMode === "identification"} onChange={() => setFilterMode("identification")} /> <span>por Identificación:</span></label><input value={identificationFilter} disabled={filterMode !== "identification"} onChange={(event) => setIdentificationFilter(event.target.value)} />
          <label className="client-radio-line"><input type="radio" name="client-filter" checked={filterMode === "name"} onChange={() => setFilterMode("name")} /> <span>por Nombre:</span></label><input value={nameFilter} disabled={filterMode !== "name"} onChange={(event) => setNameFilter(event.target.value)} />
          <label className="client-radio-line"><input type="radio" name="client-filter" checked={filterMode === "zone"} onChange={() => setFilterMode("zone")} /> <span>por Zona:</span></label><select value={zoneFilter} disabled={filterMode !== "zone"} onChange={(event) => setZoneFilter(event.target.value)}>{zones.map((zone) => <option key={zone}>{zone}</option>)}</select>
          <label className="client-radio-line"><input type="radio" name="client-filter" checked={filterMode === "route"} onChange={() => setFilterMode("route")} /> <span>por Ruta:</span></label><select value={routeFilter} disabled={filterMode !== "route"} onChange={(event) => setRouteFilter(event.target.value)}>{snapshot.routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}</select>
          <label>Estado:<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>Activo</option><option>Inactivo</option><option>Todos</option></select></label>
        </aside>}
        <div className="clients-grid-panel"><div className="legacy-mdi-table-wrap"><table className="legacy-mdi-table clients-grid"><thead><tr><th>Código</th><th>Identificación</th><th>Cliente</th><th>Zona</th><th>Ruta</th><th>Teléfono</th><th>Celular</th><th>Activo</th></tr></thead><tbody>{visibleClients.map((client) => { const isSelected = selectedClientId === client.id; return <tr key={client.id} className={isSelected ? "selected-row" : ""} role="button" tabIndex={0} onClick={() => setSelectedClientId(client.id)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedClientId(client.id))}><td><span className={`mdi-row-select ${isSelected ? "selected" : ""}`}>{client.code}</span></td><td>{client.identification}</td><td>{client.name}</td><td>{client.zone}</td><td>{snapshot.routes.find((route) => route.id === client.routeId)?.name ?? ""}</td><td>{client.phone}</td><td>{client.cellular}</td><td><LegacyCheck checked={client.active} /></td></tr>; })}</tbody></table></div><div className="legacy-footerbar"><span>Cantidad</span><strong>{visibleClients.length}</strong></div></div>
      </div>
      {formMode && <ClientDataDialog client={formMode === "edit" ? selectedClient : undefined} zones={zones} routes={snapshot.routes} defaultCode={formMode === "new" ? nextClientCode(clientsData) : ""} onClose={() => setFormMode(null)} onSave={saveClient} />}
      {confirmDelete && <LegacyConfirmDialog message="¿Inactivar datos?" onYes={inactivateClient} onNo={() => setConfirmDelete(false)} />}
      {financeOpen && selectedClient && <ClientFinancialDialog client={selectedClient} snapshot={snapshot} onClose={() => setFinanceOpen(false)} />}
      {mapOpen && selectedClient && <ClientMapDialog client={selectedClient} onClose={() => setMapOpen(false)} onSave={saveClientLocation} />}
      {machinesOpen && selectedClient && <ClientMachinesDialog client={selectedClient} onClose={() => setMachinesOpen(false)} />}
    </div>
  );
}

type AuthorizationRequestRecord = {
  id: string;
  date: string;
  collector: string;
  code: string;
  client: string;
  phone: string;
  cellular: string;
  status: "Todas" | "Pendiente" | "Aprobada" | "Rechazada";
};

type AuthorizationRequestDraft = Omit<AuthorizationRequestRecord, "id">;

const defaultAuthorizationRequests = (snapshot: Snapshot): AuthorizationRequestRecord[] => {
  const clients = snapshot.clients.length ? snapshot.clients.slice(0, 8) : [
    { id: "auth-client-1", code: "001", name: "Cliente Demo", phone: "809-555-0101" },
  ] as Client[];
  return clients.map((client, index) => {
    const collector = snapshot.collectors[index % Math.max(1, snapshot.collectors.length)];
    return {
      id: `auth-${client.id}-${index}`,
      date: "2026-09-18",
      collector: collector?.name ?? "Cobrador",
      code: client.code,
      client: client.name,
      phone: client.phone,
      cellular: collector?.cellular ?? "809-000-0000",
      status: "Pendiente",
    };
  });
};

function AuthorizationRequestDialog({ request, onClose, onSave }: Readonly<{ request?: AuthorizationRequestRecord; onClose: () => void; onSave: (draft: AuthorizationRequestDraft) => void }>) {
  const [draft, setDraft] = useState<AuthorizationRequestDraft>({
    date: request?.date ?? "2026-09-18",
    collector: request?.collector ?? "",
    code: request?.code ?? "",
    client: request?.client ?? "",
    phone: request?.phone ?? "",
    cellular: request?.cellular ?? "",
    status: request?.status ?? "Pendiente",
  });
  const update = (field: keyof AuthorizationRequestDraft, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.client.trim()) return toast.error("El cliente es requerido.");
    onSave(draft);
  };
  return (
    <LegacyDialog title="Datos de Solicitud de Autorización..." onClose={onClose} className="authorization-form-dialog">
      <form className="authorization-form" onSubmit={submit}>
        <div className="legacy-config-row"><label>Fecha:<input type="date" value={draft.date} onChange={(event) => update("date", event.target.value)} /></label><label>Estado:<select value={draft.status} onChange={(event) => update("status", event.target.value)}><option>Pendiente</option><option>Aprobada</option><option>Rechazada</option></select></label></div>
        <label>Cobrador:<input value={draft.collector} onChange={(event) => update("collector", event.target.value)} /></label>
        <div className="legacy-config-row"><label>Código:<input value={draft.code} onChange={(event) => update("code", event.target.value)} /></label><label>Cliente:<input autoFocus value={draft.client} onChange={(event) => update("client", event.target.value)} /></label></div>
        <div className="legacy-config-row"><label>Telefono:<input value={draft.phone} onChange={(event) => update("phone", event.target.value)} /></label><label>Celular:<input value={draft.cellular} onChange={(event) => update("cellular", event.target.value)} /></label></div>
        <div className="legacy-dialog-actions"><button type="submit">oK</button><button type="button" onClick={onClose}>Cancelar</button></div>
      </form>
    </LegacyDialog>
  );
}

function AuthorizationToolbar({ filtersVisible, onToggleFilters, onFirst, onPrevious, onNext, onLast, onNew, onEdit, onDelete, onRefresh }: Readonly<{ filtersVisible: boolean; onToggleFilters: () => void; onFirst: () => void; onPrevious: () => void; onNext: () => void; onLast: () => void; onNew: () => void; onEdit: () => void; onDelete: () => void; onRefresh: () => void }>) {
  const action = (handler: () => void) => (event: ReactMouseEvent<HTMLButtonElement>) => { event.stopPropagation(); handler(); };
  return (
    <div className="legacy-mdi-toolbar authorization-toolbar" aria-label="Barra de herramientas de solicitudes" onMouseDown={stopToolbarEvent} onClick={stopToolbarEvent}>
      <button type="button" className={filtersVisible ? "nav-tool active" : "nav-tool"} title="Mostrar/Ocultar filtros" onClick={action(onToggleFilters)}><KeyRound size={15} /></button>
      <button type="button" className="nav-tool" title="Mover al inicio" onClick={action(onFirst)}>|&lt;</button>
      <button type="button" className="nav-tool" title="Subir" onClick={action(onPrevious)}>&lt;</button>
      <button type="button" className="nav-tool" title="Bajar" onClick={action(onNext)}>&gt;</button>
      <button type="button" className="nav-tool" title="Mover al final" onClick={action(onLast)}>&gt;|</button>
      <span className="mdi-toolbar-separator" />
      <button type="button" title="Nuevo" onClick={action(onNew)}><Plus size={15} /></button>
      <button type="button" title="Editar" onClick={action(onEdit)}><Pencil size={15} /></button>
      <button type="button" className="danger-tool" title="Eliminar" onClick={action(onDelete)}><FileCheck2 size={15} /> X</button>
      <button type="button" title="Refrescar" onClick={action(onRefresh)}><RefreshCw size={15} /></button>
    </div>
  );
}

function AuthorizationRequestsLegacyView({ snapshot }: Readonly<{ snapshot: Snapshot }>): ReactNode {
  const [requests, setRequests] = useState<AuthorizationRequestRecord[]>(() => defaultAuthorizationRequests(snapshot));
  const [selectedRequestId, setSelectedRequestId] = useState(requests[0]?.id ?? "");
  const [filtersVisible, setFiltersVisible] = useState(true);
  const [fromDate, setFromDate] = useState("2026-09-18");
  const [toDate, setToDate] = useState("2026-09-18");
  const [statusFilter, setStatusFilter] = useState("Todas");
  const [clientFilter, setClientFilter] = useState("");
  const [formMode, setFormMode] = useState<"new" | "edit" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selectedRequest = requests.find((request) => request.id === selectedRequestId) ?? requests[0];
  const visibleRequests = requests.filter((request) => (statusFilter === "Todas" || request.status === statusFilter) && request.client.toLowerCase().includes(clientFilter.trim().toLowerCase()));
  const moveSelectedRequest = (direction: "first" | "up" | "down" | "last") => {
    const currentIndex = requests.findIndex((request) => request.id === selectedRequestId);
    if (currentIndex < 0) return toast.info("Seleccione una solicitud.");
    const targetIndexByDirection = { first: 0, up: Math.max(0, currentIndex - 1), down: Math.min(requests.length - 1, currentIndex + 1), last: requests.length - 1 } satisfies Record<typeof direction, number>;
    const targetIndex = targetIndexByDirection[direction];
    if (targetIndex === currentIndex) return toast.info("La solicitud ya está en esa posición.");
    setRequests((current) => {
      const reordered = [...current];
      const [selected] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, selected);
      return reordered;
    });
  };
  const refreshRequests = () => {
    const reloaded = defaultAuthorizationRequests(snapshot);
    setRequests(reloaded);
    setSelectedRequestId(reloaded[0]?.id ?? "");
    setFromDate("2026-09-18");
    setToDate("2026-09-18");
    setStatusFilter("Todas");
    setClientFilter("");
    toast.success("Solicitudes recargadas");
  };
  const saveRequest = (draft: AuthorizationRequestDraft) => {
    if (formMode === "edit" && selectedRequest) {
      setRequests((current) => current.map((request) => request.id === selectedRequest.id ? { ...request, ...draft } : request));
      toast.success("Solicitud actualizada");
    } else {
      const next: AuthorizationRequestRecord = { id: `auth-local-${Date.now()}`, ...draft };
      setRequests((current) => [...current, next]);
      setSelectedRequestId(next.id);
      toast.success("Solicitud creada");
    }
    setFormMode(null);
  };
  const deleteRequest = () => {
    if (!selectedRequest) return;
    setRequests((current) => current.filter((request) => request.id !== selectedRequest.id));
    setSelectedRequestId("");
    setConfirmDelete(false);
    toast.success("Solicitud anulada");
  };
  return (
    <div className="authorization-mdi-view">
      <AuthorizationToolbar filtersVisible={filtersVisible} onToggleFilters={() => setFiltersVisible((visible) => !visible)} onFirst={() => moveSelectedRequest("first")} onPrevious={() => moveSelectedRequest("up")} onNext={() => moveSelectedRequest("down")} onLast={() => moveSelectedRequest("last")} onNew={() => setFormMode("new")} onEdit={() => selectedRequest ? setFormMode("edit") : toast.info("Seleccione una solicitud.")} onDelete={() => selectedRequest ? setConfirmDelete(true) : toast.info("Seleccione una solicitud.")} onRefresh={refreshRequests} />
      <div className="authorization-workspace">
        {filtersVisible && (
          <aside className="authorization-filter-panel" aria-label="Filtros de solicitudes">
            <label>Fecha Inicial:<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
            <label>Fecha Final:<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
            <label>Estado:<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>Todas</option><option>Pendiente</option><option>Aprobada</option><option>Rechazada</option></select></label>
            <label>Cliente:<span className="legacy-lookup-field"><input value={clientFilter} placeholder="Cliente..." onChange={(event) => setClientFilter(event.target.value)} /><button type="button">...</button></span></label>
          </aside>
        )}
        <div className="authorization-grid-panel">
          <div className="legacy-mdi-table-wrap">
            <table className="legacy-mdi-table authorization-grid">
              <thead><tr><th>Nro.</th><th>Fecha</th><th>Cobrador</th><th>Código</th><th>Cliente</th><th>Telefono</th><th>Celular</th></tr></thead>
              <tbody>{visibleRequests.map((request, index) => {
                const isSelected = selectedRequestId === request.id;
                return <tr key={request.id} className={isSelected ? "selected-row" : ""} role="button" tabIndex={0} onClick={() => setSelectedRequestId(request.id)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedRequestId(request.id))}><td><span className={`mdi-row-select ${isSelected ? "selected" : ""}`}>{index + 1}</span></td><td>{request.date}</td><td>{request.collector}</td><td>{request.code}</td><td>{request.client}</td><td>{request.phone}</td><td>{request.cellular}</td></tr>;
              })}</tbody>
            </table>
          </div>
        </div>
      </div>
      {formMode && <AuthorizationRequestDialog request={formMode === "edit" ? selectedRequest : undefined} onClose={() => setFormMode(null)} onSave={saveRequest} />}
      {confirmDelete && <LegacyConfirmDialog message="¿Desea eliminar/anular esta solicitud?" onYes={deleteRequest} onNo={() => setConfirmDelete(false)} />}
    </div>
  );
}

type ZoneRecord = {
  id: string;
  number: string;
  name: string;
  from: string;
  to: string;
  active: boolean;
};

type ZoneDraft = Omit<ZoneRecord, "id" | "active"> & { active: boolean };

const defaultZoneRecords = (snapshot: Snapshot): ZoneRecord[] => {
  const sectors = Array.from(new Set(snapshot.routes.map((route) => route.sector).filter(Boolean)));
  const source = sectors.length ? sectors : ["Centro", "Norte", "Sur"];
  return source.map((sector, index) => ({
    id: `zone-${index + 1}-${sector.toLowerCase().replace(/\s+/g, "-")}`,
    number: String(index + 1).padStart(3, "0"),
    name: sector,
    from: "001",
    to: "999",
    active: true,
  }));
};

function ZoneDataDialog({ zone, defaultNumber = "", onClose, onSave }: Readonly<{ zone?: ZoneRecord; defaultNumber?: string; onClose: () => void; onSave: (draft: ZoneDraft) => void }>) {
  const [draft, setDraft] = useState<ZoneDraft>({
    number: zone?.number ?? defaultNumber,
    name: zone?.name ?? "",
    from: zone?.from ?? "",
    to: zone?.to ?? "",
    active: zone?.active ?? true,
  });
  const [error, setError] = useState("");
  const update = (field: keyof ZoneDraft, value: string | boolean) => setDraft((current) => ({ ...current, [field]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.number.trim()) {
      setError('El campo "Zona" no puede estar vacío.');
      return;
    }
    onSave(draft);
  };
  return (
    <LegacyDialog title="Datos de la Zona..." onClose={onClose} className="zone-form-dialog">
      <form className="zone-form" onSubmit={submit}>
        <div className="zone-form-row zone-code-row"><span>Zona:</span><input autoFocus value={draft.number} onChange={(event) => update("number", event.target.value)} /><input value={draft.name} onChange={(event) => update("name", event.target.value)} /></div>
        <label className="zone-form-row"><span>Desde:</span><input type="text" value={draft.from} onChange={(event) => update("from", event.target.value)} /></label>
        <label className="zone-form-row"><span>Hasta:</span><input type="text" value={draft.to} onChange={(event) => update("to", event.target.value)} /></label>
        <div className="legacy-dialog-actions"><button type="submit">oK</button><button type="button" onClick={onClose}>Cancelar</button></div>
      </form>
      {error && <LegacyAlertDialog message={error} onClose={() => setError("")} />}
    </LegacyDialog>
  );
}

function ZonesLegacyView({ snapshot }: Readonly<{ snapshot: Snapshot }>): ReactNode {
  const [zonesData, setZonesData] = useState<ZoneRecord[]>(() => defaultZoneRecords(snapshot));
  const [selectedZoneId, setSelectedZoneId] = useState(zonesData[0]?.id ?? "");
  const [formMode, setFormMode] = useState<"new" | "edit" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nextZoneNumber = String(Math.max(0, ...zonesData.map((zone) => Number.parseInt(zone.number, 10)).filter(Number.isFinite)) + 1);
  const selectedZone = zonesData.find((zone) => zone.id === selectedZoneId) ?? zonesData[0];
  const moveSelectedZone = (direction: "first" | "up" | "down" | "last") => {
    const currentIndex = zonesData.findIndex((zone) => zone.id === selectedZoneId);
    if (currentIndex < 0) return toast.info("Seleccione una zona.");
    const targetIndexByDirection = { first: 0, up: Math.max(0, currentIndex - 1), down: Math.min(zonesData.length - 1, currentIndex + 1), last: zonesData.length - 1 } satisfies Record<typeof direction, number>;
    const targetIndex = targetIndexByDirection[direction];
    if (targetIndex === currentIndex) return toast.info("La zona ya está en esa posición.");
    setZonesData((current) => {
      const reordered = [...current];
      const [selected] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, selected);
      return reordered;
    });
  };
  const refreshZones = () => {
    const reloaded = defaultZoneRecords(snapshot);
    setZonesData(reloaded);
    setSelectedZoneId(reloaded[0]?.id ?? "");
    toast.success("Zonas recargadas");
  };
  const saveZone = (draft: ZoneDraft) => {
    if (formMode === "edit" && selectedZone) {
      setZonesData((current) => current.map((zone) => zone.id === selectedZone.id ? { ...zone, ...draft } : zone));
      toast.success("Zona actualizada");
    } else {
      const next: ZoneRecord = { id: `zone-local-${Date.now()}`, ...draft };
      setZonesData((current) => [...current, next]);
      setSelectedZoneId(next.id);
      toast.success("Zona creada");
    }
    setFormMode(null);
  };
  const inactivateZone = () => {
    if (!selectedZone) return;
    setZonesData((current) => current.map((zone) => zone.id === selectedZone.id ? { ...zone, active: false } : zone));
    setConfirmDelete(false);
    toast.success("Zona inactivada");
  };
  return (
    <div className="legacy-mdi-view">
      <LegacyToolbar onFirst={() => moveSelectedZone("first")} onPrevious={() => moveSelectedZone("up")} onNext={() => moveSelectedZone("down")} onLast={() => moveSelectedZone("last")} onNew={() => setFormMode("new")} onEdit={() => selectedZone ? setFormMode("edit") : toast.info("Seleccione una zona.")} onDelete={() => selectedZone ? setConfirmDelete(true) : toast.info("Seleccione una zona.")} onRefresh={refreshZones} />
      <div className="legacy-mdi-table-wrap">
        <table className="legacy-mdi-table zones-grid">
          <thead><tr><th>Nro</th><th>Zona</th><th>Desde</th><th>Hasta</th><th>Act.</th></tr></thead>
          <tbody>{zonesData.map((zone) => {
            const isSelected = selectedZoneId === zone.id;
            return <tr key={zone.id} className={isSelected ? "selected-row" : ""} role="button" tabIndex={0} onClick={() => setSelectedZoneId(zone.id)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedZoneId(zone.id))}><td><span className={`mdi-row-select ${isSelected ? "selected" : ""}`}>{zone.number}</span></td><td>{zone.name}</td><td>{zone.from}</td><td>{zone.to}</td><td><LegacyCheck checked={zone.active} /></td></tr>;
          })}</tbody>
        </table>
      </div>
      {formMode && <ZoneDataDialog zone={formMode === "edit" ? selectedZone : undefined} defaultNumber={formMode === "new" ? nextZoneNumber : ""} onClose={() => setFormMode(null)} onSave={saveZone} />}
      {confirmDelete && <LegacyConfirmDialog message="¿Inactivar datos?" onYes={inactivateZone} onNo={() => setConfirmDelete(false)} />}
    </div>
  );
}

type LegacyUserRecord = {
  id: string;
  name: string;
  username: string;
  role: "No definido" | "Cliente" | "Usuario" | "Supervisor" | "Admin";
  alias: string;
  active: boolean;
};

type LegacyUserDraft = Omit<LegacyUserRecord, "id" | "active"> & { active: boolean };

type UserPermissionRecord = {
  id: string;
  userId: string;
  user: string;
  permissionId: string;
  permission: string;
};

const userRoleOptions: LegacyUserRecord["role"][] = ["No definido", "Cliente", "Usuario", "Supervisor", "Admin"];
const permissionCategoryOptions = ["No definido", "Sistema", "Archivos", "Edición", "Reportes y Procesamiento", "Monitoreo y Otros"];
const permissionCatalogByCategory: Record<string, string[]> = {
  "No definido": ["No definido"],
  Sistema: ["Acceso al sistema", "Configurar terminal", "Administrar sesiones"],
  Archivos: ["Catalogo de clientes", "Catalogo de cobradores", "Catalogo de rutas"],
  Edición: ["Crear registros", "Editar registros", "Inactivar registros"],
  "Reportes y Procesamiento": ["Procesar cuadres", "Imprimir reportes", "Exportar reportes"],
  "Monitoreo y Otros": ["Monitor de cobradores", "Monitor de zonas", "Ver trazas del sistema"],
};

const accountRoleLabel = (role: PublicAccount["role"]): LegacyUserRecord["role"] => role === "admin" ? "Admin" : "Usuario";

const defaultLegacyUsers = (accounts: PublicAccount[]): LegacyUserRecord[] => {
  const source = accounts.length ? accounts : [
    { id: "legacy-admin", name: "Administración", email: "admin@cyp.local", role: "admin", status: "active" },
    { id: "legacy-collector", name: "Cobrador Demo", email: "collector@cyp.local", role: "collector", status: "active" },
  ] as PublicAccount[];
  return source.map((account) => ({
    id: account.id,
    name: account.name,
    username: account.email,
    role: accountRoleLabel(account.role),
    alias: account.email.split("@")[0] ?? account.email,
    active: account.status === "active",
  }));
};

const defaultUserPermissions = (user?: LegacyUserRecord): UserPermissionRecord[] => {
  const userId = user?.id ?? "usuario";
  const username = user?.username ?? "usuario";
  return [
    { id: `${userId}-perm-sistema`, userId, user: username, permissionId: "PERM-SIS-001", permission: "Sistema" },
    { id: `${userId}-perm-archivos`, userId, user: username, permissionId: "PERM-ARC-001", permission: "Archivos" },
    { id: `${userId}-perm-reportes`, userId, user: username, permissionId: "PERM-REP-001", permission: "Reportes y Procesamiento" },
  ];
};

function UserDataDialog({ user, onClose, onSave }: Readonly<{ user?: LegacyUserRecord; onClose: () => void; onSave: (draft: LegacyUserDraft) => void }>) {
  const [draft, setDraft] = useState<LegacyUserDraft>({
    name: user?.name ?? "",
    username: user?.username ?? "",
    role: user?.role ?? "No definido",
    alias: user?.alias ?? "",
    active: user?.active ?? true,
  });
  const [error, setError] = useState("");
  const update = <K extends keyof LegacyUserDraft>(field: K, value: LegacyUserDraft[K]) => setDraft((current) => ({ ...current, [field]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim()) {
      setError('El campo "Nombre" no puede estar vacío');
      return;
    }
    onSave(draft);
  };
  return (
    <LegacyDialog title="Datos de Usuario..." onClose={onClose} className="legacy-user-dialog">
      <form className="legacy-user-form" onSubmit={submit}>
        <label className="legacy-form-row"><span>Nombre:</span><input autoFocus value={draft.name} onChange={(event) => update("name", event.target.value)} /></label>
        <div className="legacy-form-row user-role-row">
          <label><span>Usuario:</span><input value={draft.username} onChange={(event) => update("username", event.target.value)} /></label>
          <label><span>Rol:</span><select value={draft.role} onChange={(event) => update("role", event.target.value as LegacyUserRecord["role"])}>{userRoleOptions.map((role) => <option key={role}>{role}</option>)}</select></label>
        </div>
        <label className="legacy-form-row"><span>Alias:</span><input className="short-input" value={draft.alias} onChange={(event) => update("alias", event.target.value)} /></label>
        <div className="legacy-dialog-actions"><button type="submit">oK</button><button type="button" onClick={onClose}>Cancelar</button></div>
      </form>
      {error && <LegacyAlertDialog message={error} onClose={() => setError("")} />}
    </LegacyDialog>
  );
}

function ChangePasswordDialog({ onClose, onSave }: Readonly<{ onClose: () => void; onSave: () => void }>) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!password.trim()) {
      setError("El campo clave no puede estar vacío");
      return;
    }
    if (password !== confirmation) {
      setError("La confirmación no coincide con la clave.");
      return;
    }
    onSave();
  };
  return (
    <LegacyDialog title="Cambiar clave de usuario..." onClose={onClose} className="legacy-password-dialog">
      <form className="legacy-user-form" onSubmit={submit}>
        <label className="legacy-form-row"><span>Clave:</span><input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label className="legacy-form-row"><span>Confirmación:</span><input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
        <div className="legacy-dialog-actions"><button type="submit">oK</button><button type="button" onClick={onClose}>Cancelar</button></div>
      </form>
      {error && <LegacyAlertDialog message={error} onClose={() => setError("")} />}
    </LegacyDialog>
  );
}

function PermissionToolbar({ onFirst, onPrevious, onNext, onLast, onNew, onDelete, onRefresh }: Readonly<{ onFirst: () => void; onPrevious: () => void; onNext: () => void; onLast: () => void; onNew: () => void; onDelete: () => void; onRefresh: () => void }>) {
  const action = (handler: () => void) => (event: ReactMouseEvent<HTMLButtonElement>) => { event.stopPropagation(); handler(); };
  return (
    <div className="legacy-mdi-toolbar permission-toolbar" aria-label="Barra de herramientas de permisos" onMouseDown={stopToolbarEvent} onClick={stopToolbarEvent}>
      <button type="button" className="nav-tool" title="Mover al inicio" onClick={action(onFirst)}>|&lt;</button>
      <button type="button" className="nav-tool" title="Subir" onClick={action(onPrevious)}>&lt;</button>
      <button type="button" className="nav-tool" title="Bajar" onClick={action(onNext)}>&gt;</button>
      <button type="button" className="nav-tool" title="Mover al final" onClick={action(onLast)}>&gt;|</button>
      <span className="mdi-toolbar-separator" />
      <button type="button" title="Agregar" onClick={action(onNew)}><Plus size={15} /></button>
      <button type="button" className="danger-tool" title="Eliminar" onClick={action(onDelete)}><Trash2 size={15} /></button>
      <button type="button" title="Refrescar" onClick={action(onRefresh)}><RefreshCw size={15} /></button>
    </div>
  );
}

function PermissionCategoryDialog({ onClose, onSave }: Readonly<{ onClose: () => void; onSave: (category: string, permission: string) => void }>) {
  const [category, setCategory] = useState(permissionCategoryOptions[0] ?? "No definido");
  const permissions = permissionCatalogByCategory[category] ?? [];
  const [selectedPermission, setSelectedPermission] = useState(permissions[0] ?? "");
  useEffect(() => {
    setSelectedPermission((permissionCatalogByCategory[category] ?? [])[0] ?? "");
  }, [category]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(category, selectedPermission || category);
  };
  return (
    <LegacyDialog title="Seleccionar permisos de usuarios... (*)" onClose={onClose} className="legacy-permission-select-dialog">
      <form className="legacy-permission-select-form" onSubmit={submit}>
        <label className="legacy-form-row"><span>Categoría:</span><select autoFocus value={category} onChange={(event) => setCategory(event.target.value)}>{permissionCategoryOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
        <div className="permission-picker-block">
          <span className="permission-picker-label">Seleccione:</span>
          <div className="permission-picker-table-wrap">
            <table className="legacy-mdi-table permission-picker-table">
              <thead><tr><th>Permiso</th></tr></thead>
              <tbody>{permissions.map((permission) => {
                const isSelected = selectedPermission === permission;
                return <tr key={`${category}-${permission}`} className={isSelected ? "selected-row" : ""} role="button" tabIndex={0} onClick={() => setSelectedPermission(permission)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedPermission(permission))}><td><span className={`mdi-row-select ${isSelected ? "selected" : ""}`}>{permission}</span></td></tr>;
              })}</tbody>
            </table>
          </div>
        </div>
        <div className="legacy-dialog-actions"><button type="submit">oK</button><button type="button" onClick={onClose}>Cancelar</button></div>
      </form>
    </LegacyDialog>
  );
}

function UserPermissionsDialog({ user, onClose }: Readonly<{ user: LegacyUserRecord; onClose: () => void }>) {
  const [permissions, setPermissions] = useState<UserPermissionRecord[]>(() => defaultUserPermissions(user));
  const [selectedPermissionId, setSelectedPermissionId] = useState(permissions[0]?.id ?? "");
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selectedPermission = permissions.find((permission) => permission.id === selectedPermissionId) ?? permissions[0];
  const moveSelectedPermission = (direction: "first" | "up" | "down" | "last") => {
    const currentIndex = permissions.findIndex((permission) => permission.id === selectedPermissionId);
    if (currentIndex < 0) return toast.info("Seleccione un permiso.");
    const targetIndexByDirection = { first: 0, up: Math.max(0, currentIndex - 1), down: Math.min(permissions.length - 1, currentIndex + 1), last: permissions.length - 1 } satisfies Record<typeof direction, number>;
    const targetIndex = targetIndexByDirection[direction];
    if (targetIndex === currentIndex) return toast.info("El permiso ya está en esa posición.");
    setPermissions((current) => {
      const reordered = [...current];
      const [selected] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, selected);
      return reordered;
    });
  };
  const addPermission = (category: string, permission: string) => {
    const next: UserPermissionRecord = { id: `${user.id}-perm-${Date.now()}`, userId: user.id, user: user.username, permissionId: `PERM-${String(permissions.length + 1).padStart(3, "0")}`, permission: category === "No definido" ? permission : `${category} - ${permission}` };
    setPermissions((current) => [...current, next]);
    setSelectedPermissionId(next.id);
    setCategoryOpen(false);
    toast.success("Permiso agregado");
  };
  const deletePermission = () => {
    if (!selectedPermission) return;
    setPermissions((current) => current.filter((permission) => permission.id !== selectedPermission.id));
    setSelectedPermissionId("");
    setConfirmDelete(false);
    toast.success("Permiso eliminado");
  };
  const refreshPermissions = () => {
    const reloaded = defaultUserPermissions(user);
    setPermissions(reloaded);
    setSelectedPermissionId(reloaded[0]?.id ?? "");
    toast.success("Permisos recargados");
  };
  return (
    <LegacyDialog title="Permisos del Usuario..." onClose={onClose} className="legacy-user-permissions-dialog">
      <div className="legacy-permissions-view">
        <PermissionToolbar onFirst={() => moveSelectedPermission("first")} onPrevious={() => moveSelectedPermission("up")} onNext={() => moveSelectedPermission("down")} onLast={() => moveSelectedPermission("last")} onNew={() => setCategoryOpen(true)} onDelete={() => selectedPermission ? setConfirmDelete(true) : toast.info("Seleccione un permiso.")} onRefresh={refreshPermissions} />
        <div className="legacy-mdi-table-wrap">
          <table className="legacy-mdi-table user-permissions-grid">
            <thead><tr><th>idUsuario</th><th>Usuario</th><th>idPermiso</th><th>Permiso</th></tr></thead>
            <tbody>{permissions.map((permission) => {
              const isSelected = selectedPermissionId === permission.id;
              return <tr key={permission.id} className={isSelected ? "selected-row" : ""} role="button" tabIndex={0} onClick={() => setSelectedPermissionId(permission.id)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedPermissionId(permission.id))}><td><span className={`mdi-row-select ${isSelected ? "selected" : ""}`}>{permission.userId}</span></td><td>{permission.user}</td><td>{permission.permissionId}</td><td>{permission.permission}</td></tr>;
            })}</tbody>
          </table>
        </div>
      </div>
      {categoryOpen && <PermissionCategoryDialog onClose={() => setCategoryOpen(false)} onSave={addPermission} />}
      {confirmDelete && <LegacyConfirmDialog message="¿Está seguro que desea eliminar este permiso?" onYes={deletePermission} onNo={() => setConfirmDelete(false)} />}
    </LegacyDialog>
  );
}

function UsersLegacyView({ accounts }: Readonly<{ accounts: PublicAccount[] }>): ReactNode {
  const [usersData, setUsersData] = useState<LegacyUserRecord[]>(() => defaultLegacyUsers(accounts));
  const [selectedUserId, setSelectedUserId] = useState(usersData[0]?.id ?? "");
  const [formMode, setFormMode] = useState<"new" | "edit" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const selectedUser = usersData.find((user) => user.id === selectedUserId) ?? usersData[0];
  const moveSelectedUser = (direction: "first" | "up" | "down" | "last") => {
    const currentIndex = usersData.findIndex((user) => user.id === selectedUserId);
    if (currentIndex < 0) return toast.info("Seleccione un usuario.");
    const targetIndexByDirection = { first: 0, up: Math.max(0, currentIndex - 1), down: Math.min(usersData.length - 1, currentIndex + 1), last: usersData.length - 1 } satisfies Record<typeof direction, number>;
    const targetIndex = targetIndexByDirection[direction];
    if (targetIndex === currentIndex) return toast.info("El usuario ya está en esa posición.");
    setUsersData((current) => {
      const reordered = [...current];
      const [selected] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, selected);
      return reordered;
    });
  };
  const refreshUsers = () => {
    const reloaded = defaultLegacyUsers(accounts);
    setUsersData(reloaded);
    setSelectedUserId(reloaded[0]?.id ?? "");
    toast.success("Usuarios recargados");
  };
  const saveUser = (draft: LegacyUserDraft) => {
    if (formMode === "edit" && selectedUser) {
      setUsersData((current) => current.map((user) => user.id === selectedUser.id ? { ...user, ...draft } : user));
      toast.success("Usuario actualizado");
    } else {
      const next: LegacyUserRecord = { id: `user-local-${Date.now()}`, ...draft };
      setUsersData((current) => [...current, next]);
      setSelectedUserId(next.id);
      toast.success("Usuario creado");
    }
    setFormMode(null);
  };
  const inactivateUser = () => {
    if (!selectedUser) return;
    setUsersData((current) => current.map((user) => user.id === selectedUser.id ? { ...user, active: false } : user));
    setConfirmDelete(false);
    toast.success("Usuario inactivado");
  };
  return (
    <div className="legacy-mdi-view">
      <LegacyToolbar onFirst={() => moveSelectedUser("first")} onPrevious={() => moveSelectedUser("up")} onNext={() => moveSelectedUser("down")} onLast={() => moveSelectedUser("last")} onNew={() => setFormMode("new")} onEdit={() => selectedUser ? setFormMode("edit") : toast.info("Seleccione un usuario.")} onDelete={() => selectedUser ? setConfirmDelete(true) : toast.info("Seleccione un usuario.")} onRefresh={refreshUsers} extra={<><button type="button" disabled={!selectedUser} title="Cambiar Clave" onClick={() => setPasswordOpen(true)}><KeyRound size={15} /></button><button type="button" disabled={!selectedUser} title="Permisos" onClick={() => setPermissionsOpen(true)}><ShieldCheck size={15} /></button></>} />
      <div className="legacy-mdi-table-wrap">
        <table className="legacy-mdi-table users-grid">
          <thead><tr><th>Usuario</th><th>Cuenta</th><th>Rol</th><th>Act.</th></tr></thead>
          <tbody>{usersData.map((user) => {
            const isSelected = selectedUserId === user.id;
            return <tr key={user.id} className={isSelected ? "selected-row" : ""} role="button" tabIndex={0} onClick={() => setSelectedUserId(user.id)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedUserId(user.id))}><td><span className={`mdi-row-select ${isSelected ? "selected" : ""}`}>{user.name}</span></td><td>{user.username}</td><td>{user.role}</td><td><LegacyCheck checked={user.active} /></td></tr>;
          })}</tbody>
        </table>
      </div>
      {formMode && <UserDataDialog user={formMode === "edit" ? selectedUser : undefined} onClose={() => setFormMode(null)} onSave={saveUser} />}
      {confirmDelete && <LegacyConfirmDialog message="¿Inactivar al usuario?" onYes={inactivateUser} onNo={() => setConfirmDelete(false)} />}
      {passwordOpen && <ChangePasswordDialog onClose={() => setPasswordOpen(false)} onSave={() => { setPasswordOpen(false); toast.success("Clave actualizada"); }} />}
      {permissionsOpen && selectedUser && <UserPermissionsDialog user={selectedUser} onClose={() => setPermissionsOpen(false)} />}
    </div>
  );
}

type TraceRecord = {
  id: string;
  date: string;
  time: string;
  trace: string;
};

const defaultTraceRecords: TraceRecord[] = [
  { id: "trace-1", date: "18/09/2026", time: "08:00:00", trace: "Inicio de sesion administrativa" },
  { id: "trace-2", date: "18/09/2026", time: "08:04:00", trace: "Consulta de cobradores" },
  { id: "trace-3", date: "18/09/2026", time: "08:15:00", trace: "Apertura de Panel de Control" },
  { id: "trace-4", date: "18/09/2026", time: "08:22:00", trace: "Actualizacion de catalogo de clientes" },
];

function TraceToolbar({ filtersVisible, onToggleFilters, onFirst, onPrevious, onNext, onLast, onRefresh }: Readonly<{ filtersVisible: boolean; onToggleFilters: () => void; onFirst: () => void; onPrevious: () => void; onNext: () => void; onLast: () => void; onRefresh: () => void }>) {
  const action = (handler: () => void) => (event: ReactMouseEvent<HTMLButtonElement>) => { event.stopPropagation(); handler(); };
  return (
    <div className="legacy-mdi-toolbar traces-toolbar" aria-label="Barra de herramientas de trazas" onMouseDown={stopToolbarEvent} onClick={stopToolbarEvent}>
      <button type="button" className={filtersVisible ? "nav-tool active" : "nav-tool"} title="Mostrar/Ocultar filtros" onClick={action(onToggleFilters)}><KeyRound size={15} /></button>
      <button type="button" className="nav-tool" title="Mover al inicio" onClick={action(onFirst)}>|&lt;</button>
      <button type="button" className="nav-tool" title="Subir" onClick={action(onPrevious)}>&lt;</button>
      <button type="button" className="nav-tool" title="Bajar" onClick={action(onNext)}>&gt;</button>
      <button type="button" className="nav-tool" title="Mover al final" onClick={action(onLast)}>&gt;|</button>
      <span className="mdi-toolbar-separator" />
      <button type="button" title="Refrescar" onClick={action(onRefresh)}><RefreshCw size={15} /></button>
    </div>
  );
}

function TracesLegacyView(): ReactNode {
  const [traces, setTraces] = useState<TraceRecord[]>(defaultTraceRecords);
  const [selectedTraceId, setSelectedTraceId] = useState(defaultTraceRecords[0]?.id ?? "");
  const [filtersVisible, setFiltersVisible] = useState(true);
  const [fromDate, setFromDate] = useState("2026-09-18");
  const [fromTime, setFromTime] = useState("00:00");
  const [toDate, setToDate] = useState("2026-09-18");
  const [toTime, setToTime] = useState("23:59");
  const [searchTerm, setSearchTerm] = useState("");
  const visibleTraces = traces.filter((trace) => trace.trace.toLowerCase().includes(searchTerm.trim().toLowerCase()));
  const moveSelectedTrace = (direction: "first" | "up" | "down" | "last") => {
    const currentIndex = traces.findIndex((trace) => trace.id === selectedTraceId);
    if (currentIndex < 0) return toast.info("Seleccione una traza.");
    const targetIndexByDirection = { first: 0, up: Math.max(0, currentIndex - 1), down: Math.min(traces.length - 1, currentIndex + 1), last: traces.length - 1 } satisfies Record<typeof direction, number>;
    const targetIndex = targetIndexByDirection[direction];
    if (targetIndex === currentIndex) return toast.info("La traza ya está en esa posición.");
    setTraces((current) => {
      const reordered = [...current];
      const [selected] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, selected);
      return reordered;
    });
  };
  const refreshTraces = () => {
    setTraces(defaultTraceRecords);
    setSelectedTraceId("");
    setFromDate("2026-09-18");
    setFromTime("00:00");
    setToDate("2026-09-18");
    setToTime("23:59");
    setSearchTerm("");
    toast.success("Trazas recargadas");
  };
  return (
    <div className="traces-mdi-view">
      <TraceToolbar filtersVisible={filtersVisible} onToggleFilters={() => setFiltersVisible((visible) => !visible)} onFirst={() => moveSelectedTrace("first")} onPrevious={() => moveSelectedTrace("up")} onNext={() => moveSelectedTrace("down")} onLast={() => moveSelectedTrace("last")} onRefresh={refreshTraces} />
      <div className="traces-workspace">
        {filtersVisible && (
          <aside className="traces-filter-panel" aria-label="Filtros de trazas">
            <label>Fecha Inicial:<span className="trace-datetime-row"><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /><input type="time" value={fromTime} onChange={(event) => setFromTime(event.target.value)} /></span></label>
            <label>Fecha final:<span className="trace-datetime-row"><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /><input type="time" value={toTime} onChange={(event) => setToTime(event.target.value)} /></span></label>
            <label>Buscar:<input type="text" value={searchTerm} placeholder="Digite texto..." onChange={(event) => setSearchTerm(event.target.value)} /></label>
          </aside>
        )}
        <div className="traces-grid-panel">
          <div className="legacy-mdi-table-wrap">
            <table className="legacy-mdi-table traces-grid">
              <thead><tr><th>Nro.</th><th>Fecha</th><th>Traza</th></tr></thead>
              <tbody>{visibleTraces.map((trace, index) => {
                const isSelected = selectedTraceId === trace.id;
                return <tr key={trace.id} className={isSelected ? "selected-row" : ""} role="button" tabIndex={0} onClick={() => setSelectedTraceId(trace.id)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedTraceId(trace.id))}><td><span className={`mdi-row-select ${isSelected ? "selected" : ""}`}>{index + 1}</span></td><td>{trace.date} {trace.time}</td><td>{trace.trace}</td></tr>;
              })}</tbody>
            </table>
          </div>
          <div className="legacy-mdi-pager traces-pager"><button type="button">|&lt;</button><button type="button">&lt;</button><span>Página [ 1 ] de 1</span><button type="button">&gt;</button><button type="button">&gt;|</button></div>
        </div>
      </div>
    </div>
  );
}

type ExchangeRateRecord = {
  id: string;
  date: string;
  time: string;
  currency: string;
  abbr: string;
  buy: string;
  sell: string;
  active: boolean;
};

type ExchangeRateDraft = Omit<ExchangeRateRecord, "id" | "abbr" | "active"> & { active: boolean };

const currencyAbbr = (currency: string) => {
  if (currency === "Dólar Americano") return "USD";
  if (currency === "Euro") return "EUR";
  if (currency === "Peso Dominicano") return "DOP";
  return "N/D";
};

const defaultExchangeRates = (): ExchangeRateRecord[] => [
  { id: "rate-dop", date: "2026-09-18", time: "00:00:00", currency: "Peso Dominicano", abbr: "DOP", buy: "1.00", sell: "1.00", active: true },
  { id: "rate-usd", date: "2026-09-18", time: "00:00:00", currency: "Dólar Americano", abbr: "USD", buy: "59.20", sell: "60.15", active: true },
  { id: "rate-eur", date: "2026-09-18", time: "00:00:00", currency: "Euro", abbr: "EUR", buy: "64.30", sell: "65.80", active: true },
];

function emptyExchangeRateDraft(): ExchangeRateDraft {
  return { date: "2026-09-18", time: "00:00:00", currency: "No Definida", buy: "0.00", sell: "0.00", active: true };
}

function exchangeRateToDraft(rate: ExchangeRateRecord): ExchangeRateDraft {
  return { date: rate.date, time: rate.time, currency: rate.currency, buy: rate.buy, sell: rate.sell, active: rate.active };
}

function ExchangeRateDataDialog({ rate, onClose, onSave }: Readonly<{ rate?: ExchangeRateRecord; onClose: () => void; onSave: (draft: ExchangeRateDraft) => void }>) {
  const [draft, setDraft] = useState<ExchangeRateDraft>(() => rate ? exchangeRateToDraft(rate) : emptyExchangeRateDraft());
  const [validationMessage, setValidationMessage] = useState("");
  const update = (field: keyof ExchangeRateDraft, value: string | boolean) => setDraft((current) => ({ ...current, [field]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft.currency === "No Definida" || !draft.currency.trim() || !draft.date.trim() || !draft.time.trim() || !draft.buy.trim() || !draft.sell.trim()) {
      setValidationMessage("La moneda no puede tener ese valor actual.");
      return;
    }
    onSave(draft);
  };
  return (
    <LegacyDialog title="Datos de la Tasa de Cambio..." onClose={onClose} className="exchange-rate-dialog">
      <form className="legacy-dialog-form exchange-rate-form" onSubmit={submit}>
        <label className="exchange-rate-row"><span className="exchange-rate-label">Moneda:</span><select value={draft.currency} onChange={(event) => update("currency", event.target.value)}><option>No Definida</option><option>Peso Dominicano</option><option>Dólar Americano</option><option>Euro</option></select></label>
        <div className="exchange-rate-row exchange-date-row"><span className="exchange-rate-label">Fecha:</span><input type="date" value={draft.date} onChange={(event) => update("date", event.target.value)} /><input type="time" step="1" value={draft.time} onChange={(event) => update("time", event.target.value)} /></div>
        <div className="exchange-rate-row exchange-money-row"><label><span>Compra:</span><input type="text" value={draft.buy} onChange={(event) => update("buy", event.target.value)} /></label><label><span>Venta:</span><input type="text" value={draft.sell} onChange={(event) => update("sell", event.target.value)} /></label></div>
        <div className="legacy-dialog-actions centered exchange-rate-actions"><button type="submit">oK</button><button type="button" onClick={onClose}>Cancelar</button></div>
      </form>
      {validationMessage && <LegacyAlertDialog message={validationMessage} onClose={() => setValidationMessage("")} />}
    </LegacyDialog>
  );
}

function ExchangeRatesLegacyView(): ReactNode {
  const [rates, setRates] = useState<ExchangeRateRecord[]>(() => defaultExchangeRates());
  const [selectedRateId, setSelectedRateId] = useState(rates[0]?.id ?? "");
  const [formMode, setFormMode] = useState<"new" | "edit" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selectedRate = rates.find((rate) => rate.id === selectedRateId) ?? rates[0];
  const moveSelectedRate = (direction: "first" | "up" | "down" | "last") => {
    const currentIndex = rates.findIndex((rate) => rate.id === selectedRateId);
    if (currentIndex < 0) return toast.info("Seleccione una tasa.");
    const targetIndexByDirection = { first: 0, up: Math.max(0, currentIndex - 1), down: Math.min(rates.length - 1, currentIndex + 1), last: rates.length - 1 } satisfies Record<typeof direction, number>;
    const targetIndex = targetIndexByDirection[direction];
    if (targetIndex === currentIndex) return toast.info("La tasa ya está en esa posición.");
    setRates((current) => {
      const reordered = [...current];
      const [selected] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, selected);
      return reordered;
    });
  };
  const refreshRates = () => {
    const reloaded = defaultExchangeRates();
    setRates(reloaded);
    setSelectedRateId(reloaded[0]?.id ?? "");
    toast.success("Tasas recargadas");
  };
  const saveRate = (draft: ExchangeRateDraft) => {
    if (formMode === "edit" && selectedRate) {
      setRates((current) => current.map((rate) => rate.id === selectedRate.id ? { ...rate, ...draft, abbr: currencyAbbr(draft.currency) } : rate));
      toast.success("Tasa actualizada");
    } else {
      const next = { id: `rate-local-${Date.now()}`, ...draft, abbr: currencyAbbr(draft.currency) };
      setRates((current) => [...current, next]);
      setSelectedRateId(next.id);
      toast.success("Tasa creada");
    }
    setFormMode(null);
  };
  const deleteRate = () => {
    if (!selectedRate) return;
    setRates((current) => current.filter((rate) => rate.id !== selectedRate.id));
    setSelectedRateId("");
    setConfirmDelete(false);
    toast.success("Tasa eliminada");
  };
  return (
    <div className="legacy-mdi-view">
      <LegacyToolbar onFirst={() => moveSelectedRate("first")} onPrevious={() => moveSelectedRate("up")} onNext={() => moveSelectedRate("down")} onLast={() => moveSelectedRate("last")} onNew={() => setFormMode("new")} onEdit={() => selectedRate ? setFormMode("edit") : toast.info("Seleccione una tasa.")} onDelete={() => selectedRate ? setConfirmDelete(true) : toast.info("Seleccione una tasa.")} onRefresh={refreshRates} />
      <div className="legacy-mdi-table-wrap">
        <table className="legacy-mdi-table exchange-rates-grid">
          <thead><tr><th>Fecha</th><th>Moneda</th><th>Abrev</th><th>Compra</th><th>Venta</th></tr></thead>
          <tbody>{rates.map((rate) => {
            const isSelected = selectedRateId === rate.id;
            return <tr key={rate.id} className={isSelected ? "selected-row" : ""} role="button" tabIndex={0} onClick={() => setSelectedRateId(rate.id)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedRateId(rate.id))}><td><span className={`mdi-row-select ${isSelected ? "selected" : ""}`}>{rate.date}</span></td><td>{rate.currency}</td><td>{rate.abbr}</td><td>{rate.buy}</td><td>{rate.sell}</td></tr>;
          })}</tbody>
        </table>
      </div>
      {formMode && <ExchangeRateDataDialog rate={formMode === "edit" ? selectedRate : undefined} onClose={() => setFormMode(null)} onSave={saveRate} />}
      {confirmDelete && <LegacyConfirmDialog message="¿Inactivar datos?" onYes={deleteRate} onNo={() => setConfirmDelete(false)} />}
    </div>
  );
}

type ServiceProductRecord = {
  id: string;
  service: string;
  abbr: string;
  caption: string;
  obligated: boolean;
  active: boolean;
};

type ServiceProductDraft = Omit<ServiceProductRecord, "id" | "active"> & { active: boolean };

function defaultServiceProducts(services: readonly string[]): ServiceProductRecord[] {
  const baseServices = services.length ? services : ["COBRO DE SERVICIO", "RECARGA", "REMESA"];
  return baseServices.map((service, index) => ({
    id: `service-product-${index}-${abbreviation(service)}`,
    service,
    abbr: abbreviation(service),
    caption: service,
    obligated: index === 0,
    active: true,
  }));
}

function emptyServiceProductDraft(): ServiceProductDraft {
  return { service: "", abbr: "", caption: "", obligated: false, active: true };
}

function serviceProductToDraft(service: ServiceProductRecord): ServiceProductDraft {
  return { service: service.service, abbr: service.abbr, caption: service.caption, obligated: service.obligated, active: service.active };
}

function ServiceProductDataDialog({ service, onClose, onSave }: Readonly<{ service?: ServiceProductRecord; onClose: () => void; onSave: (draft: ServiceProductDraft) => void }>) {
  const [draft, setDraft] = useState<ServiceProductDraft>(() => service ? serviceProductToDraft(service) : emptyServiceProductDraft());
  const [validationMessage, setValidationMessage] = useState("");
  const update = (field: keyof ServiceProductDraft, value: string | boolean) => setDraft((current) => ({ ...current, [field]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.service.trim()) {
      setValidationMessage("El campo 'Servicio' no puede estar vacío");
      return;
    }
    onSave(draft);
  };
  return (
    <LegacyDialog title="Datos del Servicio o Producto (Bien)..." onClose={onClose} className="service-product-dialog">
      <form className="legacy-dialog-form service-product-form" onSubmit={submit}>
        <label className="service-form-row"><span className="service-form-label">Bien:</span><input autoFocus value={draft.service} onChange={(event) => update("service", event.target.value)} /></label>
        <div className="service-form-row service-two-cols">
          <label><span>Caption:</span><input value={draft.caption} onChange={(event) => update("caption", event.target.value)} /></label>
          <label><span>Abrev:</span><input value={draft.abbr} onChange={(event) => update("abbr", event.target.value)} /></label>
        </div>
        <label className="legacy-check-line service-obligated-line"><input type="checkbox" checked={draft.obligated} onChange={(event) => update("obligated", event.target.checked)} /><span>Obligado cobrar</span></label>
        <div className="legacy-dialog-actions centered service-form-actions"><button type="submit">oK</button><button type="button" onClick={onClose}>Cancelar</button></div>
      </form>
      {validationMessage && <LegacyAlertDialog message={validationMessage} onClose={() => setValidationMessage("")} />}
    </LegacyDialog>
  );
}

function ServicesProductsLegacyView({ services }: Readonly<{ services: readonly string[] }>): ReactNode {
  const [items, setItems] = useState<ServiceProductRecord[]>(() => defaultServiceProducts(services));
  const [selectedItemId, setSelectedItemId] = useState(items[0]?.id ?? "");
  const [formMode, setFormMode] = useState<"new" | "edit" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? items[0];
  const moveSelectedItem = (direction: "first" | "up" | "down" | "last") => {
    const currentIndex = items.findIndex((item) => item.id === selectedItemId);
    if (currentIndex < 0) return toast.info("Seleccione un servicio.");
    const targetIndexByDirection = { first: 0, up: Math.max(0, currentIndex - 1), down: Math.min(items.length - 1, currentIndex + 1), last: items.length - 1 } satisfies Record<typeof direction, number>;
    const targetIndex = targetIndexByDirection[direction];
    if (targetIndex === currentIndex) return toast.info("El servicio ya está en esa posición.");
    setItems((current) => {
      const reordered = [...current];
      const [selected] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, selected);
      return reordered;
    });
  };
  const refreshItems = () => {
    const reloaded = defaultServiceProducts(services);
    setItems(reloaded);
    setSelectedItemId("");
    toast.success("Servicios recargados");
  };
  const saveItem = (draft: ServiceProductDraft) => {
    if (formMode === "edit" && selectedItem) {
      setItems((current) => current.map((item) => item.id === selectedItem.id ? { ...item, ...draft, caption: draft.caption || draft.service, abbr: draft.abbr || abbreviation(draft.service) } : item));
      toast.success("Servicio actualizado");
    } else {
      const next = { id: `service-product-local-${Date.now()}`, ...draft, caption: draft.caption || draft.service, abbr: draft.abbr || abbreviation(draft.service) };
      setItems((current) => [...current, next]);
      setSelectedItemId(next.id);
      toast.success("Servicio creado");
    }
    setFormMode(null);
  };
  const inactivateItem = () => {
    if (!selectedItem) return;
    setItems((current) => current.map((item) => item.id === selectedItem.id ? { ...item, active: false } : item));
    setConfirmDelete(false);
    toast.success("Servicio inactivado");
  };
  return (
    <div className="legacy-mdi-view">
      <LegacyToolbar onFirst={() => moveSelectedItem("first")} onPrevious={() => moveSelectedItem("up")} onNext={() => moveSelectedItem("down")} onLast={() => moveSelectedItem("last")} onNew={() => setFormMode("new")} onEdit={() => selectedItem ? setFormMode("edit") : toast.info("Seleccione un servicio.")} onDelete={() => selectedItem ? setConfirmDelete(true) : toast.info("Seleccione un servicio.")} onRefresh={refreshItems} />
      <div className="legacy-mdi-table-wrap">
        <table className="legacy-mdi-table services-products-grid">
          <thead><tr><th>Nro.</th><th>Servicio</th><th>Abrev</th><th>Caption</th><th>Ob. Cob.</th><th>Activo</th></tr></thead>
          <tbody>{items.map((item, index) => {
            const isSelected = selectedItemId === item.id;
            return <tr key={item.id} className={isSelected ? "selected-row" : ""} role="button" tabIndex={0} onClick={() => setSelectedItemId(item.id)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedItemId(item.id))}><td><span className={`mdi-row-select ${isSelected ? "selected" : ""}`}>{index + 1}</span></td><td>{item.service}</td><td>{item.abbr}</td><td>{item.caption}</td><td><LegacyCheck checked={item.obligated} /></td><td><LegacyCheck checked={item.active} /></td></tr>;
          })}</tbody>
        </table>
      </div>
      {formMode && <ServiceProductDataDialog service={formMode === "edit" ? selectedItem : undefined} onClose={() => setFormMode(null)} onSave={saveItem} />}
      {confirmDelete && <LegacyConfirmDialog message="¿Inactivar datos?" onYes={inactivateItem} onNo={() => setConfirmDelete(false)} />}
    </div>
  );
}

type PcpRecord = {
  id: string;
  number: string;
  pcp: string;
  clientName: string;
  group: string;
  route: string;
  address: string;
  phone: string;
  active: boolean;
};

type PcpDraft = Omit<PcpRecord, "id" | "active"> & { active: boolean };

function buildDefaultPcps(snapshot: Snapshot, routeName: (routeId: string) => string): PcpRecord[] {
  return snapshot.clients.map((client, index) => ({
    id: `pcp-${client.id}`,
    number: String(index + 1),
    pcp: `PCP-${client.code}`,
    clientName: client.name,
    group: index % 2 ? "df" : "Grupo Principal",
    route: routeName(client.routeId),
    address: client.address ?? "",
    phone: client.phone ?? "",
    active: true,
  }));
}

function emptyPcpDraft(): PcpDraft {
  return { number: "", pcp: "", clientName: "", group: "Grupo Principal", route: "Ruta Centro", address: "", phone: "", active: true };
}

function pcpToDraft(pcp: PcpRecord): PcpDraft {
  return { number: pcp.number, pcp: pcp.pcp, clientName: pcp.clientName, group: pcp.group, route: pcp.route, address: pcp.address, phone: pcp.phone, active: pcp.active };
}

function PcpDataDialog({ pcp, onClose, onSave }: Readonly<{ pcp?: PcpRecord; routes: readonly string[]; onClose: () => void; onSave: (draft: PcpDraft) => void }>) {
  const [draft, setDraft] = useState<PcpDraft>(() => pcp ? pcpToDraft(pcp) : emptyPcpDraft());
  const [validationMessage, setValidationMessage] = useState("");
  const update = (field: keyof PcpDraft, value: string | boolean) => setDraft((current) => ({ ...current, [field]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.number.trim()) {
      setValidationMessage("El campo 'Número' no puede estar vacío");
      return;
    }
    onSave({ ...draft, clientName: draft.clientName || draft.pcp });
  };
  return (
    <LegacyDialog title="Datos del Punto de Cobro y Pago..." onClose={onClose} className="pcp-data-dialog">
      <form className="legacy-dialog-form pcp-data-form legacy-pcp-form" onSubmit={submit}>
        <div className="pcp-form-row pcp-code-row">
          <span className="pcp-form-label">PCP:</span>
          <input className="pcp-code-input" autoFocus value={draft.number} onChange={(event) => update("number", event.target.value)} />
          <input className="pcp-name-input" value={draft.pcp} onChange={(event) => { update("pcp", event.target.value); update("clientName", event.target.value); }} />
        </div>
        <label className="pcp-form-row">
          <span className="pcp-form-label">Grupo:</span>
          <select value={draft.group} onChange={(event) => update("group", event.target.value)}><option>Grupo Principal</option><option>df</option><option>GRUPO MAYITO</option></select>
        </label>
        <label className="pcp-form-row">
          <span className="pcp-form-label">Dir.:</span>
          <input type="text" value={draft.address} onChange={(event) => update("address", event.target.value)} />
        </label>
        <label className="pcp-form-row pcp-phone-row">
          <span className="pcp-form-label">Telef.:</span>
          <input type="text" value={draft.phone} onChange={(event) => update("phone", event.target.value)} />
        </label>
        <div className="legacy-dialog-actions centered pcp-form-actions"><button type="submit">oK</button><button type="button" onClick={onClose}>Cancelar</button></div>
      </form>
      {validationMessage && <LegacyAlertDialog message={validationMessage} onClose={() => setValidationMessage("")} />}
    </LegacyDialog>
  );
}

function PcpStationSelectDialog({ assignedStationIds, onClose, onSelect }: Readonly<{ assignedStationIds: readonly string[]; onClose: () => void; onSelect: (station: PcpStationRecord) => void }>) {
  const availableStations = defaultPcpStations().filter((station) => !assignedStationIds.includes(station.id));
  const [selectedStationId, setSelectedStationId] = useState(availableStations[0]?.id ?? "");
  const selectedStation = availableStations.find((station) => station.id === selectedStationId);
  return (
    <LegacyDialog title="Seleccionar..." onClose={onClose} className="legacy-select-dialog">
      <div className="legacy-dialog-form">
        <label>Seleccione:<select autoFocus value={selectedStationId} onChange={(event) => setSelectedStationId(event.target.value)}>{availableStations.map((station) => <option key={station.id} value={station.id}>{station.station}</option>)}</select></label>
        <div className="legacy-dialog-actions centered"><button type="button" disabled={!selectedStation} onClick={() => selectedStation && onSelect(selectedStation)}>oK</button><button type="button" onClick={onClose}>Cancelar</button></div>
      </div>
    </LegacyDialog>
  );
}

function PcpStationsDialog({ pcp, onClose }: Readonly<{ pcp?: PcpRecord; onClose: () => void }>) {
  const [stations, setStations] = useState<PcpStationRecord[]>(() => defaultPcpStations().slice(0, 1));
  const [selectedStationId, setSelectedStationId] = useState(stations[0]?.id ?? "");
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const addStation = (station: PcpStationRecord) => {
    setStations((current) => [...current, station]);
    setSelectedStationId(station.id);
    setAdding(false);
    toast.success("Estación agregada al PCP");
  };
  const deleteStation = () => {
    setStations((current) => current.filter((station) => station.id !== selectedStationId));
    setSelectedStationId("");
    setConfirmDelete(false);
    toast.success("Estación eliminada del PCP");
  };
  return (
    <LegacyDialog title="Estaciones del PCP..." onClose={onClose} className="pcp-stations-dialog">
      <div className="legacy-relation-manager">
        <div className="legacy-relation-toolbar"><button type="button" onClick={() => defaultPcpStations().some((station) => !stations.some((current) => current.id === station.id)) ? setAdding(true) : toast.info("No hay estaciones disponibles.")}>Agregar</button><button type="button" disabled={!selectedStationId} onClick={() => setConfirmDelete(true)}>Eliminar</button></div>
        <LegacyDenseTable columns={["Nro", "Estación", "idDispositivo", "Activa"]} rows={stations.map((station, index) => [<button type="button" className={`mdi-row-select ${selectedStationId === station.id ? "selected" : ""}`} onClick={() => setSelectedStationId(station.id)}>{index + 1}</button>, station.station, station.deviceId, <LegacyCheck checked={station.active} />])} />
        <div className="legacy-relation-footer"><span className="pcp-stations-owner">{pcp?.pcp ?? "PCP"}</span><button type="button" onClick={onClose}>Cerrar</button></div>
      </div>
      {adding && <PcpStationSelectDialog assignedStationIds={stations.map((station) => station.id)} onClose={() => setAdding(false)} onSelect={addStation} />}
      {confirmDelete && <LegacyConfirmDialog message="¿Realmente desea borrar los datos?" onYes={deleteStation} onNo={() => setConfirmDelete(false)} />}
    </LegacyDialog>
  );
}

function PcpToolbar({ filtersVisible, selectedPcp, onToggleFilters, onFirst, onPrevious, onNext, onLast, onNew, onEdit, onDelete, onRefresh, onStations }: Readonly<{ filtersVisible: boolean; selectedPcp?: PcpRecord; onToggleFilters: () => void; onFirst: () => void; onPrevious: () => void; onNext: () => void; onLast: () => void; onNew: () => void; onEdit: () => void; onDelete: () => void; onRefresh: () => void; onStations: () => void }>) {
  const action = (handler: () => void) => (event: ReactMouseEvent<HTMLButtonElement>) => { event.stopPropagation(); handler(); };
  return (
    <div className="legacy-mdi-toolbar pcp-toolbar" aria-label="Barra de herramientas de PCP" onMouseDown={stopToolbarEvent} onClick={stopToolbarEvent}>
      <button type="button" className={filtersVisible ? "nav-tool active" : "nav-tool"} title="Mostrar/Ocultar filtros" onClick={action(onToggleFilters)}><KeyRound size={15} /></button>
      <button type="button" className="nav-tool" title="Mover al inicio" onClick={action(onFirst)}>|&lt;</button>
      <button type="button" className="nav-tool" title="Subir" onClick={action(onPrevious)}>&lt;</button>
      <button type="button" className="nav-tool" title="Bajar" onClick={action(onNext)}>&gt;</button>
      <button type="button" className="nav-tool" title="Mover al final" onClick={action(onLast)}>&gt;|</button>
      <span className="mdi-toolbar-separator" />
      <button type="button" title="Nuevo" onClick={action(onNew)}><Plus size={15} /></button>
      <button type="button" title="Editar" onClick={action(onEdit)}><Pencil size={15} /></button>
      <button type="button" className="danger-tool" title="Eliminar" onClick={action(onDelete)}><Trash2 size={15} /></button>
      <button type="button" title="Refrescar" onClick={action(onRefresh)}><RefreshCw size={15} /></button>
      <button type="button" className="pcp-stations-button" title="Estaciones del PCP" disabled={!selectedPcp} onClick={action(onStations)}><Building2 size={15} /><span>Estaciones</span></button>
    </div>
  );
}

function PcpsLegacyView({ snapshot, routeName, onRefresh }: Readonly<{ snapshot: Snapshot; routeName: (routeId: string) => string; onRefresh: () => void }>): ReactNode {
  const routeOptions = Array.from(new Set(snapshot.routes.map((route) => routeName(route.id))));
  const defaultRows = () => buildDefaultPcps(snapshot, routeName);
  const [pcps, setPcps] = useState<PcpRecord[]>(defaultRows);
  const [selectedPcpId, setSelectedPcpId] = useState(pcps[0]?.id ?? "");
  const [filterMode, setFilterMode] = useState<"all" | "group">("all");
  const [group, setGroup] = useState("Grupo Principal");
  const [filtersVisible, setFiltersVisible] = useState(true);
  const [formMode, setFormMode] = useState<"new" | "edit" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [stationsOpen, setStationsOpen] = useState(false);
  const selectedPcp = pcps.find((pcp) => pcp.id === selectedPcpId) ?? pcps[0];
  const rows = pcps.filter((row) => filterMode === "all" || row.group === group);
  const moveSelectedPcp = (direction: "first" | "up" | "down" | "last") => {
    const currentIndex = pcps.findIndex((pcp) => pcp.id === selectedPcpId);
    if (currentIndex < 0) return toast.info("Seleccione un PCP.");
    const targetIndexByDirection = { first: 0, up: Math.max(0, currentIndex - 1), down: Math.min(pcps.length - 1, currentIndex + 1), last: pcps.length - 1 } satisfies Record<typeof direction, number>;
    const targetIndex = targetIndexByDirection[direction];
    if (targetIndex === currentIndex) return toast.info("El PCP ya está en esa posición.");
    setPcps((current) => {
      const reordered = [...current];
      const [selected] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, selected);
      return reordered;
    });
  };
  const refreshPcps = () => {
    const reloaded = defaultRows();
    setPcps(reloaded);
    setSelectedPcpId(reloaded[0]?.id ?? "");
    setFilterMode("all");
    setGroup("Grupo Principal");
    onRefresh();
    toast.success("PCPs recargados");
  };
  const savePcp = (draft: PcpDraft) => {
    if (formMode === "edit" && selectedPcp) {
      setPcps((current) => current.map((pcp) => pcp.id === selectedPcp.id ? { ...pcp, ...draft } : pcp));
      toast.success("PCP actualizado");
    } else {
      const next = { id: `pcp-local-${Date.now()}`, ...draft };
      setPcps((current) => [...current, next]);
      setSelectedPcpId(next.id);
      toast.success("PCP creado");
    }
    setFormMode(null);
  };
  const deletePcp = () => {
    if (!selectedPcp) return;
    setPcps((current) => current.filter((pcp) => pcp.id !== selectedPcp.id));
    setSelectedPcpId("");
    setConfirmDelete(false);
    toast.success("PCP eliminado");
  };
  return (
    <div className="pcp-mdi-view">
      <PcpToolbar filtersVisible={filtersVisible} selectedPcp={selectedPcp} onToggleFilters={() => setFiltersVisible((visible) => !visible)} onFirst={() => moveSelectedPcp("first")} onPrevious={() => moveSelectedPcp("up")} onNext={() => moveSelectedPcp("down")} onLast={() => moveSelectedPcp("last")} onNew={() => setFormMode("new")} onEdit={() => selectedPcp ? setFormMode("edit") : toast.info("Seleccione un PCP.")} onDelete={() => selectedPcp ? setConfirmDelete(true) : toast.info("Seleccione un PCP.")} onRefresh={refreshPcps} onStations={() => selectedPcp ? setStationsOpen(true) : toast.info("Seleccione un PCP.")} />
      <div className="pcp-workspace">
        {filtersVisible && (
          <aside className="pcp-filter-panel" aria-label="Filtros de PCP">
            <label className="pcp-radio-line"><input type="radio" name="pcp-filter" checked={filterMode === "all"} onChange={() => setFilterMode("all")} /> <span>Todos</span></label>
            <label className="pcp-radio-line"><input type="radio" name="pcp-filter" checked={filterMode === "group"} onChange={() => setFilterMode("group")} /> <span>del Grupo:</span></label>
            <select value={group} onChange={(event) => { setGroup(event.target.value); setFilterMode("group"); }}><option>Grupo Principal</option><option>df</option><option>GRUPO MAYITO</option></select>
          </aside>
        )}
        <div className="pcp-grid-panel">
          <div className="legacy-mdi-table-wrap">
            <table className="legacy-mdi-table pcp-grid">
              <thead><tr><th>Nro.</th><th>PCP</th><th>Cliente</th><th>Grupo</th><th>Ruta</th><th>Activo</th></tr></thead>
              <tbody>{rows.map((row) => {
                const isSelected = selectedPcpId === row.id;
                return <tr key={row.id} className={isSelected ? "selected-row" : ""} role="button" tabIndex={0} onClick={() => setSelectedPcpId(row.id)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedPcpId(row.id))}><td><span className={`mdi-row-select ${isSelected ? "selected" : ""}`}>{row.number}</span></td><td>{row.pcp}</td><td>{row.clientName}</td><td>{row.group}</td><td>{row.route}</td><td><LegacyCheck checked={row.active} /></td></tr>;
              })}</tbody>
            </table>
          </div>
        </div>
      </div>
      {formMode && <PcpDataDialog pcp={formMode === "edit" ? selectedPcp : undefined} routes={routeOptions.length ? routeOptions : ["Ruta Centro"]} onClose={() => setFormMode(null)} onSave={savePcp} />}
      {confirmDelete && <LegacyConfirmDialog message="¿Realmente desea borrar los datos?" onYes={deletePcp} onNo={() => setConfirmDelete(false)} />}
      {stationsOpen && <PcpStationsDialog pcp={selectedPcp} onClose={() => setStationsOpen(false)} />}
    </div>
  );
}

type PcpGroupRecord = {
  id: string;
  name: string;
};

const defaultPcpGroups = (): PcpGroupRecord[] => [
  { id: "pcp-group-main", name: "Grupo Principal" },
  { id: "pcp-group-df", name: "df" },
  { id: "pcp-group-mayito", name: "GRUPO MAYITO" },
];

function PcpGroupDialog({ group, onClose, onSave }: Readonly<{ group?: PcpGroupRecord; onClose: () => void; onSave: (name: string) => void }>) {
  const [name, setName] = useState(group?.name ?? "");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return toast.error("El nombre del grupo es requerido.");
    onSave(name.trim());
  };
  return (
    <LegacyDialog title="Nombre del Grupo..." onClose={onClose} className="legacy-select-dialog">
      <form className="legacy-dialog-form" onSubmit={submit}>
        <label>Nombre:<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
        <div className="legacy-dialog-actions centered"><button type="submit">oK</button><button type="button" onClick={onClose}>Cancelar</button></div>
      </form>
    </LegacyDialog>
  );
}

function PcpGroupsLegacyView(): ReactNode {
  const [groupsData, setGroupsData] = useState<PcpGroupRecord[]>(() => defaultPcpGroups());
  const [selectedGroupId, setSelectedGroupId] = useState(groupsData[0]?.id ?? "");
  const [formMode, setFormMode] = useState<"new" | "edit" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selectedGroup = groupsData.find((group) => group.id === selectedGroupId) ?? groupsData[0];
  const moveSelectedGroup = (direction: "first" | "up" | "down" | "last") => {
    const currentIndex = groupsData.findIndex((group) => group.id === selectedGroupId);
    if (currentIndex < 0) return toast.info("Seleccione un grupo.");
    const targetIndexByDirection = {
      first: 0,
      up: Math.max(0, currentIndex - 1),
      down: Math.min(groupsData.length - 1, currentIndex + 1),
      last: groupsData.length - 1,
    } satisfies Record<typeof direction, number>;
    const targetIndex = targetIndexByDirection[direction];
    if (targetIndex === currentIndex) return toast.info("El grupo ya está en esa posición.");
    setGroupsData((current) => {
      const reordered = [...current];
      const [selected] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, selected);
      return reordered;
    });
  };
  const refreshGroups = () => {
    const reloaded = defaultPcpGroups();
    setGroupsData(reloaded);
    setSelectedGroupId(reloaded[0]?.id ?? "");
    toast.success("Grupos recargados");
  };
  const saveGroup = (name: string) => {
    if (formMode === "edit" && selectedGroup) {
      setGroupsData((current) => current.map((group) => group.id === selectedGroup.id ? { ...group, name } : group));
      toast.success("Grupo actualizado");
    } else {
      const next = { id: `pcp-group-local-${Date.now()}`, name };
      setGroupsData((current) => [...current, next]);
      setSelectedGroupId(next.id);
      toast.success("Grupo creado");
    }
    setFormMode(null);
  };
  const deleteGroup = () => {
    if (!selectedGroup) return;
    setGroupsData((current) => current.filter((group) => group.id !== selectedGroup.id));
    setSelectedGroupId("");
    setConfirmDelete(false);
    toast.success("Grupo eliminado");
  };
  return (
    <div className="legacy-mdi-view">
      <LegacyToolbar onFirst={() => moveSelectedGroup("first")} onPrevious={() => moveSelectedGroup("up")} onNext={() => moveSelectedGroup("down")} onLast={() => moveSelectedGroup("last")} onNew={() => setFormMode("new")} onEdit={() => selectedGroup ? setFormMode("edit") : toast.info("Seleccione un grupo.")} onDelete={() => selectedGroup ? setConfirmDelete(true) : toast.info("Seleccione un grupo.")} onRefresh={refreshGroups} />
      <div className="legacy-mdi-table-wrap">
        <table className="legacy-mdi-table groups-grid">
          <thead><tr><th>Nro.</th><th>Grupo</th></tr></thead>
          <tbody>
            {groupsData.map((group, index) => {
              const isSelected = selectedGroupId === group.id;
              return (
                <tr key={group.id} className={isSelected ? "selected-row" : ""} role="button" tabIndex={0} onClick={() => setSelectedGroupId(group.id)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedGroupId(group.id))}>
                  <td><span className={`mdi-row-select ${isSelected ? "selected" : ""}`}>{index + 1}</span></td>
                  <td>{group.name}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {formMode && <PcpGroupDialog group={formMode === "edit" ? selectedGroup : undefined} onClose={() => setFormMode(null)} onSave={saveGroup} />}
      {confirmDelete && <LegacyConfirmDialog message="¿Realmente desea borrar los datos?" onYes={deleteGroup} onNo={() => setConfirmDelete(false)} />}
    </div>
  );
}

function StationsLegacyView(): ReactNode {
  const [stationsData, setStationsData] = useState<PcpStationRecord[]>(() => defaultPcpStations());
  const [selectedStationId, setSelectedStationId] = useState(stationsData[0]?.id ?? "");
  const [formMode, setFormMode] = useState<"new" | "edit" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selectedStation = stationsData.find((station) => station.id === selectedStationId) ?? stationsData[0];
  const moveSelectedStation = (direction: "first" | "up" | "down" | "last") => {
    const currentIndex = stationsData.findIndex((station) => station.id === selectedStationId);
    if (currentIndex < 0) return toast.info("Seleccione una estación.");
    const targetIndexByDirection = {
      first: 0,
      up: Math.max(0, currentIndex - 1),
      down: Math.min(stationsData.length - 1, currentIndex + 1),
      last: stationsData.length - 1,
    } satisfies Record<typeof direction, number>;
    const targetIndex = targetIndexByDirection[direction];
    if (targetIndex === currentIndex) return toast.info("La estación ya está en esa posición.");
    setStationsData((current) => {
      const reordered = [...current];
      const [selected] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, selected);
      return reordered;
    });
  };
  const refreshStations = () => {
    const reloaded = defaultPcpStations();
    setStationsData(reloaded);
    setSelectedStationId(reloaded[0]?.id ?? "");
    toast.success("Estaciones recargadas");
  };
  const saveStation = (draft: PcpStationDraft) => {
    if (formMode === "edit" && selectedStation) {
      setStationsData((current) => current.map((station) => station.id === selectedStation.id ? { ...station, ...draft, version: draft.version ?? station.version, receivedVersion: draft.receivedVersion ?? station.receivedVersion } : station));
      toast.success("Estación actualizada");
    } else {
      const next: PcpStationRecord = { id: `station-local-${Date.now()}`, version: draft.version ?? "1.0.0", receivedVersion: draft.receivedVersion ?? "1.0.0", ...draft };
      setStationsData((current) => [...current, next]);
      setSelectedStationId(next.id);
      toast.success("Estación creada");
    }
    setFormMode(null);
  };
  const deleteStation = () => {
    if (!selectedStation) return;
    setStationsData((current) => current.filter((station) => station.id !== selectedStation.id));
    setSelectedStationId("");
    setConfirmDelete(false);
    toast.success("Estación eliminada");
  };
  return (
    <div className="legacy-mdi-view">
      <LegacyToolbar onFirst={() => moveSelectedStation("first")} onPrevious={() => moveSelectedStation("up")} onNext={() => moveSelectedStation("down")} onLast={() => moveSelectedStation("last")} onNew={() => setFormMode("new")} onEdit={() => selectedStation ? setFormMode("edit") : toast.info("Seleccione una estación.")} onDelete={() => selectedStation ? setConfirmDelete(true) : toast.info("Seleccione una estación.")} onRefresh={refreshStations} />
      <div className="legacy-mdi-table-wrap">
        <table className="legacy-mdi-table stations-grid">
          <thead><tr><th>Nro</th><th>Estacion</th><th>idDispositivo</th><th>Licencia</th><th>Version</th><th>VersionRec</th><th>Activa</th></tr></thead>
          <tbody>
            {stationsData.map((station) => {
              const isSelected = selectedStationId === station.id;
              return (
                <tr key={station.id} className={isSelected ? "selected-row" : ""} role="button" tabIndex={0} onClick={() => setSelectedStationId(station.id)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedStationId(station.id))}>
                  <td><span className={`mdi-row-select ${isSelected ? "selected" : ""}`}>{station.number}</span></td>
                  <td>{station.station}</td>
                  <td>{station.deviceId}</td>
                  <td>{station.license}</td>
                  <td>{station.version}</td>
                  <td>{station.receivedVersion}</td>
                  <td><LegacyCheck checked={station.active} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {formMode && <PcpStationDialog station={formMode === "edit" ? selectedStation : undefined} onClose={() => setFormMode(null)} onSave={saveStation} />}
      {confirmDelete && <LegacyConfirmDialog message="¿Eliminar la estación seleccionada?" onYes={deleteStation} onNo={() => setConfirmDelete(false)} />}
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
  "impresion.listadoHtml": false,
  "impresion.listadoMatriz": false,
  "impresion.listadoVirtual": false,
  "impresion.listadoUrl": "",
  "impresion.listadoPuerto": "",
  "impresion.listadoNombre": "",
  "interfaz.monitorInicio": true,
  "gps.latitud": "19.4499607086182",
  "gps.longitud": "-70.68701171875",
};

function LegacyCodifierView({ page, snapshot, onRefresh, onAccount }: Readonly<{ page: Page; snapshot: Snapshot; onRefresh: () => void; onAccount: (operation: AccountOperation) => void }>) {
  const [configTab, setConfigTab] = useState("General");
  const [printTab, setPrintTab] = useState<"Listados" | "Recibos">("Listados");
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
  if (page === "stations") return <StationsLegacyView />;
  if (page === "groups") return <PcpGroupsLegacyView />;
  if (page === "delayReasons") return <DelayReasonsLegacyView />;
  if (page === "routes") return <RoutesLegacyView snapshot={snapshot} />;
  if (page === "servicesProducts") return <ServicesProductsLegacyView services={services} />;
  if (page === "exchangeRates") return <ExchangeRatesLegacyView />;
  if (page === "pcps") return <PcpsLegacyView snapshot={snapshot} routeName={routeName} onRefresh={onRefresh} />;
  if (page === "sessions") return <SessionsLegacyView snapshot={snapshot} />;
  if (page === "traces") return <TracesLegacyView />;
  if (page === "users") return <UsersLegacyView accounts={snapshot.accounts} />;
  if (page === "zones") return <ZonesLegacyView snapshot={snapshot} />;
  if (page === "authorizationRequests") return <AuthorizationRequestsLegacyView snapshot={snapshot} />;
  if (page === "generalConfig") {
    const tabs = ["General", "Clientes", "Cargos y Descargos", "Cobros y Pagos", "Interfaz", "GPS"];
    const tmServiceOptions = ["No definido", "Serv", "Serv. pago de tarifa electrica", "Serv. ventas de recargas", "Serv. de Transporte Terrestre", "Remesas del Exterior", "Donaciones de Dinero", "Venta de medicina natural", "MANEJO DE MAQUINITAS", "PRESTAMOS PERSONALES", "TELEFONOS INTELIGENTES", "prestamos empresariales", "Bicicleta", "Alambre THHN 10 BLANCO"];
    const CheckLine = ({ label, checked, disabled = false, onChange }: Readonly<{ label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }>) => <label className={`legacy-check-line ${disabled ? "disabled" : ""}`}><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
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
                  <option>No definido</option>
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
                <label>Servicio para TM:<select {...fld("cargos.servicioTm")}>{tmServiceOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
                <label>Concepto para TM:<select {...fld("cargos.conceptoTm")}><option value=""></option></select></label>
              </div>
              <div className="legacy-config-separator">--- Descargos ---</div>
              <CheckLine label="Permitir modificar cantidad en Descargos" checked={Boolean(systemCfg["descargos.modificarCantidad"])} onChange={chk("descargos.modificarCantidad")} />
            </fieldset>
          )}
          {configTab === "Cobros y Pagos" && (
            <fieldset className="legacy-config-fieldset">
              <legend>Cobros y Pagos</legend>
              <div className="legacy-config-two-col payment-rules-layout">
                <div>
                  <CheckLine label="Guardar GPS" checked={Boolean(systemCfg["cobros.guardarGps"])} onChange={chk("cobros.guardarGps")} />
                  <CheckLine label="Permitir Mezclar Servicios en Recibo" checked={Boolean(systemCfg["cobros.mezclarServiciosRecibo"])} onChange={chk("cobros.mezclarServiciosRecibo")} />
                  <CheckLine label="Permitir Cobros Parciales" checked={Boolean(systemCfg["cobros.cobrosParciales"])} onChange={chk("cobros.cobrosParciales")} />
                  <CheckLine label="Permitir Cobro con Saldo Pendiente (Para Cob.)" checked={Boolean(systemCfg["cobros.cobroSaldoPendiente"])} onChange={chk("cobros.cobroSaldoPendiente")} />
                  <CheckLine label="Obligar a Cobrar Clientes con Saldo Vencido (Para Clientes)" checked={Boolean(systemCfg["cobros.obligarVencidos"])} onChange={chk("cobros.obligarVencidos")} />
                </div>
                <label className="cdc-percent-field">Porciento Mín. para chequeo de CDC:<input type="number" {...fld("cobros.porcientoCdc")} /></label>
              </div>
              <div className="legacy-config-separator">--- Impresión ---</div>
              <fieldset className="legacy-inner-fieldset print-fieldset">
                <div className="legacy-inner-tabs" role="tablist" aria-label="Impresión">
                  <button type="button" className={printTab === "Listados" ? "active" : ""} onClick={() => setPrintTab("Listados")}>Listados</button>
                  <button type="button" className={printTab === "Recibos" ? "active" : ""} onClick={() => setPrintTab("Recibos")}>Recibos</button>
                </div>
                {printTab === "Listados" && (
                  <div className="print-tab-panel">
                    <CheckLine label="Imprimir Listado en HTML" checked={Boolean(systemCfg["impresion.listadoHtml"])} onChange={chk("impresion.listadoHtml")} />
                    <CheckLine label="Imprimir Listado en Impresora Matriz" checked={Boolean(systemCfg["impresion.listadoMatriz"])} onChange={chk("impresion.listadoMatriz")} />
                    <CheckLine label="Imprimir Listado en Impresora Virtual" checked={Boolean(systemCfg["impresion.listadoVirtual"])} onChange={chk("impresion.listadoVirtual")} />
                    <div className="legacy-config-row url-port-row">
                      <label>URL:<input {...fld("impresion.listadoUrl")} /></label>
                      <label>Puerto:<input {...fld("impresion.listadoPuerto")} /></label>
                    </div>
                    <label>Nombre:<input {...fld("impresion.listadoNombre")} /></label>
                  </div>
                )}
                {printTab === "Recibos" && (
                  <div className="print-tab-panel">
                    <CheckLine label="Usar la misma Impresora de los Listados" checked={Boolean(systemCfg["impresion.mismaImpresora"])} onChange={chk("impresion.mismaImpresora")} />
                    <CheckLine label="Imprimir Recibo en HTML" checked={Boolean(systemCfg["impresion.reciboHtml"])} onChange={chk("impresion.reciboHtml")} />
                    <CheckLine label="Imprimir Recibo en Impresora de Matriz" checked={Boolean(systemCfg["impresion.reciboMatriz"])} onChange={chk("impresion.reciboMatriz")} />
                    <CheckLine label="Imprimir Recibo en Impresora Virtual" checked={Boolean(systemCfg["impresion.reciboVirtual"])} onChange={chk("impresion.reciboVirtual")} />
                    <div className="legacy-config-row url-port-row">
                      <label>URL:<input {...fld("impresion.url")} /></label>
                      <label>Puerto:<input {...fld("impresion.puerto")} /></label>
                    </div>
                    <label>Nombre:<input {...fld("impresion.nombre")} /></label>
                  </div>
                )}
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
}: Readonly<{
  onLogin: (user: User, station: Station) => void;
}>) {
  const [email, setEmail] = useState("admin@cyp.local"),
    [password, setPassword] = useState("Demo-CyP-2026!"),
    [busy, setBusy] = useState(false),
    [blockedCollector, setBlockedCollector] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => {
        if (active && h?.mode && h.mode !== "demo") {
          setEmail("");
          setPassword("");
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
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
  const highestZIndex = useRef(140);
  const nextZIndex = useCallback(() => {
    highestZIndex.current += 1;
    return highestZIndex.current;
  }, []);
  const logout = useCallback(() => {
    clearToken();
    setAuthenticated(false);
    setSnapshot(null);
    setUser(null);
    setAccountOpen(false);
    setMdiWindows([]);
    highestZIndex.current = 140;
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
      const zIndex = nextZIndex();
      if (existing) return focusWindowCollection(windows, existing.id, zIndex);

      const offset = windows.length * 26;
      const compact = next === "controlPanel";
      const { width, height } = mdiWindowSize(next);
      return [
        ...windows.map((item) => ({ ...item, isFocused: false })),
        {
          id: `${next}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
          page: next,
          title: mdiTitle(next),
          x: compact ? 180 : 118 + offset,
          y: compact ? 78 : 78 + offset,
          width,
          height,
          zIndex,
          isFocused: true,
        },
      ];
    });
  }, [nextZIndex]);
  const focusMdiWindow = useCallback((id: string) => {
    setMdiWindows((windows) => focusWindowCollection(windows, id, nextZIndex()));
  }, [nextZIndex]);
  const moveMdiWindow = useCallback((id: string, x: number, y: number) => {
    setMdiWindows((windows) => windows.map((item) => item.id === id ? { ...item, x, y } : item));
  }, []);
  const closeMdiWindow = useCallback((id: string) => {
    setMdiWindows((windows) => windows.filter((item) => item.id !== id));
  }, []);
  const createOperationForPage = useCallback((targetPage: Page): Operation => ({
    type: operationTypeForPage(targetPage),
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
              <div className="topbar-system" aria-label="Telemetría del sistema legacy">
                <span>Versión: CyP Web v0.1.0</span>
                <span>
                  Fecha/Hora del Servidor: {clock.toLocaleDateString("es-DO", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}{" "}
                  {clock.toLocaleTimeString("es-DO", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <div className="topbar-main">
                <div className="operational-context">
                  <button
                    className="icon-button mobile-menu-button"
                    aria-label="Abrir navegación"
                    onClick={() => setMobileMenu(true)}
                  >
                    <Menu size={21} />
                  </button>
                  <span className="station-badge compact-station" title={station.name}>
                    <strong>{station.code}</strong>
                  </span>
                  <div className="module-context">
                    <span>Módulo activo</span>
                    <strong>{activeNav?.label ?? "Escritorio"}</strong>
                  </div>
                </div>
                <div className="topbar-actions">
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
                <ClientsLegacyView snapshot={snapshot} onRefresh={() => refresh()} />
              ) : windowState.page === "charges" ? (
                <ChargesOperationalView
                  snapshot={snapshot}
                  currentUser={effectiveUser}
                  onRefresh={async () => { await refresh(); }}
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
}: Readonly<{
  page: Page;
  snapshot: Snapshot;
  refreshing: boolean;
  currentUser: User;
  onRefresh: () => void;
  onCollector: (collector: Collector) => void;
  onOperation: (operation: Operation) => void;
  onAccount: (operation: AccountOperation) => void;
}>) {
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
  if (page === "charges")
    return <ChargesOperationalView snapshot={snapshot} currentUser={currentUser} onRefresh={async () => { await onRefresh(); }} />;
  if (page === "recurringCharges")
    return <RecurringChargesOperationalView snapshot={snapshot} currentUser={currentUser} onRefresh={onRefresh} />;
  if (
    [
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
            type: operationTypeForPage(page),
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
}: Readonly<{
  page: Page;
  snapshot: Snapshot;
  currentUser: User;
  onCollector: (collector: Collector) => void;
  onRefresh: () => void;
  onAccount: (operation: AccountOperation) => void;
}>) {
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

type LocalCharge = Charge & { currency: string; concept: string; note: string };
type CargoDialogDraft = {
  clientId: string;
  clientCode: string;
  currency: string;
  service: string;
  concept: string;
  amount: string;
  quantity: string;
  note: string;
};
const CARGO_SERVICES = [
  "No definido",
  "Serv",
  "Serv. pago de tarifa electrica",
  "Serv. ventas de recargas",
  "Serv. de Transporte Terrestre",
  "Remesas del Exterior",
  "Donaciones de Dinero",
  "Venta de medicina natural",
  "MANEJO DE MAQUINITAS",
  "PRESTAMOS PERSONALES",
  "TELEFONOS INTELIGENTES",
  "prestamos empresariales",
  "Bicicleta",
  "Alambre THHN 10 BLANCO",
];
const asLocalCharge = (charge: Charge): LocalCharge => ({
  ...charge,
  currency: charge.currency ?? "Peso Dominicano",
  concept: charge.concept ?? "",
  note: charge.note ?? "",
});

function CargoDialog({
  charge,
  clients,
  businessDate,
  onClose,
  onSave,
  onLoadClients,
}: Readonly<{
  charge?: LocalCharge;
  clients: Client[];
  businessDate: string;
  onClose: () => void;
  onSave: (charge: LocalCharge) => Promise<boolean>;
  onLoadClients: () => Promise<Client[]>;
}>) {
  const initialClient = clients.find((client) => client.id === charge?.clientId);
  const [draft, setDraft] = useState<CargoDialogDraft>({
    clientId: initialClient?.id ?? "",
    clientCode: initialClient?.code ?? "",
    currency: charge?.currency ?? "Peso Dominicano",
    service: charge?.service ?? "Serv",
    concept: charge?.concept ?? "",
    amount: charge ? (charge.amount / 100).toFixed(2) : "0.00",
    quantity: "1.00",
    note: charge?.note ?? "",
  });
  const [searchClients, setSearchClients] = useState<Client[]>(clients);
  const [searchOpen, setSearchOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const selectedClient = searchClients.find((client) => client.id === draft.clientId);
  const amount = Number(draft.amount || 0);
  const quantity = Number(draft.quantity || 0);
  const total = Number.isFinite(amount * quantity) ? amount * quantity : 0;
  const update = (field: keyof CargoDialogDraft, value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));
  const updateClientCode = (value: string) => {
    const match = searchClients.find((client) => client.code.trim().toLowerCase() === value.trim().toLowerCase());
    setDraft((current) => ({ ...current, clientCode: value, clientId: match?.id ?? "" }));
  };
  const openClientSearch = async () => {
    try {
      setSearchClients(await onLoadClients());
      setSearchOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo consultar el catálogo de clientes.");
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.clientId || !selectedClient) {
      setErrorMessage('El campo "Cliente" no puede estar vacío');
      return;
    }
    if (!Number.isFinite(total) || total <= 0) {
      setErrorMessage("El importe total debe ser mayor a cero.");
      return;
    }
    setSaving(true);
    try {
      const saved = await onSave({
        id: charge?.id ?? "",
        clientId: selectedClient.id,
        service: draft.service,
        concept: draft.concept.trim(),
        currency: draft.currency,
        note: draft.note.trim(),
        amount: Math.round(total * 100),
        collected: charge?.collected ?? 0,
        dueDate: charge?.dueDate ?? businessDate,
        required: charge?.required ?? false,
        status: charge?.status ?? "pending",
      });
      if (saved) onClose();
    } finally {
      setSaving(false);
    }
  };
  const availableServices = charge && !CARGO_SERVICES.includes(charge.service)
    ? [charge.service, ...CARGO_SERVICES]
    : CARGO_SERVICES;
  return (
    <>
      <LegacyDialog title="Datos del Cargo..." onClose={onClose} className="charge-data-dialog">
        <form className="cargo-entry-form" onSubmit={(event) => void submit(event)}>
          <div className="cargo-entry-row cargo-client-row">
            <label htmlFor="cargo-client-code">Cliente:</label>
            <input id="cargo-client-code" autoFocus value={draft.clientCode} onChange={(event) => updateClientCode(event.target.value)} />
            <input aria-label="Nombre del cliente" value={selectedClient?.name ?? ""} disabled readOnly />
            <button type="button" aria-label="Buscar cliente" onClick={() => void openClientSearch()}>[...]</button>
          </div>
          <div className="cargo-entry-row">
            <label htmlFor="cargo-currency">Moneda:</label>
            <select id="cargo-currency" value={draft.currency} onChange={(event) => update("currency", event.target.value)}>
              <option>No definida</option><option>Peso Dominicano</option><option>Dólar Americano</option><option>Euro</option>
            </select>
          </div>
          <div className="cargo-entry-row">
            <label htmlFor="cargo-service">Servicio:</label>
            <select id="cargo-service" value={draft.service} onChange={(event) => update("service", event.target.value)}>
              {availableServices.map((service) => <option key={service}>{service}</option>)}
            </select>
          </div>
          <div className="cargo-entry-row">
            <label htmlFor="cargo-concept">Concepto:</label>
            <input id="cargo-concept" value={draft.concept} onChange={(event) => update("concept", event.target.value)} />
          </div>
          <div className="cargo-entry-row cargo-amount-row">
            <label htmlFor="cargo-amount">Importe:</label>
            <label>Monto<input id="cargo-amount" type="number" min="0" step="0.01" value={draft.amount} onChange={(event) => update("amount", event.target.value)} /></label>
            <label>Tasa/Cantidad<input type="number" min="0.01" step="0.01" value={draft.quantity} onChange={(event) => update("quantity", event.target.value)} /></label>
            <label>Total<input type="number" value={total.toFixed(2)} disabled readOnly /></label>
          </div>
          <div className="cargo-entry-row">
            <label htmlFor="cargo-note">Nota:</label>
            <input id="cargo-note" value={draft.note} onChange={(event) => update("note", event.target.value)} />
          </div>
          <div className="legacy-dialog-actions centered">
            <button type="submit" disabled={saving}>{saving ? "Guardando…" : "oK"}</button>
            <button type="button" onClick={onClose}>Cancelar</button>
          </div>
        </form>
      </LegacyDialog>
      {searchOpen && <ClientSearchSubmodal clients={searchClients} onClose={() => setSearchOpen(false)} onSelect={(client) => { setDraft((current) => ({ ...current, clientId: client.id, clientCode: client.code })); setSearchOpen(false); }} />}
      {errorMessage && <LegacyAlertDialog message={errorMessage} onClose={() => setErrorMessage("")} />}
    </>
  );
}

function CargoUploadDialog({ onClose, onUpload }: Readonly<{ onClose: () => void; onUpload: (file: File) => Promise<boolean> }>) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [errorOpen, setErrorOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [checkingFile, setCheckingFile] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) {
      setCheckingFile(true);
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      setCheckingFile(false);
      setErrorOpen(true);
      return;
    }
    setUploading(true);
    try { if (await onUpload(file)) onClose(); } finally { setUploading(false); }
  };
  return (
    <>
      <LegacyDialog title="Subir" onClose={onClose} className="cargo-upload-dialog">
        <form className="cargo-upload-form" onSubmit={(event) => void submit(event)}>
          <input ref={fileInput} className="sr-only" type="file" accept=".csv,text/csv,text/plain" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <button type="button" onClick={() => fileInput.current?.click()}>Elegir archivo</button>
          <span className="cargo-upload-filename">{file?.name ?? "No se ha seleccionado ningun archivo"}</span>
          <div className="legacy-dialog-actions centered"><button type="submit" disabled={uploading || checkingFile}>{checkingFile ? "Validando…" : uploading ? "Subiendo…" : "Subir"}</button><button type="button" onClick={onClose}>Cancelar</button></div>
        </form>
      </LegacyDialog>
      {errorOpen && <LegacyAlertDialog title="Upload Error" message="Seleccione el archivo" onClose={() => setErrorOpen(false)} />}
    </>
  );
}

function ChargeCancelReasonDialog({ onClose, onConfirm, busy }: Readonly<{ onClose: () => void; onConfirm: (reason: string) => Promise<void>; busy: boolean }>) {
  const [reason, setReason] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onConfirm(reason.trim());
  };
  return (
    <LegacyDialog title="Entre un valor..." onClose={onClose} className="charge-cancel-reason-dialog">
      <form className="legacy-dialog-form" onSubmit={submit}>
        <label className="charge-cancel-reason-field">Valor:<input autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Digitado por error" maxLength={500} /></label>
        <div className="legacy-dialog-actions centered"><button type="submit" disabled={busy}>{busy ? "Guardando…" : "oK"}</button><button type="button" disabled={busy} onClick={onClose}>Cancelar</button></div>
      </form>
    </LegacyDialog>
  );
}

function ChargesOperationalView({ snapshot, currentUser, onRefresh }: Readonly<{ snapshot: Snapshot; currentUser: User; onRefresh: () => Promise<void> }>) {
  const [charges, setCharges] = useState<LocalCharge[]>(() => snapshot.charges.map(asLocalCharge));
  const [mode, setMode] = useState("Todos");
  const [clientQuery, setClientQuery] = useState("");
  const [zone, setZone] = useState("Todas");
  const [routeId, setRouteId] = useState("Todas");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [status, setStatus] = useState("Activo");
  const [relation, setRelation] = useState("Todas");
  const [selectedCharge, setSelectedCharge] = useState<LocalCharge | null>(null);
  const [filtersVisible, setFiltersVisible] = useState(true);
  const [dialogMode, setDialogMode] = useState<"new" | "edit" | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [cancelReasonOpen, setCancelReasonOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [alertMessage, setAlertMessage] = useState("");
  const [clientSearchOpen, setClientSearchOpen] = useState(false);
  const [clientDirectory, setClientDirectory] = useState<Client[]>(snapshot.clients);
  const permissions = permissionsFor(currentUser);
  const zones = Array.from(new Set(snapshot.routes.map((route) => route.sector).filter(Boolean)));
  useEffect(() => {
    const refreshedCharges = snapshot.charges.map(asLocalCharge);
    setCharges(refreshedCharges);
    setSelectedCharge((selected) => selected ? refreshedCharges.find((charge) => charge.id === selected.id) ?? null : null);
  }, [snapshot.charges]);
  const selectedId = selectedCharge?.id ?? "";
  const clientById = (id: string) => snapshot.clients.find((client) => client.id === id);
  const visibleCharges = charges.filter((charge) => {
    const client = clientById(charge.clientId);
    const route = snapshot.routes.find((item) => item.id === client?.routeId);
    const matchesMode = mode === "Todos"
      || (mode === "por Cliente" && `${client?.code ?? ""} ${client?.identification ?? ""} ${client?.name ?? ""}`.toLowerCase().includes(clientQuery.trim().toLowerCase()))
      || (mode === "Por Zona" && (zone === "Todas" || route?.sector === zone))
      || (mode === "Por Ruta" && (routeId === "Todas" || client?.routeId === routeId));
    const matchesDate = (!fromDate || charge.dueDate >= fromDate) && (!toDate || charge.dueDate <= toDate);
    const matchesStatus = status === "Todos" || (status === "Activo" ? charge.status !== "cancelled" : charge.status === status);
    const matchesRelation = relation === "Todas" || (relation === "Con recibo" ? charge.collected > 0 : charge.collected === 0);
    return matchesMode && matchesDate && matchesStatus && matchesRelation;
  });
  const totals = visibleCharges.reduce((acc, charge) => ({ total: acc.total + charge.amount, received: acc.received + charge.collected }), { total: 0, received: 0 });
  const loadClients = async () => {
    const clients = await api<Client[]>("/clientes");
    setClientDirectory(clients);
    return clients;
  };
  const openFilterClientSearch = async () => {
    try {
      await loadClients();
      setClientSearchOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo consultar el catálogo de clientes.");
    }
  };
  const saveCharge = async (draft: LocalCharge) => {
    const editing = Boolean(selectedCharge && selectedCharge.id === draft.id && dialogMode === "edit");
    const body = {
      clientId: draft.clientId,
      service: draft.service,
      concept: draft.concept,
      currency: draft.currency,
      note: draft.note,
      amount: draft.amount,
      dueDate: draft.dueDate,
      required: draft.required,
    };
    try {
      const saved = await api<Charge>(editing ? `/cargos/${encodeURIComponent(draft.id)}` : "/cargos", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      const local = asLocalCharge(saved);
      setCharges((current) => editing ? current.map((item) => item.id === local.id ? local : item) : [...current, local]);
      setSelectedCharge(local);
      toast.success(editing ? "Cargo actualizado" : "Cargo registrado");
      await onRefresh();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el cargo.");
      return false;
    }
  };
  const moveSelected = (target: "first" | "previous" | "next" | "last") => {
    if (!permissions.canEdit || !selectedId) return;
    setCharges((current) => {
      const index = current.findIndex((charge) => charge.id === selectedId);
      if (index < 0) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      const destination = target === "first" ? 0 : target === "last" ? next.length : target === "previous" ? Math.max(0, index - 1) : Math.min(next.length, index + 1);
      next.splice(destination, 0, item);
      return next;
    });
  };
  const refreshCharges = async () => {
    await onRefresh();
    setMode("Todos"); setClientQuery(""); setZone("Todas"); setRouteId("Todas");
    setFromDate(""); setToDate(""); setStatus("Activo"); setRelation("Todas"); setSelectedCharge(null);
    toast.success("Cargos actualizados");
  };
  const requestCancel = () => {
    if (!selectedCharge) return toast.error("Seleccione un cargo.");
    const pending = Math.max(0, selectedCharge.amount - selectedCharge.collected);
    if (selectedCharge.collected > 0 || pending === 0) {
      setAlertMessage("El cargo ha sido pagado parcial y/o totalmente. No se puede cancelar.");
      return;
    }
    setConfirmCancelOpen(true);
  };
  const cancelSelected = async (reason: string) => {
    if (!selectedCharge) return;
    setCancelling(true);
    try {
      const cancelled = await api<Charge>("/cargos/cancelar", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ id: selectedCharge.id, reason }),
      });
      setCharges((current) => current.map((charge) => charge.id === cancelled.id ? asLocalCharge(cancelled) : charge));
      setSelectedCharge(asLocalCharge(cancelled));
      setCancelReasonOpen(false);
      toast.success("Cargo cancelado");
      await onRefresh();
    } catch (error) {
      setCancelReasonOpen(false);
      setAlertMessage(error instanceof Error ? error.message : "No se pudo cancelar el cargo.");
    } finally {
      setCancelling(false);
    }
  };
  const uploadCharges = async (file: File) => {
    try {
      const parsed = parseImportCsv(await file.text(), "charges");
      const filas = parsed.filas.map((row) => ({ ...row, importe: Math.round(Number(row.importe) * 100) }));
      if (!filas.length) {
        setAlertMessage("El archivo no contiene filas válidas.");
        return false;
      }
      const result = await api<{ creados: number; errores: { fila: number; mensaje: string }[] }>("/cargos/importar", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ filas }),
      });
      toast.success(`Importación: ${result.creados} cargo(s) creado(s), ${result.errores.length} con error.`);
      result.errores.slice(0, 5).forEach((error) => toast.error(`Fila ${error.fila}: ${error.mensaje}`));
      await onRefresh();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo importar el archivo.");
      return false;
    }
  };
  return (
    <div className="charges-view">
      <LegacyToolbar
        filtersVisible={filtersVisible}
        onToggleFilters={() => setFiltersVisible((visible) => !visible)}
        onFirst={() => moveSelected("first")}
        onPrevious={() => moveSelected("previous")}
        onNext={() => moveSelected("next")}
        onLast={() => moveSelected("last")}
        onNew={() => setDialogMode("new")}
        onEdit={() => selectedCharge ? setDialogMode("edit") : toast.error("Seleccione un cargo.")}
        onDelete={requestCancel}
        onRefresh={() => void refreshCharges()}
        disableNew={!permissions.canCreate}
        disableEdit={!selectedCharge || !permissions.canEdit}
        disableDelete={!selectedCharge || !permissions.canDelete}
        extra={<button type="button" title="Subir" disabled={!permissions.canCreate} onClick={() => setUploadOpen(true)}><Upload size={15} /></button>}
      />
      <div className={`charges-layout ${filtersVisible ? "" : "filters-collapsed"}`}>
        {filtersVisible && (
          <aside className="legacy-filter-panel charges-filter-panel" aria-label="Panel de filtros de cargos">
            <h2>Panel de Filtro</h2>
            <div className="charges-filter-options">
              <label className="charges-radio-row"><input type="radio" name="charge-filter-mode" checked={mode === "Todos"} onChange={() => setMode("Todos")} /><span>Todos</span></label>
              <div className="charges-filter-group">
                <label className="charges-radio-row"><input type="radio" name="charge-filter-mode" checked={mode === "por Cliente"} onChange={() => setMode("por Cliente")} /><span>por Cliente:</span></label>
                <div className="legacy-lookup-field charges-filter-control"><input aria-label="Buscar por cliente" value={clientQuery} disabled={mode !== "por Cliente"} onChange={(event) => setClientQuery(event.target.value)} placeholder="Código o identificación" /><button type="button" aria-label="Seleccionar cliente" disabled={mode !== "por Cliente"} onClick={() => void openFilterClientSearch()}>[...]</button></div>
              </div>
              <div className="charges-filter-group">
                <label className="charges-radio-row"><input type="radio" name="charge-filter-mode" checked={mode === "Por Zona"} onChange={() => setMode("Por Zona")} /><span>Por Zona:</span></label>
                <select className="charges-filter-control" aria-label="Zona" value={zone} disabled={mode !== "Por Zona"} onChange={(event) => setZone(event.target.value)}><option>Todas</option>{zones.map((item) => <option key={item}>{item}</option>)}</select>
              </div>
              <div className="charges-filter-group">
                <label className="charges-radio-row"><input type="radio" name="charge-filter-mode" checked={mode === "Por Ruta"} onChange={() => setMode("Por Ruta")} /><span>Por Ruta:</span></label>
                <select className="charges-filter-control" aria-label="Ruta" value={routeId} disabled={mode !== "Por Ruta"} onChange={(event) => setRouteId(event.target.value)}><option>Todas</option>{snapshot.routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}</select>
              </div>
            </div>
            <label className="field compact-field">Fecha Inicial:<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
            <label className="field compact-field">Fecha final:<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
            <label className="field compact-field">Estado:<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="Activo">Activo</option><option value="Todos">Todos</option><option value="pending">Pendiente</option><option value="partial">Parcial</option><option value="paid">Pagado</option><option value="cancelled">Cancelado</option></select></label>
            <label className="field compact-field">Relación de Pago:<select value={relation} onChange={(event) => setRelation(event.target.value)}><option>Todas</option><option>Con recibo</option><option>Sin recibo</option></select></label>
          </aside>
        )}
        <section className="legacy-grid-panel charges-grid-panel" aria-label="Grilla de cargos">
          <div className="legacy-mdi-table-wrap">
            <table className="legacy-mdi-table charges-table">
              <thead><tr><th>Nro.</th><th>Fecha</th><th>Cód.</th><th>Identif.</th><th>Cliente</th><th>Abrev</th><th>Servicio</th><th>Importe</th><th>Recibido</th><th>Pendiente</th><th>Act.</th></tr></thead>
              <tbody>
                {visibleCharges.map((charge, index) => {
                  const client = clientById(charge.clientId);
                  const pending = Math.max(0, charge.amount - charge.collected);
                  const isSelected = selectedCharge?.id === charge.id;
                  return <tr key={charge.id} className={isSelected ? "selected-row" : undefined} aria-selected={isSelected} role="button" tabIndex={0} onPointerDown={() => setSelectedCharge(charge)} onClick={() => setSelectedCharge(charge)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedCharge(charge))}>
                    <td>{index + 1}</td><td>{safeDateLabel(charge.dueDate)}</td><td>{client?.code ?? ""}</td><td>{client?.identification || client?.id || ""}</td><td>{client?.name ?? "Cliente sin nombre"}</td><td>{abbreviation(charge.service)}</td><td>{charge.service}</td><td>{money(charge.amount)}</td><td>{money(charge.collected)}</td><td>{money(pending)}</td><td><LegacyCheck checked={charge.status !== "cancelled"} /></td>
                  </tr>;
                })}
              </tbody>
            </table>
            {!visibleCharges.length && <Empty title="Sin cargos" text="Ajusta los filtros o registra un nuevo cargo." />}
          </div>
          <div className="legacy-footerbar"><span>Cantidad: <strong>{visibleCharges.length}</strong></span><span>Total: <strong>{money(totals.total)}</strong></span><span>Recib.: <strong>{money(totals.received)}</strong></span><span>Pend.: <strong>{money(totals.total - totals.received)}</strong></span></div>
        </section>
      </div>
      {dialogMode && <CargoDialog charge={dialogMode === "edit" ? selectedCharge ?? undefined : undefined} clients={snapshot.clients} businessDate={snapshot.businessDate} onClose={() => setDialogMode(null)} onSave={saveCharge} onLoadClients={loadClients} />}
      {uploadOpen && <CargoUploadDialog onClose={() => setUploadOpen(false)} onUpload={uploadCharges} />}
      {clientSearchOpen && <ClientSearchSubmodal clients={clientDirectory} onClose={() => setClientSearchOpen(false)} onSelect={(client) => { setClientQuery(client.code); setClientSearchOpen(false); }} />}
      {confirmCancelOpen && <LegacyConfirmDialog message="¿Está seguro que desea cancelar el Cargo?" onYes={() => { setConfirmCancelOpen(false); setCancelReasonOpen(true); }} onNo={() => setConfirmCancelOpen(false)} />}
      {cancelReasonOpen && <ChargeCancelReasonDialog onClose={() => setCancelReasonOpen(false)} onConfirm={cancelSelected} busy={cancelling} />}
      {alertMessage && <LegacyAlertDialog message={alertMessage} onClose={() => setAlertMessage("")} />}
    </div>
  );
}

type RecurringChargeRecord = {
  id: string;
  clientId: string;
  startDate: string;
  endDate: string;
  frequency: string;
  day1: string;
  day2: string;
  currency: string;
  service: string;
  concept: string;
  useConceptAmount: boolean;
  amount: number;
  note: string;
  active: boolean;
};

const RECURRING_CHARGES_STORAGE_KEY = "cyp-admin-recurring-charges-v1";
const RECURRING_FREQUENCIES = [
  "No Definida",
  "Diaria",
  "Bidiaria",
  "Semanal",
  "Quincenal",
  "Mensual",
  "Trimestral",
  "Cuatrimestral",
  "Semestral",
  "Anual",
];
const CURRENCIES = ["No definida", "Peso Dominicano", "Dólar Americano", "Euro"];

function seedRecurringCharges(snapshot: Snapshot): RecurringChargeRecord[] {
  return snapshot.charges
    .filter((charge) => charge.required)
    .map((charge) => ({
      id: charge.id,
      clientId: charge.clientId,
      startDate: charge.dueDate,
      endDate: "",
      frequency: "Mensual",
      day1: charge.dueDate.slice(8, 10) || "1",
      day2: "",
      currency: charge.currency ?? "Peso Dominicano",
      service: charge.service,
      concept: charge.concept ?? charge.service,
      useConceptAmount: false,
      amount: charge.amount,
      note: charge.note ?? "",
      active: charge.status !== "cancelled",
    }));
}

function loadRecurringCharges(snapshot: Snapshot): RecurringChargeRecord[] {
  if (typeof window !== "undefined") {
    try {
      const saved = window.localStorage.getItem(RECURRING_CHARGES_STORAGE_KEY);
      if (saved !== null) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter((item): item is RecurringChargeRecord =>
            Boolean(item && typeof item.id === "string" && typeof item.clientId === "string" && typeof item.startDate === "string"),
          );
        }
      }
    } catch {
      // If browser storage is unavailable or malformed, show the snapshot-backed demo rows.
    }
  }
  return seedRecurringCharges(snapshot);
}

function localSystemDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function RecurringChargeDialog({
  row,
  clients,
  onClose,
  onSave,
}: Readonly<{
  row: RecurringChargeRecord | null;
  clients: Snapshot["clients"];
  onClose: () => void;
  onSave: (record: RecurringChargeRecord) => void;
}>) {
  const [clientId, setClientId] = useState(row?.clientId ?? "");
  const [clientCode, setClientCode] = useState(() => clients.find((client) => client.id === row?.clientId)?.code ?? "");
  const [startDate, setStartDate] = useState(row?.startDate ?? localSystemDate());
  const [endDate, setEndDate] = useState(row?.endDate ?? "");
  const [frequency, setFrequency] = useState(row?.frequency ?? "No Definida");
  const [day1, setDay1] = useState(row?.day1 ?? "");
  const [day2, setDay2] = useState(row?.day2 ?? "");
  const [currency, setCurrency] = useState(row?.currency ?? "No definida");
  const [service, setService] = useState(row?.service ?? CARGO_SERVICES[0]);
  const [concept, setConcept] = useState(row?.concept ?? "");
  const [useConceptAmount, setUseConceptAmount] = useState(row?.useConceptAmount ?? true);
  const [amount, setAmount] = useState(String(row?.amount ?? 0));
  const [note, setNote] = useState(row?.note ?? "");
  const [clientSearchOpen, setClientSearchOpen] = useState(false);
  const [validationMessage, setValidationMessage] = useState("");
  const matchedClient = clients.find((client) => client.id === clientId || client.code.toLowerCase() === clientCode.trim().toLowerCase());
  const updateClientCode = (value: string) => {
    setClientCode(value);
    const match = clients.find((client) => client.code.toLowerCase() === value.trim().toLowerCase());
    setClientId(match?.id ?? "");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const client = clients.find((item) => item.id === clientId) ?? clients.find((item) => item.code.toLowerCase() === clientCode.trim().toLowerCase());
    if (!client) {
      setValidationMessage('El campo "Cliente" no puede estar vacío.');
      return;
    }
    const today = localSystemDate();
    if (!startDate) {
      setValidationMessage('El campo "F. Inicial" no puede estar vacío.');
      return;
    }
    if (row && startDate <= today) {
      setValidationMessage(`El campo "F. Inicial" debe tener un valor mayor que: ${today} 00:00:00`);
      return;
    }
    onSave({
      id: row?.id ?? crypto.randomUUID(),
      clientId: client.id,
      startDate,
      endDate,
      frequency,
      day1,
      day2,
      currency,
      service,
      concept: concept.trim(),
      useConceptAmount,
      amount: Math.max(0, Number(amount) || 0),
      note: note.trim(),
      active: row?.active ?? true,
    });
  };
  return (
    <LegacyDialog title="Datos del Cargo Recurrente..." onClose={onClose} className="recurring-charge-dialog">
      <form className="recurring-charge-form" onSubmit={submit}>
        <div className="recurring-charge-row recurring-charge-client-row">
          <label htmlFor="recurring-charge-client-code">Cliente:</label>
          <input id="recurring-charge-client-code" value={clientCode} onChange={(event) => updateClientCode(event.target.value)} aria-label="Código de cliente" />
          <input value={matchedClient?.name ?? ""} readOnly aria-label="Nombre del cliente" placeholder="Seleccione un cliente" />
          <button type="button" onClick={() => setClientSearchOpen(true)} aria-label="Buscar cliente">[...]</button>
        </div>
        <div className="recurring-charge-row recurring-charge-date-row">
          <label htmlFor="recurring-charge-start">F. Inicial:</label>
          <input id="recurring-charge-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          <label htmlFor="recurring-charge-end">F. final:</label>
          <input id="recurring-charge-end" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </div>
        <div className="recurring-charge-row recurring-charge-frequency-row">
          <label htmlFor="recurring-charge-frequency">Frecuencia:</label>
          <select id="recurring-charge-frequency" value={frequency} onChange={(event) => setFrequency(event.target.value)}>
            {RECURRING_FREQUENCIES.map((item) => <option key={item}>{item}</option>)}
          </select>
          <label htmlFor="recurring-charge-day1">Dia1:</label>
          <input id="recurring-charge-day1" className="recurring-charge-day" type="number" min="1" max="31" value={day1} onChange={(event) => setDay1(event.target.value)} />
          <label htmlFor="recurring-charge-day2">Dia2:</label>
          <input id="recurring-charge-day2" className="recurring-charge-day" type="number" min="1" max="31" value={day2} onChange={(event) => setDay2(event.target.value)} />
        </div>
        <label className="recurring-charge-row recurring-charge-labeled-row" htmlFor="recurring-charge-currency">
          <span>Moneda:</span>
          <select id="recurring-charge-currency" value={currency} onChange={(event) => setCurrency(event.target.value)}>{CURRENCIES.map((item) => <option key={item}>{item}</option>)}</select>
        </label>
        <label className="recurring-charge-row recurring-charge-labeled-row" htmlFor="recurring-charge-service">
          <span>Servicio:</span>
          <select id="recurring-charge-service" value={service} onChange={(event) => setService(event.target.value)}>{CARGO_SERVICES.map((item) => <option key={item}>{item}</option>)}</select>
        </label>
        <label className="recurring-charge-row recurring-charge-labeled-row" htmlFor="recurring-charge-concept">
          <span>Concepto:</span>
          <input id="recurring-charge-concept" list="recurring-charge-concepts" value={concept} onChange={(event) => setConcept(event.target.value)} />
          <datalist id="recurring-charge-concepts">{CARGO_SERVICES.map((item) => <option key={item} value={item} />)}</datalist>
        </label>
        <label className="recurring-charge-checkbox"><input type="checkbox" checked={useConceptAmount} onChange={(event) => setUseConceptAmount(event.target.checked)} />Usar Importe de Concepto</label>
        <label className="recurring-charge-row recurring-charge-labeled-row" htmlFor="recurring-charge-amount">
          <span>Importe:</span>
          <input id="recurring-charge-amount" type="number" min="0" step="0.01" value={amount} disabled={useConceptAmount} onChange={(event) => setAmount(event.target.value)} />
        </label>
        <label className="recurring-charge-row recurring-charge-labeled-row" htmlFor="recurring-charge-note">
          <span>Nota:</span>
          <input id="recurring-charge-note" value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <div className="legacy-dialog-actions centered"><button type="submit">oK</button><button type="button" onClick={onClose}>Cancelar</button></div>
      </form>
      {clientSearchOpen && <ClientSearchSubmodal clients={clients} onClose={() => setClientSearchOpen(false)} onSelect={(client) => { setClientId(client.id); setClientCode(client.code); setClientSearchOpen(false); }} />}
      {validationMessage && <LegacyAlertDialog message={validationMessage} onClose={() => setValidationMessage("")} />}
    </LegacyDialog>
  );
}

function RecurringChargesOperationalView({ snapshot, currentUser, onRefresh }: Readonly<{ snapshot: Snapshot; currentUser: User; onRefresh: () => void }>) {
  const [records, setRecords] = useState<RecurringChargeRecord[]>(() => loadRecurringCharges(snapshot));
  const [filterMode, setFilterMode] = useState<"Todos" | "por Cliente">("Todos");
  const [clientQuery, setClientQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [status, setStatus] = useState("Activo");
  const [selectedRow, setSelectedRow] = useState<RecurringChargeRecord | null>(null);
  const [filtersVisible, setFiltersVisible] = useState(true);
  const [clientSearchOpen, setClientSearchOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"new" | "edit" | null>(null);
  const [confirmInactivate, setConfirmInactivate] = useState(false);
  const permissions = permissionsFor(currentUser);
  useEffect(() => {
    const reloaded = loadRecurringCharges(snapshot);
    setRecords(reloaded);
    setSelectedRow((selected) => selected ? reloaded.find((item) => item.id === selected.id) ?? null : null);
  }, [snapshot.charges]);
  const clientById = (id: string) => snapshot.clients.find((client) => client.id === id);
  const visibleRecords = records.filter((record) => {
    const client = clientById(record.clientId);
    const haystack = `${client?.code ?? ""} ${client?.identification ?? ""} ${client?.name ?? ""}`.toLowerCase();
    const matchesClient = filterMode === "Todos" || !clientQuery.trim() || haystack.includes(clientQuery.trim().toLowerCase());
    const matchesStart = (!fromDate || record.startDate >= fromDate) && (!toDate || record.startDate <= toDate);
    const matchesStatus = status === "Todos" || (status === "Activo" ? record.active : !record.active);
    return matchesClient && matchesStart && matchesStatus;
  });
  const persist = (next: RecurringChargeRecord[]) => {
    setRecords(next);
    try {
      window.localStorage.setItem(RECURRING_CHARGES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      toast.error("No se pudo persistir el catálogo local de cargos recurrentes.");
    }
  };
  const moveSelected = (target: "first" | "previous" | "next" | "last") => {
    if (!selectedRow || !permissions.canEdit) return;
    const currentIndex = records.findIndex((item) => item.id === selectedRow.id);
    if (currentIndex < 0) return;
    const next = [...records];
    const [item] = next.splice(currentIndex, 1);
    const destination = target === "first" ? 0 : target === "last" ? next.length : target === "previous" ? Math.max(0, currentIndex - 1) : Math.min(next.length, currentIndex + 1);
    next.splice(destination, 0, item);
    persist(next);
  };
  const refresh = () => {
    onRefresh();
    const reloaded = loadRecurringCharges(snapshot);
    setRecords(reloaded);
    setSelectedRow(null);
    setFilterMode("Todos");
    setClientQuery("");
    setFromDate("");
    setToDate("");
    setStatus("Activo");
  };
  const saveRecord = (record: RecurringChargeRecord) => {
    const editing = records.some((item) => item.id === record.id);
    const next = editing ? records.map((item) => item.id === record.id ? record : item) : [...records, record];
    persist(next);
    setSelectedRow(record);
    setDialogMode(null);
    toast.success(editing ? "Cargo recurrente actualizado" : "Cargo recurrente registrado");
  };
  const inactivateSelected = () => {
    if (!selectedRow) return;
    const next = records.map((item) => item.id === selectedRow.id ? { ...item, active: false } : item);
    persist(next);
    setSelectedRow(null);
    setConfirmInactivate(false);
    toast.success("Cargo recurrente inactivado");
  };
  return (
    <div className="charges-view recurring-charges-view flex h-full flex-col bg-[#f0f0f0]">
      <LegacyToolbar
        filtersVisible={filtersVisible}
        onToggleFilters={() => setFiltersVisible((visible) => !visible)}
        onFirst={() => moveSelected("first")}
        onPrevious={() => moveSelected("previous")}
        onNext={() => moveSelected("next")}
        onLast={() => moveSelected("last")}
        onNew={() => setDialogMode("new")}
        onEdit={() => selectedRow ? setDialogMode("edit") : toast.error("Seleccione un cargo recurrente.")}
        onDelete={() => selectedRow ? setConfirmInactivate(true) : toast.error("Seleccione un cargo recurrente.")}
        onRefresh={refresh}
        disableNew={!permissions.canCreate}
        disableEdit={!selectedRow || !permissions.canEdit}
        disableDelete={!selectedRow || !permissions.canDelete}
      />
      <div className="charges-layout recurring-charges-legacy-layout flex flex-1 overflow-hidden border-t border-gray-300">
        {filtersVisible && <aside className="legacy-filter-panel charges-filter-panel recurring-charge-filter-panel w-[220px] flex-shrink-0 bg-[#e8e8e0] border-r border-gray-400 p-2 flex flex-col gap-3 overflow-y-auto text-sm" aria-label="Panel de filtro de cargos recurrentes">
          <label className="recurring-legacy-radio flex items-center gap-1 whitespace-nowrap">
            <input type="radio" name="recurring-charge-filter-mode" value="todos" checked={filterMode === "Todos"} onChange={() => setFilterMode("Todos")} /> Todos
          </label>

          <div className="flex flex-col gap-1">
            <label className="recurring-legacy-radio flex items-center gap-1 whitespace-nowrap">
              <input type="radio" name="recurring-charge-filter-mode" value="porCliente" checked={filterMode === "por Cliente"} onChange={() => setFilterMode("por Cliente")} /> por Cliente:
            </label>
            <div className="flex gap-1 pl-4">
              <input aria-label="Filtrar por cliente" type="text" className="min-w-0 w-full border p-1" value={clientQuery} disabled={filterMode !== "por Cliente"} onChange={(event) => setClientQuery(event.target.value)} />
              <button type="button" className="border px-2 bg-gray-200" aria-label="Seleccionar cliente" disabled={filterMode !== "por Cliente"} onClick={() => setClientSearchOpen(true)}>...</button>
            </div>
          </div>

          <div className="flex flex-col gap-1 mt-2">
            <label htmlFor="recurring-start-date">Fecha Inicial:</label>
            <input id="recurring-start-date" type="date" className="border p-1" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </div>

          <div className="flex flex-col gap-1 mt-2">
            <label htmlFor="recurring-end-date">Fecha final:</label>
            <input id="recurring-end-date" type="date" className="border p-1" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </div>

          <div className="flex flex-col gap-1 mt-2">
            <label htmlFor="recurring-status">Estado:</label>
            <select id="recurring-status" className="border p-1" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="Activo">Activo</option>
              <option value="Todos">Todos</option>
              <option value="Inactivo">Inactivo</option>
            </select>
          </div>
        </aside>}

        <div className="flex-1 overflow-auto bg-white" aria-label="Grilla de cargos recurrentes">
          <table className="w-full text-sm border-collapse recurring-charges-table">
            <thead className="bg-gray-100 border-b border-gray-300">
              <tr>
                <th className="border-r border-gray-300 p-1 font-normal text-left">Nro.</th>
                <th className="border-r border-gray-300 p-1 font-normal text-left">Fecha</th>
                <th className="border-r border-gray-300 p-1 font-normal text-left">Frecuencia</th>
                <th className="border-r border-gray-300 p-1 font-normal text-left">Identif.</th>
                <th className="border-r border-gray-300 p-1 font-normal text-left">Cliente</th>
                <th className="border-r border-gray-300 p-1 font-normal text-left">Servicio</th>
              </tr>
            </thead>
            <tbody>{visibleRecords.length ? visibleRecords.map((record, index) => {
              const client = clientById(record.clientId);
              const isSelected = selectedRow?.id === record.id;
              return <tr key={record.id} className={isSelected ? "selected-row" : undefined} aria-selected={isSelected} role="button" tabIndex={0} onClick={() => setSelectedRow(record)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedRow(record))}>
                <td>{index + 1}</td><td>{safeDateLabel(record.startDate)}</td><td>{record.frequency}</td><td>{client?.identification || client?.code || ""}</td><td>{client?.name ?? "Cliente sin nombre"}</td><td>{record.service}</td>
              </tr>;
            }) : <tr><td className="recurring-charges-empty-cell" colSpan={6}>Sin cargos recurrentes.</td></tr>}</tbody>
          </table>
        </div>
      </div>
      {clientSearchOpen && <ClientSearchSubmodal clients={snapshot.clients} onClose={() => setClientSearchOpen(false)} onSelect={(client) => { setClientQuery(client.code); setClientSearchOpen(false); }} />}
      {dialogMode && <RecurringChargeDialog row={dialogMode === "edit" ? selectedRow : null} clients={snapshot.clients} onClose={() => setDialogMode(null)} onSave={saveRecord} />}
      {confirmInactivate && <LegacyConfirmDialog message="¿Inactivar datos?" onYes={inactivateSelected} onNo={() => setConfirmInactivate(false)} />}
    </div>
  );
}

function LegacyOperationView({
  spec,
  snapshot,
  currentUser,
  onCreate,
  onRefresh,
}: Readonly<{
  spec: OperationSpec;
  snapshot: Snapshot;
  currentUser: User;
  onCreate: () => void;
  onRefresh: () => void;
}>) {
  const [mode, setMode] = useState(spec.modes[0] ?? "Todos"),
    [status, setStatus] = useState("Todos"),
    [query, setQuery] = useState(""),
    [fromDate, setFromDate] = useState("2026-09-01"),
    [toDate, setToDate] = useState("2026-09-16"),
    [quickRecord, setQuickRecord] = useState<TableRow | "new" | null>(null),
    [flash, setFlash] = useState(false),
    [selectedRow, setSelectedRow] = useState<TableRow | null>(null);
  const [collectionClientId, setCollectionClientId] = useState("");
  const [collectionCollectorId, setCollectionCollectorId] = useState("Todas");
  const [collectionZone, setCollectionZone] = useState("Todas");
  const [collectionRouteId, setCollectionRouteId] = useState("Todas");
  const [collectionFromDate, setCollectionFromDate] = useState("");
  const [collectionToDate, setCollectionToDate] = useState("");
  const [collectionStatus, setCollectionStatus] = useState("Activo");
  const [collectionClientSearchOpen, setCollectionClientSearchOpen] = useState(false);
  const [collectionReceiptOpen, setCollectionReceiptOpen] = useState(false);
  const [, setCollectionReceiptDrafts] = useState<CollectionReceiptDraft[]>([]);
  const [collectionCancelConfirmOpen, setCollectionCancelConfirmOpen] = useState(false);
  const [collectionCancelReasonOpen, setCollectionCancelReasonOpen] = useState(false);
  const [collectionCancelNote, setCollectionCancelNote] = useState("Digitado por error.");
  const [collectionPrintChoiceOpen, setCollectionPrintChoiceOpen] = useState(false);
  const [collectionPrintTickets, setCollectionPrintTickets] = useState<CollectionTicketModel[] | null>(null);
  const [collectionMapChoiceOpen, setCollectionMapChoiceOpen] = useState(false);
  const [collectionMapPoints, setCollectionMapPoints] = useState<CollectionMapPoint[] | null>(null);
  const [collectionOrder, setCollectionOrder] = useState<string[]>([]);
  const [filtersVisible, setFiltersVisible] = useState(true);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [importFilas, setImportFilas] = useState<
    Record<string, unknown>[] | null
  >(null);
  const canImport = spec.entity === "charges" || spec.entity === "payouts";
  const [recurringModal, setRecurringModal] = useState<
    TableRow | "new" | null
  >(null);
  const permissions = permissionsFor(currentUser);
  const collectionOrderKey = spec.entity === "collections"
    ? spec.rows.map((row) => String(row.__id ?? "")).join("|")
    : "";
  useEffect(() => {
    if (spec.entity !== "collections") return;
    const ids = spec.rows.map((row) => String(row.__id ?? "")).filter(Boolean);
    setCollectionOrder((current) => {
      const currentIds = current.filter((id) => ids.includes(id));
      const next = [...currentIds, ...ids.filter((id) => !currentIds.includes(id))];
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
    });
  }, [collectionOrderKey, spec.entity]);
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
    setCollectionClientId("");
    setCollectionCollectorId("Todas");
    setCollectionZone("Todas");
    setCollectionRouteId("Todas");
    setCollectionFromDate("");
    setCollectionToDate("");
    setCollectionStatus("Activo");
    setCollectionClientSearchOpen(false);
    setCollectionCancelConfirmOpen(false);
    setCollectionCancelReasonOpen(false);
    setCollectionCancelNote("Digitado por error.");
    setCollectionPrintChoiceOpen(false);
    setCollectionPrintTickets(null);
    setCollectionMapChoiceOpen(false);
    setCollectionMapPoints(null);
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
  const collectionRows = spec.entity === "collections"
    ? spec.rows.filter((row) => {
        const movement = row.__raw as unknown as Snapshot["movements"][number] | undefined;
        const client = movement?.clientId ? snapshot.clients.find((item) => item.id === movement.clientId) : undefined;
        const route = client ? snapshot.routes.find((item) => item.id === client.routeId) : undefined;
        const collector = snapshot.collectors.find((item) => item.id === movement?.collectorId);
        const queryText = query.trim().toLowerCase();
        const clientSearch = `${client?.code ?? ""} ${client?.identification ?? ""} ${client?.name ?? ""}`.toLowerCase();
        const movementDate = movement?.createdAt.slice(0, 10) ?? "";
        const zoneName = client?.sector || route?.sector || "";
        const matchesClient = mode !== "Por Cliente" || (collectionClientId ? movement?.clientId === collectionClientId : !queryText || clientSearch.includes(queryText));
        const matchesCollector = mode !== "Por Cobrador" || collectionCollectorId === "Todas" || movement?.collectorId === collectionCollectorId;
        const matchesZone = mode !== "Por Zona" || collectionZone === "Todas" || zoneName === collectionZone;
        const matchesRoute = mode !== "Por Ruta" || collectionRouteId === "Todas" || client?.routeId === collectionRouteId;
        const matchesDate = (!collectionFromDate || movementDate >= collectionFromDate) && (!collectionToDate || movementDate <= collectionToDate);
        const isCancelled = Boolean(movement?.cancelledAt);
        const matchesStatus = collectionStatus === "Todos" || (collectionStatus === "Activo" ? !isCancelled : isCancelled);
        return Boolean(movement) && matchesClient && matchesCollector && matchesZone && matchesRoute && matchesDate && matchesStatus;
      })
    : [];
  const orderedCollectionRows = [...collectionRows].sort((left, right) => {
    const leftIndex = collectionOrder.indexOf(String(left.__id ?? ""));
    const rightIndex = collectionOrder.indexOf(String(right.__id ?? ""));
    return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
  });
  const collectionTotal = orderedCollectionRows.reduce((sum, row) => sum + Number(row.__amount ?? 0), 0);
  const collectionCancelledTotal = orderedCollectionRows.reduce((sum, row) => {
    const movement = row.__raw as unknown as Snapshot["movements"][number] | undefined;
    return sum + (movement?.cancelledAt ? Number(row.__amount ?? 0) : 0);
  }, 0);
  const moveSelectedCollection = (target: "first" | "previous" | "next" | "last") => {
    const selectedId = String(selectedRow?.__id ?? "");
    const ids = collectionOrder.length ? [...collectionOrder] : spec.rows.map((row) => String(row.__id ?? "")).filter(Boolean);
    const currentIndex = ids.indexOf(selectedId);
    if (!selectedId || currentIndex < 0) return;
    const [item] = ids.splice(currentIndex, 1);
    const destination = target === "first" ? 0 : target === "last" ? ids.length : target === "previous" ? Math.max(0, currentIndex - 1) : Math.min(ids.length, currentIndex + 1);
    ids.splice(destination, 0, item);
    setCollectionOrder(ids);
  };
  const cancelSelectedCollection = async (note: string) => {
    if (!selectedRow?.__id || !permissions.canDelete) return;
    try {
      await api(`/mock/admin/collections/${encodeURIComponent(String(selectedRow.__id))}`, {
        method: "DELETE",
        body: JSON.stringify({ note }),
      });
      toast.success("Cobro cancelado");
      setCollectionCancelReasonOpen(false);
      setCollectionCancelNote("Digitado por error.");
      setSelectedRow(null);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cancelar el cobro.");
    }
  };
  const openCollectionPrint = (scope: CollectionRecordScope) => {
    const targetRows = scope === "current"
      ? selectedRow ? [selectedRow] : []
      : orderedCollectionRows;
    if (scope === "current" && !selectedRow) {
      toast.info("Seleccione un cobro para imprimir el registro actual.");
      return;
    }
    const tickets = targetRows.map((row, index) => collectionTicketFromRow(row, index, snapshot));
    if (!tickets.length) {
      toast.info("No hay cobros disponibles para imprimir.");
      return;
    }
    setCollectionPrintTickets(tickets);
    setCollectionPrintChoiceOpen(false);
  };
  const openCollectionMap = (scope: CollectionRecordScope) => {
    const targetRows = scope === "current"
      ? selectedRow ? [selectedRow] : []
      : orderedCollectionRows;
    if (scope === "current" && !selectedRow) {
      toast.info("Seleccione un cobro para mostrar el registro actual.");
      return;
    }
    if (!targetRows.length) {
      toast.info("No hay cobros disponibles para mostrar en el mapa.");
      return;
    }
    const points = targetRows.flatMap((row, index) => {
      const movement = row.__raw as unknown as Snapshot["movements"][number] | undefined;
      const client = movement?.clientId ? snapshot.clients.find((item) => item.id === movement.clientId) : undefined;
      if (!movement || !client) return [];
      return [{
        id: String(row.__id ?? movement.id ?? index),
        clientName: client.name,
        identification: client.identification || client.code,
        latitude: client.lat,
        longitude: client.lng,
        amount: Number(row.__amount ?? movement.amount ?? 0),
        date: movement.createdAt,
      }];
    });
    setCollectionMapPoints(points);
    setCollectionMapChoiceOpen(false);
  };
  const collectionZones = Array.from(new Set([
    ...snapshot.routes.map((route) => route.sector),
    ...snapshot.clients.map((client) => client.sector),
  ].filter((zone): zone is string => Boolean(zone))));
  return (
    <>
      {spec.entity === "deposits" ? (
        <DepositsOperationalView snapshot={snapshot} currentUser={currentUser} onRefresh={onRefresh} />
      ) : spec.entity === "payouts" ? (
        <PayoutsOperationalView snapshot={snapshot} currentUser={currentUser} onRefresh={onRefresh} />
      ) : spec.entity === "collections" ? (
        <div className="charges-view collections-legacy-view">
          <LegacyToolbar
            filtersVisible={filtersVisible}
            onToggleFilters={() => setFiltersVisible((visible) => !visible)}
            onFirst={() => moveSelectedCollection("first")}
            onPrevious={() => moveSelectedCollection("previous")}
            onNext={() => moveSelectedCollection("next")}
            onLast={() => moveSelectedCollection("last")}
            onNew={() => setCollectionReceiptOpen(true)}
            onDelete={() => selectedRow ? setCollectionCancelConfirmOpen(true) : toast.info("Seleccione un cobro.")}
            onRefresh={resetFilters}
            disableNew={!permissions.canCreate}
            disableDelete={!selectedRow || !permissions.canDelete}
            showEdit={false}
            deleteIcon="x"
            deleteTitle="Cancelar cobro"
            extra={<>
              <button type="button" title="Imprimir" onClick={() => setCollectionPrintChoiceOpen(true)}><Printer size={15} /></button>
              <button type="button" title="Mapa" onClick={() => setCollectionMapChoiceOpen(true)}><Globe size={15} /></button>
            </>}
          />
          <div className={`charges-layout collections-legacy-layout ${filtersVisible ? "" : "filters-collapsed"}`}>
            {filtersVisible && <aside className="legacy-filter-panel charges-filter-panel" aria-label="Panel de filtro de cobros">
              <h2>Panel de Filtro</h2>
              <div className="charges-filter-options">
                <label className="charges-radio-row"><input type="radio" name="collection-filter-mode" value="Todos" checked={mode === "Todos"} onChange={() => setMode("Todos")} /><span>Todos</span></label>
                <div className="charges-filter-group">
                  <label className="charges-radio-row"><input type="radio" name="collection-filter-mode" value="Por Cliente" checked={mode === "Por Cliente"} onChange={() => setMode("Por Cliente")} /><span>por Cliente:</span></label>
                  <div className="legacy-lookup-field charges-filter-control"><input aria-label="Buscar por cliente" value={query} disabled={mode !== "Por Cliente"} onChange={(event) => { setQuery(event.target.value); setCollectionClientId(""); }} /><button type="button" aria-label="Seleccionar cliente" disabled={mode !== "Por Cliente"} onClick={() => setCollectionClientSearchOpen(true)}>[...]</button></div>
                </div>
                <div className="charges-filter-group">
                  <label className="charges-radio-row"><input type="radio" name="collection-filter-mode" value="Por Cobrador" checked={mode === "Por Cobrador"} onChange={() => setMode("Por Cobrador")} /><span>por Cobrador:</span></label>
                  <select className="charges-filter-control" aria-label="Cobrador" value={collectionCollectorId} disabled={mode !== "Por Cobrador"} onChange={(event) => setCollectionCollectorId(event.target.value)}><option value="Todas">Todos</option>{snapshot.collectors.map((collector) => <option key={collector.id} value={collector.id}>{collector.name}</option>)}</select>
                </div>
                <div className="charges-filter-group">
                  <label className="charges-radio-row"><input type="radio" name="collection-filter-mode" value="Por Zona" checked={mode === "Por Zona"} onChange={() => setMode("Por Zona")} /><span>Por Zona:</span></label>
                  <select className="charges-filter-control" aria-label="Zona" value={collectionZone} disabled={mode !== "Por Zona"} onChange={(event) => setCollectionZone(event.target.value)}><option value="Todas">Todas</option>{collectionZones.map((zone) => <option key={zone}>{zone}</option>)}</select>
                </div>
                <div className="charges-filter-group">
                  <label className="charges-radio-row"><input type="radio" name="collection-filter-mode" value="Por Ruta" checked={mode === "Por Ruta"} onChange={() => setMode("Por Ruta")} /><span>Por Ruta:</span></label>
                  <select className="charges-filter-control" aria-label="Ruta" value={collectionRouteId} disabled={mode !== "Por Ruta"} onChange={(event) => setCollectionRouteId(event.target.value)}><option value="Todas">Todas</option>{snapshot.routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}</select>
                </div>
              </div>
              <label className="field compact-field">Fecha Inicial:<input type="date" value={collectionFromDate} onChange={(event) => setCollectionFromDate(event.target.value)} /></label>
              <label className="field compact-field">Fecha final:<input type="date" value={collectionToDate} onChange={(event) => setCollectionToDate(event.target.value)} /></label>
              <label className="field compact-field">Estado:<select value={collectionStatus} onChange={(event) => setCollectionStatus(event.target.value)}><option value="Activo">Activo</option><option value="Todos">Todos</option><option value="Cancelado">Cancelado</option></select></label>
            </aside>}
            <section className="legacy-grid-panel charges-grid-panel collections-grid-panel" aria-label="Grilla de cobros">
              <div className="legacy-mdi-table-wrap">
                <table className="legacy-mdi-table collections-table">
                  <thead><tr><th>Nro.</th><th>Identif.</th><th>Cliente</th><th>Fecha</th><th>Linea</th><th>Ce...</th><th>Importe</th><th>Activo</th><th>Registro</th></tr></thead>
                  <tbody>{orderedCollectionRows.length ? orderedCollectionRows.map((row, index) => {
                    const movement = row.__raw as unknown as Snapshot["movements"][number];
                    const client = movement.clientId ? snapshot.clients.find((item) => item.id === movement.clientId) : undefined;
                    const collector = snapshot.collectors.find((item) => item.id === movement.collectorId);
                    const isSelected = selectedRow?.__id === row.__id;
                    return <tr key={String(row.__id ?? index)} className={isSelected ? "selected-row" : undefined} aria-selected={isSelected} role="button" tabIndex={0} onClick={() => setSelectedRow(row)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedRow(row))}>
                      <td>{index + 1}</td><td>{client?.identification || client?.code || ""}</td><td>{client?.name ?? "Cliente sin nombre"}</td><td>{String(row.date ?? "")}</td><td>{collector?.name ?? String(row.line ?? "")}</td><td>{String(row.receipt ?? "")}</td><td>{String(row.amount ?? money(Number(row.__amount ?? 0)))}</td><td><LegacyCheck checked={!movement.cancelledAt} /></td><td>{String(row.registry ?? "")}</td>
                    </tr>;
                  }) : <tr><td className="collections-empty-cell" colSpan={9}>Sin cobros registrados.</td></tr>}</tbody>
                </table>
              </div>
              <div className="legacy-footerbar"><span>Cantidad: <strong>{orderedCollectionRows.length}</strong></span><span>Total: <strong>{money(collectionTotal)}</strong></span><span>Cancelado: <strong>{money(collectionCancelledTotal)}</strong></span></div>
            </section>
          </div>
        </div>
      ) : (
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
      </>
      )}
      {collectionClientSearchOpen && spec.entity === "collections" && <ClientSearchSubmodal clients={snapshot.clients} onClose={() => setCollectionClientSearchOpen(false)} onSelect={(client) => { setCollectionClientId(client.id); setQuery(client.code); setCollectionClientSearchOpen(false); }} />}
      {collectionReceiptOpen && spec.entity === "collections" && <CollectionReceiptDialog snapshot={snapshot} onClose={() => setCollectionReceiptOpen(false)} onSave={(draft) => { setCollectionReceiptDrafts((current) => [...current, draft]); setCollectionReceiptOpen(false); toast.success("Recibo preparado en memoria."); }} onPrint={(draft) => { setCollectionReceiptDrafts((current) => [...current, draft]); setCollectionReceiptOpen(false); setCollectionPrintTickets([collectionTicketFromDraft(draft, snapshot)]); }} />}
      {collectionCancelConfirmOpen && spec.entity === "collections" && <LegacyConfirmDialog message="¿Está seguro que desea cancelar el Cobro actual?" onYes={() => { setCollectionCancelConfirmOpen(false); setCollectionCancelNote("Digitado por error."); setCollectionCancelReasonOpen(true); }} onNo={() => setCollectionCancelConfirmOpen(false)} />}
      {collectionCancelReasonOpen && spec.entity === "collections" && <CollectionCancelReasonDialog note={collectionCancelNote} onNoteChange={setCollectionCancelNote} onClose={() => { setCollectionCancelReasonOpen(false); setCollectionCancelNote("Digitado por error."); }} onConfirm={() => void cancelSelectedCollection(collectionCancelNote)} />}
      {collectionPrintChoiceOpen && spec.entity === "collections" && <CollectionScopeSelectorDialog title="Seleccione..." allLabel="Listado de registros" currentLabel="Registro actual" hasCurrent={Boolean(selectedRow)} onClose={() => setCollectionPrintChoiceOpen(false)} onConfirm={openCollectionPrint} />}
      {collectionPrintTickets && spec.entity === "collections" && <CollectionReceiptPrintDialog receipts={collectionPrintTickets} onClose={() => setCollectionPrintTickets(null)} />}
      {collectionMapChoiceOpen && spec.entity === "collections" && <CollectionScopeSelectorDialog title="Mostrar mapa de cobro(s)..." allLabel="Todos los Cobroos" currentLabel="Cobro actual" hasCurrent={Boolean(selectedRow)} onClose={() => setCollectionMapChoiceOpen(false)} onConfirm={openCollectionMap} />}
      {collectionMapPoints && spec.entity === "collections" && <CollectionMapDialog points={collectionMapPoints} onClose={() => setCollectionMapPoints(null)} />}
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
    </>
  );
}

type DepositDraft = {
  date: string;
  currency: string;
  collectorId: string;
  note: string;
  quantities: Record<number, string>;
};

const emptyDepositQuantities = (): Record<number, string> =>
  Object.fromEntries(DENOMS.map((denomination) => [denomination, ""]));

const depositAmount = (quantities: Record<number, string>) =>
  DENOMS.reduce((total, denomination) => total + denomination * (Number(quantities[denomination]) || 0), 0);

function depositMoney(value: number, currency: string) {
  const formatted = new Intl.NumberFormat("es-DO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
  const symbol = currency === "Peso Dominicano"
    ? "RD$"
    : currency === "Dólar Americano"
      ? "US$"
      : currency === "Euro"
        ? "€"
        : "";
  return symbol ? `${symbol} ${formatted}` : formatted;
}

function depositDraftFromMovement(movement: Movement, fallbackCurrency = "Peso Dominicano"): DepositDraft {
  const quantities = emptyDepositQuantities();
  for (const item of movement.denominations ?? []) quantities[item.denominacion] = String(item.cantidad);
  return {
    date: movement.createdAt.slice(0, 10),
    currency: String((movement as Movement & { currency?: string }).currency ?? fallbackCurrency),
    collectorId: movement.collectorId,
    note: String((movement as Movement & { note?: string }).note ?? ""),
    quantities,
  };
}

function depositDenominations(quantities: Record<number, string>) {
  return DENOMS.filter((denomination) => Number(quantities[denomination] ?? 0) > 0).map((denominacion) => ({
    denominacion,
    cantidad: Number(quantities[denominacion]),
  }));
}

function depositTicketFromDraft(draft: DepositDraft, id: string, snapshot: Snapshot): CollectionTicketModel {
  const lines = depositDenominations(draft.quantities).map(({ denominacion, cantidad }) => ({
    service: "Efectivo",
    concept: `${money(denominacion)} × ${cantidad}`,
    amount: denominacion * cantidad,
  }));
  const collector = snapshot.collectors.find((item) => item.id === draft.collectorId);
  return {
    id,
    receiptNumber: id,
    date: draft.date,
    currency: draft.currency,
    clientName: "Depósito de cobrador",
    clientIdentification: "",
    collectorName: collector?.name ?? "",
    paymentForm: "Depósito",
    bank: "No Definido",
    checkNumber: "",
    note: draft.note,
    amount: depositAmount(draft.quantities),
    lines,
  };
}

function depositTicketFromRow(row: TableRow, snapshot: Snapshot): CollectionTicketModel {
  const movement = row.__raw as unknown as Movement;
  const draft = depositDraftFromMovement(movement, String(row.currency ?? "Peso Dominicano"));
  return depositTicketFromDraft(draft, String(row.__id ?? movement.id), snapshot);
}

function DepositsOperationalView({ snapshot, currentUser, onRefresh }: Readonly<{ snapshot: Snapshot; currentUser: User; onRefresh: () => void }>) {
  const permissions = permissionsFor(currentUser);
  const [mode, setMode] = useState("Todos");
  const [collectorFilter, setCollectorFilter] = useState("Todas");
  const [zoneFilter, setZoneFilter] = useState("Todas");
  const [routeFilter, setRouteFilter] = useState("Todas");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [status, setStatus] = useState("Todos");
  const [filtersVisible, setFiltersVisible] = useState(true);
  const [selectedRow, setSelectedRow] = useState<TableRow | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [depositOverrides, setDepositOverrides] = useState<Record<string, DepositDraft>>({});
  const [formTarget, setFormTarget] = useState<TableRow | "new" | null>(null);
  const [acceptConfirmOpen, setAcceptConfirmOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelReasonOpen, setCancelReasonOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("Digitado por error");
  const [acceptTarget, setAcceptTarget] = useState<TableRow | null>(null);
  const [acceptQuantities, setAcceptQuantities] = useState<Record<number, string>>({});
  const [printTickets, setPrintTickets] = useState<CollectionTicketModel[] | null>(null);
  const [flash, setFlash] = useState(false);
  const [detailRevision, setDetailRevision] = useState(0);
  const orderKey = snapshot.movements.filter((movement) => movement.type === "deposit").map((movement) => movement.id).join("|");
  useEffect(() => {
    const ids = snapshot.movements.filter((movement) => movement.type === "deposit").map((movement) => movement.id);
    setOrder((current) => {
      const preserved = current.filter((id) => ids.includes(id));
      return [...preserved, ...ids.filter((id) => !preserved.includes(id))];
    });
  }, [orderKey, snapshot.movements]);
  const zones = Array.from(new Set(snapshot.routes.map((route) => route.sector).filter(Boolean)));
  const allRows = snapshot.movements.filter((movement) => movement.type === "deposit").map((movement, index): TableRow => {
    const localDraft = depositOverrides[movement.id];
    const raw = localDraft ? {
      ...movement,
      collectorId: localDraft.collectorId,
      amount: depositAmount(localDraft.quantities),
      createdAt: `${localDraft.date}T12:00:00.000Z`,
      denominations: depositDenominations(localDraft.quantities),
      currency: localDraft.currency,
      note: localDraft.note,
    } : movement;
    const collector = snapshot.collectors.find((item) => item.id === raw.collectorId);
    const stateLabel = raw.cancelledAt ? "Cancelado" : raw.acceptedAt ? "Aceptado" : "Pendiente";
    return {
      __id: movement.id,
      __date: raw.createdAt.slice(0, 10),
      __status: stateLabel,
      __amount: raw.amount,
      __raw: raw as unknown as Record<string, unknown>,
      n: index + 1,
      date: dateLabel(raw.createdAt.slice(0, 10)),
      collector: collector?.name ?? "Cobrador",
      currency: String((raw as Movement & { currency?: string }).currency ?? "Peso Dominicano"),
      amount: money(raw.amount),
      checks: "0",
      checkAmount: money(0),
      active: !raw.cancelledAt,
      accepted: Boolean(raw.acceptedAt),
    };
  });
  const filteredRows = allRows.filter((row) => {
    const movement = row.__raw as unknown as Movement;
    const collector = snapshot.collectors.find((item) => item.id === movement.collectorId);
    const route = snapshot.routes.find((item) => item.collectorId === movement.collectorId);
    const rowDate = movement.createdAt.slice(0, 10);
    const zone = route?.sector ?? "";
    return (mode !== "Por Cobrador" || collectorFilter === "Todas" || movement.collectorId === collectorFilter)
      && (mode !== "Por Zona" || zoneFilter === "Todas" || zone === zoneFilter)
      && (mode !== "Por Ruta" || routeFilter === "Todas" || route?.id === routeFilter)
      && (!fromDate || rowDate >= fromDate)
      && (!toDate || rowDate <= toDate)
      && (status === "Todos" || row.__status === status);
  });
  const orderedRows = [...filteredRows].sort((left, right) => {
    const leftIndex = order.indexOf(String(left.__id ?? ""));
    const rightIndex = order.indexOf(String(right.__id ?? ""));
    return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
  });
  const currentSelection = orderedRows.find((row) => row.__id === selectedRow?.__id) ?? null;
  const currentMovement = currentSelection?.__raw as unknown as Movement | undefined;
  const detailDenominations = currentMovement?.denominations ?? [];
  const detailsTotal = detailDenominations.reduce((total, item) => total + item.denominacion * item.cantidad, 0);
  const totals = orderedRows.reduce((total, row) => total + Number(row.__amount ?? 0), 0);
  const moveSelected = (target: "first" | "previous" | "next" | "last") => {
    const id = String(selectedRow?.__id ?? "");
    const ids = [...order];
    const index = ids.indexOf(id);
    if (!id || index < 0) return;
    const [item] = ids.splice(index, 1);
    const destination = target === "first" ? 0 : target === "last" ? ids.length : target === "previous" ? Math.max(0, index - 1) : Math.min(ids.length, index + 1);
    ids.splice(destination, 0, item);
    setOrder(ids);
  };
  const refresh = () => {
    setMode("Todos");
    setCollectorFilter("Todas");
    setZoneFilter("Todas");
    setRouteFilter("Todas");
    setFromDate("");
    setToDate("");
    setStatus("Todos");
    setSelectedRow(null);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 280);
    onRefresh();
  };
  const runDepositAction = async (row: TableRow, action: "aceptar" | "cancelar", desglose?: { denominacion: number; cantidad: number }[]) => {
    if (!row.__id) return;
    try {
      await api(`/depositos/${encodeURIComponent(String(row.__id))}/${action}`, {
        method: "POST",
        body: JSON.stringify(action === "aceptar" && desglose?.length ? { desglose } : {}),
      });
      toast.success(action === "aceptar" ? "Depósito aceptado" : "Depósito cancelado");
      setSelectedRow(null);
      setAcceptTarget(null);
      setCancelReasonOpen(false);
      setCancelReason("Digitado por error");
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo completar la acción del depósito.");
    }
  };
  const openAcceptConfirmation = () => {
    if (!currentSelection) return;
    setAcceptConfirmOpen(true);
  };
  const beginAccept = () => {
    if (!currentSelection) return;
    const raw = currentSelection.__raw as unknown as Movement;
    const quantities = emptyDepositQuantities();
    for (const item of raw.denominations ?? []) quantities[item.denominacion] = String(item.cantidad);
    setAcceptQuantities(quantities);
    setAcceptConfirmOpen(false);
    setAcceptTarget(currentSelection);
  };
  const beginCancel = () => {
    setCancelConfirmOpen(false);
    setCancelReason("Digitado por error");
    setCancelReasonOpen(true);
  };
  const confirmCancel = () => {
    if (currentSelection) void runDepositAction(currentSelection, "cancelar");
  };
  const openPrint = () => {
    const targetRows = currentSelection ? [currentSelection] : orderedRows;
    if (!targetRows.length) {
      toast.info("No hay depósitos disponibles para imprimir.");
      return;
    }
    setPrintTickets(targetRows.map((row) => depositTicketFromRow(row, snapshot)));
  };
  const saveDeposit = async (draft: DepositDraft, shouldPrint: boolean) => {
    try {
      let id = String(formTarget !== "new" && formTarget ? formTarget.__id : "");
      if (formTarget === "new") {
        const result = await api<{ movement?: Movement }>("/depositos", {
          method: "POST",
          body: JSON.stringify({ collectorId: draft.collectorId, amount: depositAmount(draft.quantities) }),
        });
        id = result.movement?.id ?? "";
        if (!id) throw new Error("El servidor no devolvió el depósito creado.");
      }
      setDepositOverrides((current) => ({ ...current, [id]: draft }));
      setFormTarget(null);
      toast.success(formTarget === "new" ? "Depósito guardado." : "Depósito actualizado localmente.");
      onRefresh();
      if (shouldPrint) setPrintTickets([depositTicketFromDraft(draft, id, snapshot)]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el depósito.");
    }
  };
  const formMovement = formTarget && formTarget !== "new" ? formTarget.__raw as unknown as Movement : undefined;
  const formInitial = formMovement ? depositOverrides[String(formMovement.id)] ?? depositDraftFromMovement(formMovement) : undefined;
  const acceptTotal = Object.entries(acceptQuantities).reduce((sum, [denomination, quantity]) => sum + Number(denomination) * (Number(quantity) || 0), 0);
  const acceptAmount = Number(acceptTarget?.__amount ?? 0);
  return (
    <>
      <div className={`charges-view deposits-legacy-view ${flash ? "refresh-flash" : ""}`}>
        <LegacyToolbar
          filtersVisible={filtersVisible}
          onToggleFilters={() => setFiltersVisible((visible) => !visible)}
          onFirst={() => moveSelected("first")}
          onPrevious={() => moveSelected("previous")}
          onNext={() => moveSelected("next")}
          onLast={() => moveSelected("last")}
          onNew={() => setFormTarget("new")}
          onEdit={() => currentSelection && setFormTarget(currentSelection)}
          onAccept={openAcceptConfirmation}
          onDelete={() => currentSelection && setCancelConfirmOpen(true)}
          onRefresh={refresh}
          onPrint={openPrint}
          disableNew={!permissions.canCreate}
          disableEdit={!currentSelection || !permissions.canEdit}
          disableAccept={!currentSelection || currentSelection.__status !== "Pendiente" || !permissions.canEdit}
          disableDelete={!currentSelection || currentSelection.__status === "Cancelado" || !permissions.canDelete}
          deleteIcon="x"
          deleteTitle="Cancelar depósito"
        />
        <div className={`deposits-layout ${filtersVisible ? "" : "filters-collapsed"}`}>
          {filtersVisible && <aside className="legacy-filter-panel charges-filter-panel deposit-filter-panel" aria-label="Panel de filtro de depósitos">
            <h2>Panel de Filtro</h2>
            <div className="charges-filter-options">
              <label className="charges-radio-row"><input type="radio" name="deposit-filter-mode" checked={mode === "Todos"} onChange={() => setMode("Todos")} /><span>Todos</span></label>
              <div className="charges-filter-group"><label className="charges-radio-row"><input type="radio" name="deposit-filter-mode" checked={mode === "Por Cobrador"} onChange={() => setMode("Por Cobrador")} /><span>por Cobrador:</span></label><select className="charges-filter-control" aria-label="Filtrar por cobrador" value={collectorFilter} disabled={mode !== "Por Cobrador"} onChange={(event) => setCollectorFilter(event.target.value)}><option value="Todas">Todos</option>{snapshot.collectors.map((collector) => <option key={collector.id} value={collector.id}>{collector.name}</option>)}</select></div>
              <div className="charges-filter-group"><label className="charges-radio-row"><input type="radio" name="deposit-filter-mode" checked={mode === "Por Zona"} onChange={() => setMode("Por Zona")} /><span>Por Zona:</span></label><select className="charges-filter-control" aria-label="Filtrar por zona" value={zoneFilter} disabled={mode !== "Por Zona"} onChange={(event) => setZoneFilter(event.target.value)}><option value="Todas">Todas</option>{zones.map((zone) => <option key={zone}>{zone}</option>)}</select></div>
              <div className="charges-filter-group"><label className="charges-radio-row"><input type="radio" name="deposit-filter-mode" checked={mode === "Por Ruta"} onChange={() => setMode("Por Ruta")} /><span>Por Ruta:</span></label><select className="charges-filter-control" aria-label="Filtrar por ruta" value={routeFilter} disabled={mode !== "Por Ruta"} onChange={(event) => setRouteFilter(event.target.value)}><option value="Todas">Todas</option>{snapshot.routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}</select></div>
            </div>
            <label className="field compact-field">Fecha Inicial:<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
            <label className="field compact-field">Fecha final:<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
            <label className="field compact-field">Estado:<select value={status} onChange={(event) => setStatus(event.target.value)}><option>Todos</option><option>Pendiente</option><option>Aceptado</option><option>Cancelado</option></select></label>
          </aside>}
          <section className="legacy-grid-panel deposits-grid-panel" aria-label="Grilla de depósitos por cobradores">
            <div className="legacy-mdi-table-wrap"><table className="legacy-mdi-table deposits-table">
              <thead><tr><th>Nro.</th><th>Fecha</th><th>Cobrador</th><th>Moneda</th><th>Importe</th><th>Cheq.</th><th>Imp. Cheques</th><th>Activo</th><th>Acep.</th></tr></thead>
              <tbody>{orderedRows.length ? orderedRows.map((row, index) => {
                const movement = row.__raw as unknown as Movement;
                const active = currentSelection?.__id === row.__id;
                return <tr key={String(row.__id)} className={active ? "selected-row" : undefined} aria-selected={active} role="button" tabIndex={0} onClick={() => setSelectedRow(row)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedRow(row))}>
                  <td>{index + 1}</td><td>{String(row.date ?? "")}</td><td>{String(row.collector ?? "")}</td><td>{String(row.currency ?? "")}</td><td className="numeric-cell">{String(row.amount ?? "")}</td><td>{String(row.checks ?? "0")}</td><td className="numeric-cell">{String(row.checkAmount ?? money(0))}</td><td><LegacyCheck checked={!movement.cancelledAt} /></td><td><LegacyCheck checked={Boolean(movement.acceptedAt)} /></td>
                </tr>;
              }) : <tr><td colSpan={9} className="collections-empty-cell">Sin depósitos registrados.</td></tr>}</tbody>
            </table></div>
            <div className="legacy-footerbar"><span>Cantidad: <strong>{orderedRows.length}</strong></span><span>Total: <strong>{money(totals)}</strong></span></div>
          </section>
          <aside className="legacy-detail-panel deposit-detail-panel" aria-label="Panel de detalles">
            <h2>Panel de Detalles</h2>
            <div className="deposit-detail-meta">{currentSelection ? <><strong>{String(currentSelection.collector ?? "Cobrador")}</strong><span>{String(currentSelection.currency ?? "Peso Dominicano")} · {money(Number(currentSelection.__amount ?? 0))}</span>{(currentMovement as Movement & { note?: string } | undefined)?.note && <small>{(currentMovement as Movement & { note?: string }).note}</small>}</> : <p>Seleccione un depósito para ver sus detalles.</p>}</div>
            <div className="deposit-detail-table-wrap"><table className="deposit-detail-table"><thead><tr><th>Banco</th><th>Numero</th><th>Importe</th></tr></thead><tbody>{detailDenominations.length ? detailDenominations.map((item) => <tr key={`${item.denominacion}-${item.cantidad}`}><td>Efectivo</td><td>{money(item.denominacion)} × {item.cantidad}</td><td>{money(item.denominacion * item.cantidad)}</td></tr>) : <tr><td colSpan={3} className="deposit-detail-empty">Sin detalle de efectivo.</td></tr>}</tbody><tfoot><tr><td colSpan={2}>Total</td><td>{money(detailsTotal)}</td></tr></tfoot></table></div>
            <div className="deposit-detail-actions"><button type="button" onClick={() => { setDetailRevision((revision) => revision + 1); onRefresh(); toast.success("Detalles refrescados."); }}><RefreshCw size={14} /> Refrescar</button><span className="sr-only">Actualización {detailRevision}</span></div>
          </aside>
        </div>
      </div>
      {formTarget && <DepositDataDialog snapshot={snapshot} movement={formMovement} initialDraft={formInitial} onClose={() => setFormTarget(null)} onSave={saveDeposit} />}
      {acceptConfirmOpen && <LegacyConfirmDialog message="¿Está seguro que en aceptar el depósito?" onYes={beginAccept} onNo={() => setAcceptConfirmOpen(false)} />}
      {cancelConfirmOpen && <LegacyConfirmDialog message="¿Realmente desea cancelar el registro actual?" onYes={beginCancel} onNo={() => setCancelConfirmOpen(false)} />}
      {cancelReasonOpen && <LegacyDialog title="Entre un valor..." onClose={() => { setCancelReasonOpen(false); setCancelReason("Digitado por error"); }} className="deposit-cancel-reason-dialog" overlayClassName="collection-receipt-suboverlay"><label className="deposit-dialog-row"><span>Valor:</span><input autoFocus value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></label><div className="legacy-dialog-actions centered"><button type="button" onClick={confirmCancel}>oK</button><button type="button" onClick={() => { setCancelReasonOpen(false); setCancelReason("Digitado por error"); }}>Cancelar</button></div></LegacyDialog>}
      {acceptTarget && <LegacyDialog title="Desglose de denominaciones" onClose={() => setAcceptTarget(null)} className="deposits-accept-dialog"><p>Depósito de {money(acceptAmount)} — indique los billetes y monedas:</p><div className="deposit-accept-denoms">{DENOMS.map((denomination) => <label key={denomination}>{money(denomination)}<input type="number" min="0" step="1" value={acceptQuantities[denomination] ?? ""} onChange={(event) => setAcceptQuantities((current) => ({ ...current, [denomination]: event.target.value }))} /></label>)}</div><div className="legacy-footerbar"><span>Desglosado: <strong>{money(acceptTotal)}</strong> de <strong>{money(acceptAmount)}</strong></span></div>{acceptTotal !== 0 && acceptTotal !== acceptAmount && <div className="inline-error" role="alert">El desglose debe cuadrar exactamente con el importe.</div>}<div className="legacy-dialog-actions centered"><button type="button" onClick={() => setAcceptTarget(null)}>Cancelar</button><button type="button" disabled={acceptTotal !== 0 && acceptTotal !== acceptAmount} onClick={() => void runDepositAction(acceptTarget, "aceptar", depositDenominations(acceptQuantities))}>Aceptar depósito</button></div></LegacyDialog>}
      {printTickets && <CollectionReceiptPrintDialog receipts={printTickets} onClose={() => setPrintTickets(null)} />}
    </>
  );
}

function DepositDataDialog({ snapshot, movement, initialDraft, onClose, onSave }: Readonly<{ snapshot: Snapshot; movement?: Movement; initialDraft?: DepositDraft; onClose: () => void; onSave: (draft: DepositDraft, shouldPrint: boolean) => Promise<void> }>) {
  const [date, setDate] = useState(initialDraft?.date ?? localSystemDate());
  const [currency, setCurrency] = useState(initialDraft?.currency ?? "Peso Dominicano");
  const [collectorId, setCollectorId] = useState(initialDraft?.collectorId ?? snapshot.collectors[0]?.id ?? "");
  const [note, setNote] = useState(initialDraft?.note ?? "");
  const [quantities, setQuantities] = useState<Record<number, string>>(emptyDepositQuantities());
  const [errorOpen, setErrorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const total = depositAmount(quantities);
  const submit = async (shouldPrint: boolean) => {
    if (total <= 0) {
      setErrorOpen(true);
      return;
    }
    if (!collectorId) {
      toast.error("Seleccione un cobrador.");
      return;
    }
    setBusy(true);
    try {
      await onSave({ date, currency, collectorId, note, quantities: { ...quantities } }, shouldPrint);
    } finally {
      setBusy(false);
    }
  };
  const refreshDenominations = () => {
    const collector = snapshot.collectors.find((item) => item.id === collectorId);
    const loaded = emptyDepositQuantities();
    // El snapshot solo expone el efectivo disponible del cobrador en DOP.
    // No se debe presentar ese saldo como recaudación de otra moneda.
    if (collector && currency === "Peso Dominicano") {
      let remaining = Math.max(0, Math.round(collector.cashInHand));
      for (const denomination of DENOMS) {
        const quantity = Math.floor(remaining / denomination);
        loaded[denomination] = quantity ? String(quantity) : "";
        remaining -= denomination * quantity;
      }
    }
    setQuantities(loaded);
    toast.success(
      collector && currency === "Peso Dominicano"
        ? `Denominaciones cargadas para ${collector.name} · ${currency}.`
        : `No hay recaudación disponible para ${collector?.name ?? "el cobrador"} en ${currency}.`,
    );
  };
  return <LegacyDialog title="Datos del Depósito..." onClose={onClose} className="deposit-data-dialog"><div className="deposit-data-content">
    <div className="deposit-data-fields">
      <div className="deposit-data-meta-row"><label>Doc:<input value={movement?.id ?? "-1"} readOnly disabled /></label><label>Fecha:<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label></div>
      <label className="deposit-dialog-row"><span>Moneda:</span><select value={currency} onChange={(event) => setCurrency(event.target.value)}>{CURRENCIES.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="deposit-dialog-row"><span>Cobrad.:</span><select value={collectorId} onChange={(event) => setCollectorId(event.target.value)}>{snapshot.collectors.map((collector) => <option key={collector.id} value={collector.id}>{collector.name}</option>)}</select></label>
      <label className="deposit-dialog-row"><span>Nota:</span><input value={note} onChange={(event) => setNote(event.target.value)} /></label>
    </div>
    <section className="deposit-denominations-section"><div className="deposit-denominations-toolbar"><strong>Denominaciones</strong><button type="button" onClick={refreshDenominations}><RefreshCw size={14} /> Refrescar</button></div><div className="deposit-denominations-table-wrap"><table className="deposit-denominations-table"><thead><tr><th>Denom.</th><th>Cantidad</th><th>Importe</th></tr></thead><tbody>{DENOMS.map((denomination) => { const quantity = Number(quantities[denomination] ?? 0) || 0; return <tr key={denomination}><td>{depositMoney(denomination, currency)}</td><td><span className="deposit-denomination-quantity">{quantity}</span></td><td>{depositMoney(denomination * quantity, currency)}</td></tr>; })}</tbody></table></div></section>
    <div className="deposit-data-footer"><label>Total:<input value={depositMoney(total, currency)} readOnly disabled /></label><div className="legacy-dialog-actions"><button type="button" disabled={busy} onClick={() => void submit(false)}>Guardar</button><button type="button" disabled={busy} onClick={() => void submit(true)}>Guardar e Imp.</button><button type="button" disabled={busy} onClick={onClose}>Cancelar</button></div></div>
  </div>{errorOpen && <LegacyAlertDialog title="Error" message={'El campo "Total" no contiene un valor real válido'} onClose={() => setErrorOpen(false)} overlayClassName="collection-receipt-suboverlay" />}</LegacyDialog>;
}

type PayoutLocalDetails = Pick<Payout, "clientId" | "collectorId" | "concept" | "amount"> & {
  date: string;
  currency: string;
  service: string;
  note: string;
};
type PayoutViewRecord = Payout & PayoutLocalDetails;
type PayoutFormDraft = {
  clientId: string;
  clientCode: string;
  currency: string;
  service: string;
  concept: string;
  price: string;
  quantity: string;
  note: string;
};

function PayoutsOperationalView({ snapshot, currentUser, onRefresh }: Readonly<{ snapshot: Snapshot; currentUser: User; onRefresh: () => void }>) {
  const permissions = permissionsFor(currentUser);
  const [mode, setMode] = useState("Todos");
  const [clientQuery, setClientQuery] = useState("");
  const [filterClientId, setFilterClientId] = useState("");
  const [zone, setZone] = useState("Todas");
  const [routeId, setRouteId] = useState("Todas");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [status, setStatus] = useState("Activo");
  const [filtersVisible, setFiltersVisible] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [clientSearchOpen, setClientSearchOpen] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const [localDetails, setLocalDetails] = useState<Record<string, PayoutLocalDetails>>({});
  const [formTarget, setFormTarget] = useState<string | "new" | null>(null);
  const [confirmInactivate, setConfirmInactivate] = useState(false);
  const [flash, setFlash] = useState(false);
  const payoutIdsKey = snapshot.payouts.map((payout) => payout.id).join("|");
  useEffect(() => {
    const ids = snapshot.payouts.map((payout) => payout.id);
    setOrder((current) => {
      const retained = current.filter((id) => ids.includes(id));
      return [...retained, ...ids.filter((id) => !retained.includes(id))];
    });
  }, [payoutIdsKey]);

  const zones = Array.from(new Set([
    ...snapshot.routes.map((route) => route.sector),
    ...snapshot.clients.map((client) => client.sector),
  ].filter((value): value is string => Boolean(value))));
  const records: PayoutViewRecord[] = snapshot.payouts.map((payout) => {
    const details = localDetails[payout.id];
    return {
      ...payout,
      clientId: details?.clientId ?? payout.clientId,
      collectorId: details?.collectorId ?? payout.collectorId,
      concept: details?.concept ?? payout.concept,
      amount: details?.amount ?? payout.amount,
      date: details?.date ?? snapshot.businessDate,
      currency: details?.currency ?? "Peso Dominicano",
      service: details?.service ?? payout.concept,
      note: details?.note ?? "",
    };
  });
  const visibleRecords = records.filter((payout) => {
    const client = snapshot.clients.find((item) => item.id === payout.clientId);
    const route = snapshot.routes.find((item) => item.id === client?.routeId);
    const clientText = `${client?.code ?? ""} ${client?.identification ?? ""} ${client?.name ?? ""}`.toLowerCase();
    const matchesMode = mode === "Todos"
      || (mode === "por Cliente" && (filterClientId ? payout.clientId === filterClientId : clientText.includes(clientQuery.trim().toLowerCase())))
      || (mode === "Por Zona" && (zone === "Todas" || (client?.sector || route?.sector) === zone))
      || (mode === "Por Ruta" && (routeId === "Todas" || client?.routeId === routeId));
    const matchesDate = (!fromDate || payout.date >= fromDate) && (!toDate || payout.date <= toDate);
    const matchesStatus = status === "Todos"
      || (status === "Activo" ? payout.status !== "cancelled" : status === "Cancelado" ? payout.status === "cancelled" : payout.status === status.toLowerCase());
    return matchesMode && matchesDate && matchesStatus;
  });
  const orderedRecords = [...visibleRecords].sort((left, right) => {
    const leftIndex = order.indexOf(left.id);
    const rightIndex = order.indexOf(right.id);
    return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
  });
  const selectedPayout = orderedRecords.find((payout) => payout.id === selectedId) ?? null;
  const formPayout = formTarget && formTarget !== "new" ? records.find((payout) => payout.id === formTarget) : undefined;
  const totals = orderedRecords.reduce((sum, payout) => ({
    amount: sum.amount + payout.amount,
    paid: sum.paid + payout.paid,
    pending: sum.pending + Math.max(0, payout.amount - payout.paid),
  }), { amount: 0, paid: 0, pending: 0 });

  const moveSelected = (target: "first" | "previous" | "next" | "last") => {
    if (!selectedId) return;
    setOrder((current) => {
      const ids = current.length ? [...current] : snapshot.payouts.map((payout) => payout.id);
      const index = ids.indexOf(selectedId);
      if (index < 0) return current;
      const [item] = ids.splice(index, 1);
      const destination = target === "first" ? 0 : target === "last" ? ids.length : target === "previous" ? Math.max(0, index - 1) : Math.min(ids.length, index + 1);
      ids.splice(destination, 0, item);
      return ids;
    });
  };
  const refresh = () => {
    setMode("Todos");
    setClientQuery("");
    setFilterClientId("");
    setZone("Todas");
    setRouteId("Todas");
    setFromDate("");
    setToDate("");
    setStatus("Activo");
    setSelectedId("");
    setFlash(true);
    window.setTimeout(() => setFlash(false), 280);
    onRefresh();
  };
  const savePayout = async (draft: PayoutFormDraft) => {
    const client = snapshot.clients.find((item) => item.id === draft.clientId);
    const route = snapshot.routes.find((item) => item.id === client?.routeId);
    const collectorId = route?.collectorId ?? snapshot.collectors.find((item) => item.routeId === client?.routeId)?.id ?? "";
    const amount = Math.round(Number(draft.price) * Number(draft.quantity) * 100);
    if (!client) {
      toast.error('El campo "Cliente" no puede estar vacío.');
      return false;
    }
    if (!collectorId) {
      toast.error("No hay un cobrador asignado a la ruta del cliente.");
      return false;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("El importe total debe ser mayor a cero.");
      return false;
    }
    const details: PayoutLocalDetails = {
      clientId: client.id,
      collectorId,
      concept: draft.concept.trim() || draft.service,
      amount,
      date: formPayout?.date ?? snapshot.businessDate,
      currency: draft.currency,
      service: draft.service,
      note: draft.note.trim(),
    };
    if (formPayout) {
      setLocalDetails((current) => ({ ...current, [formPayout.id]: details }));
      setFormTarget(null);
      toast.success("Cambios del descargo actualizados en la vista local.");
      return true;
    }
    try {
      const saved = await api<Payout>("/descargos", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ clientId: client.id, collectorId, concept: details.concept, amount }),
      });
      setLocalDetails((current) => ({ ...current, [saved.id]: details }));
      setSelectedId(saved.id);
      setFormTarget(null);
      toast.success("Descargo registrado.");
      onRefresh();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo registrar el descargo.");
      return false;
    }
  };
  const inactivateSelected = async () => {
    if (!selectedPayout) return;
    try {
      await api<Payout>("/descargos/cancelar", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ id: selectedPayout.id, reason: "Inactivar datos" }),
      });
      setConfirmInactivate(false);
      setSelectedId("");
      toast.success("Descargo inactivado.");
      onRefresh();
    } catch (error) {
      setConfirmInactivate(false);
      toast.error(error instanceof Error ? error.message : "No se pudo inactivar el descargo.");
    }
  };
  const findClientForFilter = (client: Client) => {
    setFilterClientId(client.id);
    setClientQuery(client.code);
  };
  const concepts = Array.from(new Set([
    "No definido",
    ...snapshot.charges.map((charge) => charge.concept?.trim() || charge.service),
    ...snapshot.payouts.map((payout) => payout.concept),
  ].filter(Boolean)));

  return (
    <>
      <div className={`charges-view payouts-legacy-view ${flash ? "refresh-flash" : ""}`}>
        <LegacyToolbar
          filtersVisible={filtersVisible}
          onToggleFilters={() => setFiltersVisible((visible) => !visible)}
          onFirst={() => moveSelected("first")}
          onPrevious={() => moveSelected("previous")}
          onNext={() => moveSelected("next")}
          onLast={() => moveSelected("last")}
          onNew={() => setFormTarget("new")}
          onEdit={() => selectedPayout && setFormTarget(selectedPayout.id)}
          onDelete={() => selectedPayout && setConfirmInactivate(true)}
          onRefresh={refresh}
          disableNew={!permissions.canCreate}
          disableEdit={!selectedPayout || !permissions.canEdit}
          disableDelete={!selectedPayout || selectedPayout.status === "cancelled" || !permissions.canDelete}
          showEdit
          deleteIcon="x"
          deleteTitle="Inactivar descargo"
        />
        <div className={`charges-layout payouts-layout ${filtersVisible ? "" : "filters-collapsed"}`}>
          {filtersVisible && <aside className="legacy-filter-panel charges-filter-panel payouts-filter-panel" aria-label="Panel de filtro de descargos">
            <h2>Panel de Filtro</h2>
            <div className="charges-filter-options">
              <label className="charges-radio-row"><input type="radio" name="payout-filter-mode" checked={mode === "Todos"} onChange={() => setMode("Todos")} /><span>Todos</span></label>
              <div className="charges-filter-group"><label className="charges-radio-row"><input type="radio" name="payout-filter-mode" checked={mode === "por Cliente"} onChange={() => setMode("por Cliente")} /><span>por Cliente:</span></label><div className="legacy-lookup-field charges-filter-control"><input aria-label="Filtrar por cliente" value={clientQuery} disabled={mode !== "por Cliente"} onChange={(event) => { setClientQuery(event.target.value); setFilterClientId(""); }} /><button type="button" aria-label="Seleccionar cliente" disabled={mode !== "por Cliente"} onClick={() => setClientSearchOpen(true)}>[...]</button></div></div>
              <div className="charges-filter-group"><label className="charges-radio-row"><input type="radio" name="payout-filter-mode" checked={mode === "Por Zona"} onChange={() => setMode("Por Zona")} /><span>Por Zona:</span></label><select className="charges-filter-control" aria-label="Filtrar por zona" value={zone} disabled={mode !== "Por Zona"} onChange={(event) => setZone(event.target.value)}><option>Todas</option>{zones.map((item) => <option key={item}>{item}</option>)}</select></div>
              <div className="charges-filter-group"><label className="charges-radio-row"><input type="radio" name="payout-filter-mode" checked={mode === "Por Ruta"} onChange={() => setMode("Por Ruta")} /><span>Por Ruta:</span></label><select className="charges-filter-control" aria-label="Filtrar por ruta" value={routeId} disabled={mode !== "Por Ruta"} onChange={(event) => setRouteId(event.target.value)}><option value="Todas">Todas</option>{snapshot.routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}</select></div>
            </div>
            <label className="field compact-field">Fecha Inicial:<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
            <label className="field compact-field">Fecha final:<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
            <label className="field compact-field">Estado:<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="Activo">Activo</option><option value="Todos">Todos</option><option value="pending">Pendiente</option><option value="partial">Parcial</option><option value="paid">Pagado</option><option value="Cancelado">Cancelado</option></select></label>
          </aside>}
          <section className="legacy-grid-panel charges-grid-panel payouts-grid-panel" aria-label="Grilla de descargos">
            <div className="legacy-mdi-table-wrap"><table className="legacy-mdi-table payouts-table"><thead><tr><th>Nro.</th><th>Identificacion</th><th>Cliente</th><th>Fecha</th><th>Moneda</th><th>Servicio</th><th>Importe</th><th>Activo</th></tr></thead><tbody>
              {orderedRecords.length ? orderedRecords.map((payout, index) => {
                const client = snapshot.clients.find((item) => item.id === payout.clientId);
                const selected = payout.id === selectedPayout?.id;
                return <tr key={payout.id} className={selected ? "selected-row" : undefined} aria-selected={selected} role="button" tabIndex={0} onClick={() => setSelectedId(payout.id)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedId(payout.id))}>
                  <td>{index + 1}</td><td>{client?.identification || client?.code || ""}</td><td>{client?.name ?? "Cliente sin nombre"}</td><td>{safeDateLabel(payout.date)}</td><td>{payout.currency}</td><td>{payout.service}</td><td>{money(payout.amount)}</td><td><LegacyCheck checked={payout.status !== "cancelled"} /></td>
                </tr>;
              }) : <tr><td colSpan={8} className="payouts-empty-cell">Sin descargos registrados.</td></tr>}
            </tbody></table></div>
            <div className="legacy-footerbar"><span>Cantidad: <strong>{orderedRecords.length}</strong></span><span>Total: <strong>{money(totals.amount)}</strong></span><span>Pagado: <strong>{money(totals.paid)}</strong></span><span>Pendiente: <strong>{money(totals.pending)}</strong></span></div>
          </section>
        </div>
      </div>
      {formTarget && <PayoutDataDialog key={formTarget} snapshot={snapshot} payout={formPayout} concepts={concepts} onClose={() => setFormTarget(null)} onSave={savePayout} />}
      {clientSearchOpen && <ClientSearchSubmodal clients={snapshot.clients} onClose={() => setClientSearchOpen(false)} onSelect={(client) => { findClientForFilter(client); setClientSearchOpen(false); }} />}
      {confirmInactivate && <LegacyConfirmDialog message="¿Inactivar datos?" onYes={() => void inactivateSelected()} onNo={() => setConfirmInactivate(false)} />}
    </>
  );
}

function PayoutDataDialog({ snapshot, payout, concepts, onClose, onSave }: Readonly<{ snapshot: Snapshot; payout?: PayoutViewRecord; concepts: string[]; onClose: () => void; onSave: (draft: PayoutFormDraft) => Promise<boolean> }>) {
  const initialClient = snapshot.clients.find((client) => client.id === payout?.clientId);
  const [draft, setDraft] = useState<PayoutFormDraft>({
    clientId: payout?.clientId ?? "",
    clientCode: initialClient?.code ?? "",
    currency: payout?.currency ?? "Peso Dominicano",
    service: payout?.service ?? CARGO_SERVICES[0],
    concept: payout?.concept ?? "No definido",
    price: payout ? (payout.amount / 100).toFixed(2) : "0.00",
    quantity: "1.00",
    note: payout?.note ?? "",
  });
  const [clientSearchOpen, setClientSearchOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const client = snapshot.clients.find((item) => item.id === draft.clientId);
  const price = Number(draft.price) || 0;
  const quantity = Number(draft.quantity) || 0;
  const total = Number.isFinite(price * quantity) ? price * quantity : 0;
  const update = (field: keyof PayoutFormDraft, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const updateClient = (value: string) => {
    const matched = snapshot.clients.find((item) => item.code.trim().toLowerCase() === value.trim().toLowerCase() || item.identification?.trim().toLowerCase() === value.trim().toLowerCase());
    setDraft((current) => ({ ...current, clientCode: value, clientId: matched?.id ?? "" }));
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!client) {
      setErrorMessage('El campo "Cliente" no puede estar vacío');
      return;
    }
    if (!draft.concept.trim()) {
      setErrorMessage('El campo "Concepto" no puede estar vacío');
      return;
    }
    if (!Number.isFinite(total) || total <= 0) {
      setErrorMessage("El importe total debe ser mayor a cero.");
      return;
    }
    setSaving(true);
    try {
      if (await onSave(draft)) onClose();
    } finally {
      setSaving(false);
    }
  };
  const services = payout && !CARGO_SERVICES.includes(payout.service) ? [payout.service, ...CARGO_SERVICES] : CARGO_SERVICES;
  const payoutConcepts = draft.concept && !concepts.includes(draft.concept) ? [draft.concept, ...concepts] : concepts;
  return (
    <>
      <LegacyDialog title="Datos del Descargo..." onClose={onClose} className="payout-data-dialog">
        <form className="cargo-entry-form payout-entry-form" onSubmit={(event) => void submit(event)}>
          <div className="cargo-entry-row cargo-client-row"><label htmlFor="payout-client-code">Cliente:</label><input id="payout-client-code" autoFocus value={draft.clientCode} onChange={(event) => updateClient(event.target.value)} /><button type="button" aria-label="Buscar cliente" onClick={() => setClientSearchOpen(true)}>[...]</button><input aria-label="Nombre del cliente" value={client?.name ?? ""} disabled readOnly /></div>
          <div className="cargo-entry-row"><label htmlFor="payout-currency">Moneda:</label><select id="payout-currency" value={draft.currency} onChange={(event) => update("currency", event.target.value)}><option>No definida</option><option>Peso Dominicano</option><option>Dólar Americano</option><option>Euro</option></select></div>
          <div className="cargo-entry-row"><label htmlFor="payout-service">Servicio:</label><select id="payout-service" value={draft.service} onChange={(event) => update("service", event.target.value)}>{services.map((service) => <option key={service}>{service}</option>)}</select></div>
          <div className="cargo-entry-row"><label htmlFor="payout-concept">Concepto:</label><select id="payout-concept" value={draft.concept} onChange={(event) => update("concept", event.target.value)}>{payoutConcepts.map((concept) => <option key={concept}>{concept}</option>)}</select></div>
          <div className="cargo-entry-row cargo-amount-row"><label htmlFor="payout-price">Importe:</label><label>Precio<input id="payout-price" type="number" min="0" step="0.01" value={draft.price} onChange={(event) => update("price", event.target.value)} /></label><label>Cantidad<input type="number" min="0" step="0.01" value={draft.quantity} onChange={(event) => update("quantity", event.target.value)} /></label><label>Total<input type="number" value={total.toFixed(2)} disabled readOnly /></label></div>
          <div className="cargo-entry-row"><label htmlFor="payout-note">Nota:</label><input id="payout-note" value={draft.note} onChange={(event) => update("note", event.target.value)} /></div>
          {errorMessage && <div className="inline-error" role="alert">{errorMessage}</div>}
          <div className="legacy-dialog-actions centered"><button type="submit" disabled={saving}>{saving ? "Guardando…" : "oK"}</button><button type="button" disabled={saving} onClick={onClose}>Cancelar</button></div>
        </form>
      </LegacyDialog>
      {clientSearchOpen && <ClientSearchSubmodal clients={snapshot.clients} onClose={() => setClientSearchOpen(false)} onSelect={(selected) => { setDraft((current) => ({ ...current, clientId: selected.id, clientCode: selected.code })); setClientSearchOpen(false); }} />}
      {errorMessage && <LegacyAlertDialog message={errorMessage} onClose={() => setErrorMessage("")} overlayClassName="collection-receipt-suboverlay" />}
    </>
  );
}

type CollectorSubflow = "zones" | "limits" | "routes";

const collectorSubflowTitle = (flow: CollectorSubflow) => {
  if (flow === "zones") return "Zonas del Cobrador";
  if (flow === "limits") return "Límites del Cobrador";
  return "Rutas del Cobrador";
};

const collectorSubflowAddLabel = (flow: CollectorSubflow) => {
  if (flow === "limits") return "Agregar Límite";
  if (flow === "zones") return "Agregar Zona";
  return "Agregar Ruta";
};

const collectorSubflowDeleteLabel = (flow: CollectorSubflow) => {
  if (flow === "limits") return "Eliminar Límite";
  if (flow === "zones") return "Eliminar Zona";
  return "Eliminar Ruta";
};

const collectorCurrencyName = (abbr: string) => {
  if (abbr === "USD") return "Dólar Americano";
  if (abbr === "EUR") return "Euro";
  if (abbr === "NONE") return "No definida";
  return "Peso Dominicano";
};

function RecurringPayoutModal({
  row,
  snapshot,
  onClose,
  onSaved,
}: Readonly<{
  row: TableRow | null;
  snapshot: Snapshot;
  onClose: () => void;
  onSaved: () => Promise<void>;
}>) {
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
}: Readonly<{
  row: TableRow | null;
  snapshot: Snapshot;
  onClose: () => void;
  onSaved: () => Promise<void>;
}>) {
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
}: Readonly<{
  flow: CollectorSubflow;
  collector: Collector;
  snapshot: Snapshot;
  onClose: () => void;
  onSaved: () => Promise<void>;
}>) {
  const [selectedRow, setSelectedRow] = useState("");
  const [selectedZone, setSelectedZone] = useState("Distrito Nacional");
  const [selectedRoute, setSelectedRoute] = useState(snapshot.routes[0]?.id ?? "");
  const [currency, setCurrency] = useState("Peso Dominicano");
  const [abbr, setAbbr] = useState("DOP");
  const [collectionLimit, setCollectionLimit] = useState(String((collector.collectionLimit || 0) / 100));
  const [payoutLimit, setPayoutLimit] = useState(String((collector.payoutLimit || 0) / 100));
  const title = collectorSubflowTitle(flow);
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
          <button onClick={() => void add()}><Plus size={16} /> {collectorSubflowAddLabel(flow)}</button>
          <button onClick={() => void remove()}><Trash2 size={16} /> {collectorSubflowDeleteLabel(flow)}</button>
          {flow === "limits" && <button className="btn primary" onClick={() => void add()}>Guardar</button>}
        </div>
        {flow === "zones" && <label className="field compact-field">Zona disponible<select value={selectedZone} onChange={(event) => setSelectedZone(event.target.value)}><option>Distrito Nacional</option><option>Mercado</option><option>Santiago Norte</option><option>Zona Este</option></select></label>}
        {flow === "routes" && <label className="field compact-field">Ruta disponible<select value={selectedRoute} onChange={(event) => setSelectedRoute(event.target.value)}>{snapshot.routes.map((route) => <option value={route.id} key={route.id}>{route.name}</option>)}</select></label>}
        {flow === "limits" && <div className="form-grid three-cols"><label className="field">Moneda<select value={abbr} onChange={(event) => { const next = event.target.value; setAbbr(next); setCurrency(collectorCurrencyName(next)); }}><option value="NONE">No definida</option><option value="DOP">Peso Dominicano (DOP)</option><option value="USD">Dólar Americano (USD)</option><option value="EUR">Euro (EUR)</option></select></label><label className="field">Límite de Cobro<input type="number" min="0" step="0.01" value={collectionLimit} onChange={(event) => setCollectionLimit(event.target.value)} /></label><label className="field">Límite de Pago<input type="number" min="0" step="0.01" value={payoutLimit} onChange={(event) => setPayoutLimit(event.target.value)} /></label></div>}
        <div className="table-scroll legacy-table-scroll">
          {flow === "zones" && <table className="data-table legacy-data-table dense"><thead><tr><th>Nro</th><th>Zona</th><th>Desde</th><th>Hasta</th></tr></thead><tbody>{(collector.zones ?? []).map((zone, index) => <tr key={zone.id} className={selectedRow === zone.id ? "selected-row" : undefined} role="button" tabIndex={0} onClick={() => setSelectedRow(zone.id)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedRow(zone.id))}><td>{index + 1}</td><td>{zone.name}</td><td>{zone.from}</td><td>{zone.to}</td></tr>)}</tbody></table>}
          {flow === "limits" && <table className="data-table legacy-data-table dense"><thead><tr><th>Moneda</th><th>Abrev</th><th>Lím. de Cobro</th><th>Lím. de Pago</th></tr></thead><tbody>{(collector.limits ?? []).map((limit) => <tr key={limit.abbr} className={selectedRow === limit.abbr ? "selected-row" : undefined} role="button" tabIndex={0} onClick={() => setSelectedRow(limit.abbr)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedRow(limit.abbr))}><td>{limit.currency}</td><td>{limit.abbr}</td><td>{money(limit.collectionLimit)}</td><td>{money(limit.payoutLimit)}</td></tr>)}</tbody></table>}
          {flow === "routes" && <table className="data-table legacy-data-table dense"><thead><tr><th>Nro_Ruta</th><th>Ruta</th></tr></thead><tbody>{(collector.assignedRoutes ?? []).map((routeId, index) => <tr key={routeId} className={selectedRow === routeId ? "selected-row" : undefined} role="button" tabIndex={0} onClick={() => setSelectedRow(routeId)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedRow(routeId))}><td>{index + 1}</td><td>{snapshot.routes.find((route) => route.id === routeId)?.name ?? routeId}</td></tr>)}</tbody></table>}
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
}: Readonly<{
  snapshot: Snapshot;
  onClose: () => void;
  onSaved: () => Promise<void>;
}>) {
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

type ReceiptDetailLine = {
  id: string;
  chargeId: string;
  service: string;
  concept: string;
  amount: number;
};

type CollectionReceiptDraft = {
  date: string;
  currency: string;
  clientId: string;
  collectorId: string;
  paymentForm: string;
  bank: string;
  number: string;
  note: string;
  lines: ReceiptDetailLine[];
};

type CollectionRecordScope = "all" | "current";

type CollectionTicketModel = {
  id: string;
  receiptNumber: string;
  date: string;
  currency: string;
  clientName: string;
  clientIdentification: string;
  collectorName: string;
  paymentForm: string;
  bank: string;
  checkNumber: string;
  note: string;
  amount: number;
  lines: { service: string; concept: string; amount: number }[];
};

type CollectionMapPoint = {
  id: string;
  clientName: string;
  identification: string;
  latitude?: number;
  longitude?: number;
  amount: number;
  date: string;
};

function collectionTicketFromDraft(draft: CollectionReceiptDraft, snapshot: Snapshot): CollectionTicketModel {
  const client = snapshot.clients.find((item) => item.id === draft.clientId);
  const collector = snapshot.collectors.find((item) => item.id === draft.collectorId);
  const lines = draft.lines.map((line) => ({ service: line.service, concept: line.concept, amount: line.amount }));
  return {
    id: `draft-${crypto.randomUUID()}`,
    receiptNumber: "-1",
    date: draft.date,
    currency: draft.currency,
    clientName: client?.name ?? "Cliente",
    clientIdentification: client?.identification || client?.code || "",
    collectorName: collector?.name ?? "",
    paymentForm: draft.paymentForm,
    bank: draft.bank,
    checkNumber: draft.number,
    note: draft.note,
    amount: lines.reduce((sum, line) => sum + line.amount, 0),
    lines,
  };
}

function collectionTicketFromRow(row: TableRow, index: number, snapshot: Snapshot): CollectionTicketModel {
  const movement = row.__raw as unknown as Snapshot["movements"][number] | undefined;
  const client = movement?.clientId ? snapshot.clients.find((item) => item.id === movement.clientId) : undefined;
  const collector = movement?.collectorId ? snapshot.collectors.find((item) => item.id === movement.collectorId) : undefined;
  const charge = movement?.chargeId ? snapshot.charges.find((item) => item.id === movement.chargeId) : undefined;
  const amount = Number(row.__amount ?? movement?.amount ?? 0);
  return {
    id: String(row.__id ?? movement?.id ?? index),
    receiptNumber: String(row.receipt ?? movement?.receiptToken ?? row.__id ?? index + 1),
    date: movement?.createdAt ?? String(row.date ?? localSystemDate()),
    currency: String(row.currency ?? "Peso Dominicano"),
    clientName: client?.name ?? "Cliente sin nombre",
    clientIdentification: client?.identification || client?.code || "",
    collectorName: collector?.name ?? "",
    paymentForm: String(row.forma ?? "Efectivo"),
    bank: String(row.banco ?? "No Definido"),
    checkNumber: String(row.numero ?? ""),
    note: String(row.note ?? ""),
    amount,
    lines: [{
      service: charge?.service ?? "Cobro de servicio",
      concept: charge?.concept ?? charge?.service ?? "Cobro registrado",
      amount,
    }],
  };
}

function CollectionScopeSelectorDialog({
  title,
  allLabel,
  currentLabel,
  hasCurrent,
  onClose,
  onConfirm,
}: Readonly<{
  title: string;
  allLabel: string;
  currentLabel: string;
  hasCurrent: boolean;
  onClose: () => void;
  onConfirm: (scope: CollectionRecordScope) => void;
}>) {
  const [scope, setScope] = useState<CollectionRecordScope>("all");
  return (
    <LegacyDialog title={title} onClose={onClose} className="collection-flow-dialog collection-scope-dialog" overlayClassName="collection-receipt-suboverlay">
      <div className="collection-scope-options">
        <label><input type="radio" name={`scope-${title}`} checked={scope === "all"} onChange={() => setScope("all")} />{allLabel}</label>
        <label className={!hasCurrent ? "is-disabled" : undefined}><input type="radio" name={`scope-${title}`} checked={scope === "current"} disabled={!hasCurrent} onChange={() => setScope("current")} />{currentLabel}</label>
      </div>
      <div className="legacy-dialog-actions centered"><button type="button" onClick={onClose}>Cancelar</button><button type="button" onClick={() => onConfirm(scope)}>oK</button></div>
    </LegacyDialog>
  );
}

function CollectionCancelReasonDialog({ note, onNoteChange, onClose, onConfirm }: Readonly<{ note: string; onNoteChange: (value: string) => void; onClose: () => void; onConfirm: () => void }>) {
  return (
    <LegacyDialog title="Cancelar Cobro..." onClose={onClose} className="collection-flow-dialog collection-cancel-reason-dialog" overlayClassName="collection-receipt-suboverlay">
      <label className="collection-flow-field">Nota:<input autoFocus value={note} onChange={(event) => onNoteChange(event.target.value)} /></label>
      <div className="legacy-dialog-actions centered"><button type="button" onClick={onConfirm}>oK</button><button type="button" onClick={onClose}>Cancelar</button></div>
    </LegacyDialog>
  );
}

function CollectionReceiptPrintDialog({ receipts, onClose }: Readonly<{ receipts: readonly CollectionTicketModel[]; onClose: () => void }>) {
  const [url, setUrl] = useState("http://vp.gamera.ddns");
  const [port, setPort] = useState("8080");
  const [printer, setPrinter] = useState("zebra");
  const printedAt = new Date().toLocaleString("es-DO", { dateStyle: "short", timeStyle: "medium" });
  return (
    <LegacyDialog title="Imprimir Recibo de Cobro..." onClose={onClose} className="collection-flow-dialog collection-ticket-dialog" overlayClassName="collection-receipt-suboverlay collection-ticket-print-overlay">
      <div className="collection-ticket-print-content">
        <div className="collection-ticket-printer-setup collection-ticket-controls">
          <label>URL:<input value={url} onChange={(event) => setUrl(event.target.value)} /></label>
          <label>Puerto:<input value={port} onChange={(event) => setPort(event.target.value)} /></label>
          <label>Imp.:<select value={printer} onChange={(event) => setPrinter(event.target.value)}><option value="zebra">zebra</option><option value="virtual">Impresora Virtual</option><option value="matrix">Impresora de Matriz</option></select></label>
          <button type="button" onClick={() => toast.info(`Impresora seleccionada: ${printer}.`)}>Buscar</button>
          <button type="button" onClick={() => toast.success("Prueba de impresora preparada.")}>Test</button>
        </div>
        <div className="collection-ticket-preview-list">
          {receipts.map((receipt) => (
            <pre className="collection-ticket-preview" key={receipt.id}>{[
              "COBROS Y PAGOS",
              "Gamera Software",
              "Dirección: Oficina Principal",
              "Teléfono: 809-555-0101",
              "Servicio y confianza",
              "================================",
              `Recibo: ${receipt.receiptNumber}`,
              `Ident: ${receipt.clientIdentification}`,
              `Cliente: ${receipt.clientName}`,
              `Fecha: ${safeDateLabel(receipt.date.slice(0, 10))}`,
              `Moneda: ${receipt.currency}`,
              `Cobrador: ${receipt.collectorName || "Administración"}`,
              "--------------------------------",
              ...receipt.lines.map((line) => `${line.service}\n${line.concept}\n${money(line.amount)}`),
              "--------------------------------",
              `Forma: ${receipt.paymentForm}`,
              ...(receipt.bank !== "No Definido" ? [`Banco: ${receipt.bank}`] : []),
              ...(receipt.checkNumber ? [`Número: ${receipt.checkNumber}`] : []),
              ...(receipt.note ? [`Nota: ${receipt.note}`] : []),
              `TOTAL: ${money(receipt.amount)}`,
              "================================",
              "*** REVISE SU RECIBO ***",
              `Impreso: ${printedAt}`,
              "",
            ].join("\n")}</pre>
          ))}
        </div>
        <div className="legacy-dialog-actions collection-ticket-actions"><button type="button" onClick={onClose}>oK</button><button type="button" className="primary" onClick={() => window.print()}>Imprimir</button></div>
      </div>
    </LegacyDialog>
  );
}

function CollectionMapDialog({ points, onClose }: Readonly<{ points: readonly CollectionMapPoint[]; onClose: () => void }>) {
  const [mapStyle, setMapStyle] = useState<ClientMapStyle>("Hybrid");
  const [selectedId, setSelectedId] = useState(points[0]?.id ?? "");
  const locatedPoints = points.filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
  const selected = points.find((point) => point.id === selectedId) ?? null;
  const latitudes = locatedPoints.map((point) => point.latitude as number);
  const longitudes = locatedPoints.map((point) => point.longitude as number);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const markerPosition = (point: CollectionMapPoint) => {
    const latRange = maxLat - minLat;
    const lngRange = maxLng - minLng;
    const pointIndex = locatedPoints.findIndex((item) => item.id === point.id);
    return {
      left: lngRange === 0 ? `${50 + (pointIndex - (locatedPoints.length - 1) / 2) * 5}%` : `${8 + (((point.longitude as number) - minLng) / lngRange) * 84}%`,
      top: latRange === 0 ? "50%" : `${8 + (1 - ((point.latitude as number) - minLat) / latRange) * 84}%`,
    };
  };
  return (
    <LegacyDialog title="Mapa de Cobro(s)..." onClose={onClose} className={`client-map-dialog collections-map-dialog map-style-${mapStyle.toLowerCase()}`} overlayClassName="collection-receipt-suboverlay">
      <div className="client-map-view">
        <div className="client-map-toolbar" role="group" aria-label="Tipo de mapa">
          {(["Hybrid", "Roadmap", "Satellite", "Terrain"] as const).map((style) => <button key={style} type="button" className={mapStyle === style ? "active" : ""} onClick={() => setMapStyle(style)}>{style}</button>)}
        </div>
        <div className="client-map-canvas" role="region" aria-label="Mapa de cobros">
          <div className="client-map-river" />
          <div className="client-map-road road-one" /><div className="client-map-road road-two" /><div className="client-map-road road-three" />
          <div className="client-map-label map-label-one">Centro</div><div className="client-map-label map-label-two">Los Jardines</div><div className="client-map-label map-label-three">Av. Principal</div>
          {locatedPoints.map((point) => <button type="button" key={point.id} className={`client-map-pin collection-map-pin ${selectedId === point.id ? "active" : ""}`} style={markerPosition(point)} aria-label={`Cobro de ${point.clientName}`} onClick={() => setSelectedId(point.id)}><MapPinned size={24} /><small>{point.clientName}</small></button>)}
          {!locatedPoints.length && <div className="collection-map-no-points">Los cobros seleccionados no tienen coordenadas registradas.</div>}
        </div>
        <div className="collection-map-status"><span>{locatedPoints.length} de {points.length} cobro(s) con ubicación</span>{selected && <span>{selected.clientName} · {selected.identification} · {money(selected.amount)}</span>}</div>
        <div className="client-map-actions"><button type="button" onClick={() => setSelectedId(points[0]?.id ?? "")}>Ajustar</button><button type="button" onClick={onClose}>oK</button><button type="button" onClick={onClose}>Cerrar</button></div>
      </div>
    </LegacyDialog>
  );
}

function CollectionReceiptDialog({
  snapshot,
  onClose,
  onSave,
  onPrint,
}: Readonly<{
  snapshot: Snapshot;
  onClose: () => void;
  onSave: (draft: CollectionReceiptDraft) => void;
  onPrint: (draft: CollectionReceiptDraft) => void;
}>) {
  const [receiptDate, setReceiptDate] = useState(localSystemDate());
  const [currency, setCurrency] = useState(CURRENCIES[1] ?? "Peso Dominicano");
  const [clientId, setClientId] = useState("");
  const [clientCode, setClientCode] = useState("");
  const [collectorId, setCollectorId] = useState(snapshot.collectors[0]?.id ?? "");
  const [paymentForm, setPaymentForm] = useState("Efectivo");
  const [bank, setBank] = useState("No Definido");
  const [checkNumber, setCheckNumber] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<ReceiptDetailLine[]>([]);
  const [selectedLineId, setSelectedLineId] = useState("");
  const [clientSearchOpen, setClientSearchOpen] = useState(false);
  const [chargePickerOpen, setChargePickerOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<ReceiptDetailLine | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [clientRequiredOpen, setClientRequiredOpen] = useState(false);
  const [saveError, setSaveError] = useState("");
  const client = snapshot.clients.find((item) => item.id === clientId);
  const selectedLine = lines.find((line) => line.id === selectedLineId) ?? null;
  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  const banks = [
    "No Definido",
    "BANCO DE RESERVAS",
    "BANCO POPULAR",
    "BANCO HIPOTECARIO DOMINICANO",
    "BANCO LEON",
    "GERENCIAL FIDUCIARIO",
    "BANCO NACIONAL",
    "BANCO METROPOLITANO",
    "SCOTIA BANK",
    "CITY BANK",
    "BANCO DE OSAKE",
    "BANCO ADEMI",
    "BANCO",
    "BANCO DE COMERCIO",
    "BANCO GLOBAL",
  ];
  const resolveClientCode = (value: string) => {
    setClientCode(value);
    const normalized = value.trim().toLocaleLowerCase();
    const match = snapshot.clients.find((item) =>
      [item.code, item.identification ?? "", item.id]
        .some((candidate) => candidate.toLocaleLowerCase() === normalized),
    );
    setClientId(match?.id ?? "");
  };
  const addLine = (charge: Charge) => {
    if (lines.some((line) => line.chargeId === charge.id)) {
      toast.info("Este cargo ya está agregado al recibo.");
      return;
    }
    const pendingAmount = Math.max(0, charge.amount - charge.collected);
    if (pendingAmount <= 0) return;
    const nextLine: ReceiptDetailLine = {
      id: crypto.randomUUID(),
      chargeId: charge.id,
      service: charge.service,
      concept: charge.concept ?? charge.service,
      amount: pendingAmount,
    };
    setLines((current) => [...current, nextLine]);
    setSelectedLineId(nextLine.id);
    setChargePickerOpen(false);
    setSaveError("");
  };
  const requestAddLine = () => {
    if (!client) {
      setClientRequiredOpen(true);
      return;
    }
    setChargePickerOpen(true);
  };
  const saveReceipt = (event?: FormEvent, print = false) => {
    event?.preventDefault();
    setSaveError("");
    if (!client) {
      setClientRequiredOpen(true);
      return;
    }
    if (!lines.length) {
      setSaveError("Agregue al menos un cargo al recibo.");
      return;
    }
    const draft = {
      date: receiptDate,
      currency,
      clientId: client.id,
      collectorId,
      paymentForm,
      bank,
      number: checkNumber,
      note,
      lines: lines.map((line) => ({ ...line })),
    };
    if (print) onPrint(draft);
    else onSave(draft);
  };
  return (
    <LegacyDialog title="Datos del Cobro..." onClose={onClose} className="collection-receipt-dialog">
      <div className="collection-receipt-content">
        <div className="collection-receipt-fields">
          <div className="collection-receipt-row collection-receipt-meta-row">
            <label>Doc:<input type="number" value="-1" readOnly disabled aria-label="Documento" /></label>
            <label>Fecha:<input type="date" value={receiptDate} onChange={(event) => setReceiptDate(event.target.value)} /></label>
            <label>Moneda:<select value={currency} onChange={(event) => setCurrency(event.target.value)}>{CURRENCIES.map((option) => <option key={option}>{option}</option>)}</select></label>
          </div>
          <div className="collection-receipt-row collection-receipt-client-row">
            <label htmlFor="receipt-client-code">Cliente:</label>
            <input id="receipt-client-code" value={clientCode} onChange={(event) => resolveClientCode(event.target.value)} aria-label="Código del cliente" />
            <button type="button" aria-label="Buscar cliente" onClick={() => setClientSearchOpen(true)}>[...]</button>
            <input value={client?.name ?? ""} readOnly disabled aria-label="Nombre del cliente" />
          </div>
          <div className="collection-receipt-row collection-receipt-labeled-row">
            <label htmlFor="receipt-collector">Cobrad.:</label>
            <select id="receipt-collector" value={collectorId} onChange={(event) => setCollectorId(event.target.value)}>
              <option value="">No definido</option>
              {snapshot.collectors.map((collector) => <option key={collector.id} value={collector.id}>{collector.name}</option>)}
            </select>
          </div>
          <div className="collection-receipt-row collection-receipt-labeled-row">
            <label htmlFor="receipt-payment-form">Forma:</label>
            <select id="receipt-payment-form" value={paymentForm} onChange={(event) => setPaymentForm(event.target.value)}>{["Cheque", "Depósito", "Efectivo", "Mixto", "Tarjeta"].map((option) => <option key={option}>{option}</option>)}</select>
          </div>
          <div className="collection-receipt-row collection-receipt-labeled-row">
            <label htmlFor="receipt-bank">Banco:</label>
            <select id="receipt-bank" value={bank} onChange={(event) => setBank(event.target.value)}>{banks.map((option) => <option key={option}>{option}</option>)}</select>
          </div>
          <div className="collection-receipt-row collection-receipt-labeled-row">
            <label htmlFor="receipt-check-number">Número:</label>
            <input id="receipt-check-number" value={checkNumber} onChange={(event) => setCheckNumber(event.target.value)} />
          </div>
          <div className="collection-receipt-row collection-receipt-labeled-row">
            <label htmlFor="receipt-note">Nota:</label>
            <input id="receipt-note" value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
        </div>

        <section className="collection-receipt-detail" aria-label="Detalle del recibo">
          <div className="collection-receipt-detail-toolbar">
            <button type="button" onClick={requestAddLine}>Agregar</button>
            <button type="button" disabled={!selectedLine} onClick={() => selectedLine && setEditingLine(selectedLine)}>Modificar</button>
            <button type="button" disabled={!selectedLine} onClick={() => setConfirmDeleteOpen(true)}>Borrar</button>
            <button type="button" onClick={() => { setSelectedLineId(""); setSaveError(""); toast.info("Detalle refrescado."); }}>Refrescar</button>
          </div>
          <div className="collection-receipt-table-wrap">
            <table className="collection-receipt-table">
              <thead><tr><th>Nro.</th><th>Servicio</th><th>Concepto</th><th>Importe</th></tr></thead>
              <tbody>{lines.length ? lines.map((line, index) => <tr key={line.id} className={selectedLineId === line.id ? "selected-row" : undefined} aria-selected={selectedLineId === line.id} role="button" tabIndex={0} onClick={() => setSelectedLineId(line.id)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedLineId(line.id))}>
                <td>{index + 1}</td><td>{line.service}</td><td>{line.concept}</td><td className="numeric-cell">{money(line.amount)}</td>
              </tr>) : <tr><td colSpan={4} className="collection-receipt-empty">Sin cargos agregados.</td></tr>}</tbody>
            </table>
          </div>
        </section>

        {saveError && <div className="collection-receipt-error" role="alert">{saveError}</div>}
        <div className="collection-receipt-footer">
          <label className="collection-receipt-total">Total:<input value={money(total)} readOnly disabled aria-label="Total del recibo" /></label>
          <div className="collection-receipt-footer-actions">
            <button type="button" onClick={() => saveReceipt()}>Guardar</button>
            <button type="button" onClick={() => saveReceipt(undefined, true)}>Guardar e Imp.</button>
            <button type="button" onClick={onClose}>Cancelar</button>
          </div>
        </div>
      </div>
      {clientSearchOpen && <ClientSearchSubmodal clients={snapshot.clients} onClose={() => setClientSearchOpen(false)} onSelect={(selectedClient) => { setClientId(selectedClient.id); setClientCode(selectedClient.code); setClientSearchOpen(false); }} />}
      {chargePickerOpen && client && <CollectionChargePickerDialog charges={snapshot.charges.filter((charge) => charge.clientId === client.id && charge.status !== "paid" && charge.status !== "cancelled" && charge.amount - charge.collected > 0)} onClose={() => setChargePickerOpen(false)} onSelect={addLine} />}
      {editingLine && <ModifyReceiptAmountDialog line={editingLine} onClose={() => setEditingLine(null)} onSave={(amount) => { setLines((current) => current.map((line) => line.id === editingLine.id ? { ...line, amount } : line)); setEditingLine(null); }} />}
      {confirmDeleteOpen && <LegacyConfirmDialog message="¿Está seguro que desea borrar el elemento actual?" onYes={() => { setLines((current) => current.filter((line) => line.id !== selectedLineId)); setSelectedLineId(""); setConfirmDeleteOpen(false); }} onNo={() => setConfirmDeleteOpen(false)} />}
      {clientRequiredOpen && <LegacyAlertDialog message="Debe escoger un Cliente válido primero." onClose={() => setClientRequiredOpen(false)} />}
    </LegacyDialog>
  );
}

function CollectionChargePickerDialog({
  charges,
  onClose,
  onSelect,
}: Readonly<{
  charges: Charge[];
  onClose: () => void;
  onSelect: (charge: Charge) => void;
}>) {
  const [selectedChargeId, setSelectedChargeId] = useState(charges[0]?.id ?? "");
  const selectedCharge = charges.find((charge) => charge.id === selectedChargeId);
  return (
    <LegacyDialog title="Seleccionar..." onClose={onClose} className="collection-charge-picker-dialog" overlayClassName="collection-receipt-suboverlay">
      <div className="collection-charge-picker-table-wrap">
        <table className="collection-receipt-table">
          <thead><tr><th>Servicio</th><th>Concepto</th><th>Importe</th></tr></thead>
          <tbody>{charges.length ? charges.map((charge) => {
            const pending = Math.max(0, charge.amount - charge.collected);
            const active = selectedChargeId === charge.id;
            return <tr key={charge.id} className={active ? "selected-row" : undefined} aria-selected={active} role="button" tabIndex={0} onClick={() => setSelectedChargeId(charge.id)} onDoubleClick={() => onSelect(charge)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedChargeId(charge.id))}>
              <td>{charge.service}</td><td>{charge.concept ?? charge.service}</td><td className="numeric-cell">{money(pending)}</td>
            </tr>;
          }) : <tr><td colSpan={3} className="collection-receipt-empty">El cliente no tiene cargos pendientes.</td></tr>}</tbody>
        </table>
      </div>
      <div className="legacy-dialog-actions centered"><button type="button" onClick={onClose}>Cancelar</button><button type="button" disabled={!selectedCharge} onClick={() => selectedCharge && onSelect(selectedCharge)}>oK</button></div>
    </LegacyDialog>
  );
}

function ModifyReceiptAmountDialog({
  line,
  onClose,
  onSave,
}: Readonly<{
  line: ReceiptDetailLine;
  onClose: () => void;
  onSave: (amount: number) => void;
}>) {
  const [amount, setAmount] = useState((line.amount / 100).toFixed(2));
  const [error, setError] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setError("El importe debe ser mayor a cero.");
      return;
    }
    onSave(cents);
  };
  return (
    <LegacyDialog title="Modificar Importe..." onClose={onClose} className="collection-receipt-modify-dialog" overlayClassName="collection-receipt-suboverlay">
      <form className="collection-receipt-modify-form" onSubmit={submit}>
        <label>Importe:<input autoFocus type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        {error && <div className="collection-receipt-error" role="alert">{error}</div>}
        <div className="legacy-dialog-actions centered"><button type="button" onClick={onClose}>Cancelar</button><button type="submit">oK</button></div>
      </form>
    </LegacyDialog>
  );
}

function ClientSearchSubmodal({ clients, onSelect, onClose }: Readonly<{ clients: Snapshot["clients"]; onSelect: (client: Snapshot["clients"][number]) => void; onClose: () => void; }>) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(clients[0]?.id ?? "");
  const rows = clients.filter((client) => `${client.code} ${client.id} ${client.name}`.toLowerCase().includes(query.toLowerCase()));
  const selectedClient = clients.find((client) => client.id === selected) ?? rows[0];
  return (
    <LegacyDialog title="Seleccionar cliente..." onClose={onClose} className="client-search-dialog" overlayClassName="client-search-overlay">
        <label className="legacy-toolbar-search wide">Digite:<input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="table-scroll legacy-table-scroll">
          <table className="data-table legacy-data-table dense"><thead><tr><th>Cód.</th><th>Identif.</th><th>Cliente</th></tr></thead><tbody>{rows.map((client) => <tr key={client.id} className={selected === client.id ? "selected-row" : undefined} role="button" tabIndex={0} onClick={() => setSelected(client.id)} onDoubleClick={() => onSelect(client)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelected(client.id))}><td>{client.code}</td><td>{client.id}</td><td>{client.name}</td></tr>)}</tbody></table>
        </div>
        <div className="legacy-dialog-actions centered"><button type="button" onClick={onClose}>Cancelar</button><button type="button" onClick={() => selectedClient && onSelect(selectedClient)}>oK</button></div>
    </LegacyDialog>
  );
}

function QuickRecordModal({
  entity,
  row,
  snapshot,
  onClose,
  onSaved,
}: Readonly<{
  entity: string;
  row: TableRow | null;
  snapshot: Snapshot;
  onClose: () => void;
  onSaved: () => Promise<void>;
}>) {
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
}: Readonly<{
  columns: LegacyColumn[];
  rows: TableRow[];
  dense?: boolean;
  permissions?: AdminPermissions;
  selectedRowId?: string;
  onSelect?: (row: TableRow) => void;
  onEdit?: (row: TableRow) => void;
  onDelete?: (row: TableRow) => void;
  sortable?: boolean;
}>) {
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
}: Readonly<{
  page: Page;
  snapshot: Snapshot;
  refreshing: boolean;
  currentUser: User;
  onRefresh: () => void;
}>) {
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
  const title = monitorTitleForPage(page);
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
}: Readonly<{
  page: Page;
  rows: MonitorRow[];
  onSelect: (row: MonitorRow) => void;
}>) {
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
}: Readonly<{
  data: MapData;
  entityType: MonitorEntity;
  title: string;
}>) {
  const [focusedMarker, setFocusedMarker] = useState<MapMarker | null>(null);
  const adapted = adaptedMapForEntity(entityType, title, data);
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
}: Readonly<{
  snapshot: Snapshot;
  onRefresh: () => void;
}>) {
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
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("es-DO", { day: "numeric", month: "short" });
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
}: Readonly<{
  snapshot: Snapshot;
  onCollector: (collector: Collector) => void;
}>) {
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

function Movements({ snapshot }: Readonly<{ snapshot: Snapshot }>) {
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
