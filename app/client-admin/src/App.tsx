import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronLeft,
  ChevronsUpDown,
  CircleAlert,
  CircleHelp,
  Command,
  Download,
  FileCheck2,
  KeyRound,
  LayoutDashboard,
  ListFilter,
  LoaderCircle,
  LogOut,
  MapPinned,
  Menu,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  ShieldCheck,
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
import OperationModal, { type Operation } from "./Operations";
import AccountModal, { type AccountOperation } from "./Users";
import type { Collector, Page, Snapshot } from "./types";

const groupOrder = [
  "ARCHIVOS",
  "COBROS",
  "PAGOS",
  "REPORTES & MONITOREO",
] as const;
type NavGroup = (typeof groupOrder)[number];
const navigation: {
  key: string;
  page: Page;
  label: string;
  icon: typeof LayoutDashboard;
  group: NavGroup;
  primary?: boolean;
  badge?: "pendingCharges";
}[] = [
  {
    key: "collectors",
    page: "collectors",
    label: "Cobradores",
    icon: Users,
    group: "ARCHIVOS",
  },
  {
    key: "clients",
    page: "clients",
    label: "Clientes",
    icon: Users,
    group: "ARCHIVOS",
  },
  {
    key: "routes-zones",
    page: "routesZones",
    label: "Rutas y Zonas",
    icon: MapPinned,
    group: "ARCHIVOS",
  },
  {
    key: "services-products",
    page: "servicesProducts",
    label: "Servicios y Productos",
    icon: ListFilter,
    group: "ARCHIVOS",
  },
  {
    key: "late-reasons",
    page: "delayReasons",
    label: "Motivos de Atraso",
    icon: CircleAlert,
    group: "ARCHIVOS",
  },
  {
    key: "exchange-rates",
    page: "exchangeRates",
    label: "Tasas de Cambio",
    icon: RefreshCw,
    group: "ARCHIVOS",
  },
  {
    key: "system-users",
    page: "users",
    label: "Usuarios",
    icon: ShieldCheck,
    group: "ARCHIVOS",
  },
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
  {
    key: "monitor-zones",
    page: "monitorZones",
    label: "Monitor Z",
    icon: MapPinned,
    group: "REPORTES & MONITOREO",
  },
  {
    key: "monitor-routes",
    page: "monitorRoutes",
    label: "Monitor R",
    icon: MapPinned,
    group: "REPORTES & MONITOREO",
  },
  {
    key: "daily-settlements",
    page: "dailySettlements",
    label: "Cuadres Diarios",
    icon: FileCheck2,
    group: "REPORTES & MONITOREO",
  },
  {
    key: "general-reports",
    page: "reports",
    label: "Reportes",
    icon: ChartNoAxesCombined,
    group: "REPORTES & MONITOREO",
  },
];
const pageFromHash = (): Page =>
  navigation.some((n) => n.page === location.hash.slice(1))
    ? (location.hash.slice(1) as Page)
    : "monitorCollectors";
const pageTitles: Record<Page, string> = {
  collectors: "Cobradores",
  clients: "Clientes",
  routesZones: "Rutas y Zonas",
  servicesProducts: "Servicios y Productos",
  delayReasons: "Motivos de Atraso",
  exchangeRates: "Tasas de Cambio",
  users: "Usuarios",
  charges: "Cargos",
  recurringCharges: "Cargos Recurrentes",
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
type User = { id: string; name: string; role: string };
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

function Login({
  onLogin,
}: {
  onLogin: (user: User, station: Station) => void;
}) {
  const [email, setEmail] = useState("admin@cyp.local"),
    [password, setPassword] = useState("Demo-CyP-2026!"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function login() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ token: string; user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (result.user.role !== "admin")
        throw new Error(
          "Esta cuenta pertenece al portal de cobradores. Ingresa con una cuenta de administración.",
        );
      setToken(result.token);
      onLogin(result.user, stations[0]);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "No pudimos iniciar sesión.",
      );
    } finally {
      setBusy(false);
    }
  }
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
  const logout = useCallback(() => {
    clearToken();
    setAuthenticated(false);
    setSnapshot(null);
    setUser(null);
    setAccountOpen(false);
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
        if (next.role !== "admin") {
          logout();
          toast.error(
            "Usa una cuenta de administración para acceder a este portal.",
          );
        } else setUser(next);
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
  const activeNav =
    (activeNavKey && navigation.find((n) => n.key === activeNavKey)) ||
    navigation.find((n) => n.page === page && n.primary) ||
    navigation.find((n) => n.page === page)!;
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
                  activeNavKey ? activeNavKey === item.key : page === item.page,
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
                              : page === item.page
                                ? "active"
                                : ""
                          }`}
                          key={item.key}
                          onClick={() => navigate(item.page, item.key)}
                          title={collapsed ? item.label : undefined}
                          aria-current={
                            activeNavKey === item.key ||
                            (!activeNavKey && page === item.page)
                              ? "page"
                              : undefined
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
                          {(activeNavKey === item.key ||
                            (!activeNavKey && page === item.page)) && <i />}
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
                <button onClick={() => navigate("dailySettlements")}>
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
                  <strong>{activeNav?.label ?? pageTitles[page]}</strong>
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
                  className="profile-button"
                  onClick={() => setAccountOpen(true)}
                  aria-label="Abrir cuenta"
                >
                  <Avatar name={user?.name ?? "Administración"} index={3} />
                  <span className="user-chip-copy">
                    <strong>{user?.name ?? "Administración"}</strong>
                    <small>{user?.role ?? "admin"} · v1.0</small>
                  </span>
                  <ChevronDown size={13} />
                </button>
              </div>
            </header>
            <main id="main-content" className="main-content" tabIndex={-1}>
              {initialError && snapshot && (
                <div className="connection-error" role="alert">
                  <CircleAlert size={16} />
                  <span>
                    {initialError} Mostrando los últimos datos recibidos.
                  </span>
                  <button
                    className="text-button"
                    onClick={() => void refresh()}
                  >
                    Reintentar
                  </button>
                </div>
              )}
              {!snapshot ? (
                initialError ? (
                  <div className="panel initial-error">
                    <Empty
                      title="No pudimos conectar con tu operación"
                      text={initialError}
                      action={
                        <button
                          className="btn primary"
                          onClick={() => void refresh()}
                        >
                          <RefreshCw size={16} />
                          Volver a intentar
                        </button>
                      }
                    />
                  </div>
                ) : (
                  <Loading />
                )
              ) : (
                <ModuleRouter
                  page={page}
                  snapshot={snapshot}
                  refreshing={refreshing}
                  onRefresh={() => void refresh()}
                  onCollector={setSelectedCollector}
                  onOperation={setOperation}
                  onAccount={setAccountOperation}
                />
              )}
              <footer className="page-footer">
                <span>
                  <i />
                  Entorno de demostración · Datos ficticios
                </span>
                <span>
                  {lastUpdated
                    ? `Actualizado a las ${lastUpdated.toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" })}`
                    : "Conectando…"}
                  <span className="footer-dot">·</span>Hecho para estar en
                  control.
                </span>
              </footer>
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
                    navigate("clients");
                    setDirectorySearch(client.name);
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
                    navigate("routesZones");
                    const collector = snapshot?.collectors.find(
                      (c) => c.id === route.collectorId,
                    );
                    if (collector) setSelectedCollector(collector);
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
                  <button onClick={() => navigate("dailySettlements")}>
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
                  navigate("dailySettlements");
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

type TableRow = Record<string, ReactNode>;
type LegacyColumn = { key: string; label: string; align?: "right" | "center" };

type OperationSpec = {
  title: string;
  subtitle: string;
  filterTitle: string;
  modes: string[];
  columns: LegacyColumn[];
  rows: TableRow[];
  footer: { label: string; value: ReactNode }[];
  relationLabel?: string;
  details?: ReactNode;
};

type MonitorEntity = "collector" | "zone" | "route";
type MonitorRow = TableRow & {
  entityId: string;
  entityType: MonitorEntity;
  rawName: string;
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
  onRefresh,
  onCollector,
  onOperation,
  onAccount,
}: {
  page: Page;
  snapshot: Snapshot;
  refreshing: boolean;
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
        onCollector={onCollector}
        onAccount={onAccount}
      />
    );
  if (
    [
      "charges",
      "recurringCharges",
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
  onCollector,
  onAccount,
}: {
  page: Page;
  snapshot: Snapshot;
  onCollector: (collector: Collector) => void;
  onAccount: (operation: AccountOperation) => void;
}) {
  const [search, setSearch] = useState("");
  const config = masterSpec(page, snapshot, onAccount);
  const rows = config.rows.filter((row) =>
    Object.values(row).join(" ").toLowerCase().includes(search.toLowerCase()),
  );
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
        {page === "users" ? (
          <button
            className="btn primary"
            onClick={() => onAccount({ type: "create" })}
          >
            <Plus size={16} />
            Nueva cuenta
          </button>
        ) : (
          <button className="btn primary">
            <Plus size={16} />
            Nuevo registro
          </button>
        )}
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
          <button className="btn">
            <Download size={16} /> Exportar
          </button>
        </div>
        <LegacyTable columns={config.columns} rows={rows} />
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
    </>
  );
}

function LegacyOperationView({
  spec,
  onCreate,
  onRefresh,
}: {
  spec: OperationSpec;
  onCreate: () => void;
  onRefresh: () => void;
}) {
  const [mode, setMode] = useState(spec.modes[0] ?? "Todos"),
    [status, setStatus] = useState("Todos"),
    [query, setQuery] = useState("");
  const rows = spec.rows.filter((row) =>
    Object.values(row).join(" ").toLowerCase().includes(query.toLowerCase()),
  );
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
        className={`legacy-workspace ${spec.details ? "with-details" : ""}`}
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
            <input type="date" defaultValue="2026-09-01" />
          </label>
          <label className="field compact-field">
            Fecha Final
            <input type="date" defaultValue="2026-09-16" />
          </label>
          <label className="field compact-field">
            Estado
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option>Todos</option>
              <option>Pendiente</option>
              <option>Activo</option>
              <option>Cancelado</option>
              <option>Cerrado</option>
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
            <button title="Nuevo" onClick={onCreate}>
              <Plus size={16} />
            </button>
            <button title="Refrescar" onClick={onRefresh}>
              <RefreshCw size={16} />
            </button>
            <button title="Buscar">
              <Search size={16} />
            </button>
            <button title="Exportar">
              <Download size={16} />
            </button>
            <label className="legacy-toolbar-search">
              <Search size={15} />
              <input
                placeholder="Buscar en grilla..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          <LegacyTable columns={spec.columns} rows={rows} dense />
          <div className="legacy-footerbar">
            {spec.footer.map((item) => (
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
  );
}

function LegacyTable({
  columns,
  rows,
  dense = false,
}: {
  columns: LegacyColumn[];
  rows: TableRow[];
  dense?: boolean;
}) {
  return (
    <div className="table-scroll legacy-table-scroll">
      <table className={`data-table legacy-data-table ${dense ? "dense" : ""}`}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={column.align ? `align-${column.align}` : undefined}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={column.align ? `align-${column.align}` : undefined}
                >
                  {row[column.key] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
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
      modes: ["Todos", "Por Cliente", "Por Zona", "Por Ruta"],
      relationLabel: "Relación de Pago",
      columns: chargeColumns,
      rows: snapshot.charges.map((charge, index) => ({
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
  if (page === "collections") {
    const rows = snapshot.movements.filter(
      (movement) => movement.type === "collection",
    );
    return {
      title: "Cobros",
      subtitle: "Cobranza en calle y cobranza administrativa de respaldo.",
      filterTitle: "Filtro de Cobros",
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
    return {
      title: "Depósitos por Cobradores",
      subtitle: "Depósitos recibidos desde ruta, con panel de detalle lateral.",
      filterTitle: "Filtro de Depósitos",
      modes: ["Todos", "Por Cobrador"],
      columns: [
        { key: "n", label: "Nro." },
        { key: "date", label: "Fecha" },
        { key: "collector", label: "Cobrador" },
        { key: "currency", label: "Moneda" },
        { key: "amount", label: "Importe", align: "right" },
      ],
      rows: rows.map((movement, index) => ({
        n: index + 1,
        date: dateLabel(movement.createdAt.slice(0, 10)),
        collector: collector(movement.collectorId)?.name,
        currency: "DOP",
        amount: money(movement.amount),
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

function CobranzaMapasModal({ data, title }: { data: MapData; title: string }) {
  const pending = data.stops.filter((stop) => stop.status !== "paid"),
    obligated = data.stops.filter((stop) => stop.obligated),
    totalDue = data.stops.reduce((sum, stop) => sum + stop.amount_due, 0);
  const allPoints = [
    { lat: data.collector.lat, lng: data.collector.lng },
    ...data.stops,
  ];
  const minLat = Math.min(...allPoints.map((point) => point.lat)),
    maxLat = Math.max(...allPoints.map((point) => point.lat)),
    minLng = Math.min(...allPoints.map((point) => point.lng)),
    maxLng = Math.max(...allPoints.map((point) => point.lng));
  const pointStyle = (lat: number, lng: number) => ({
    top: `${86 - (((lat - minLat) / Math.max(maxLat - minLat, 0.001)) * 70 + 8)}%`,
    left: `${((lng - minLng) / Math.max(maxLng - minLng, 0.001)) * 78 + 9}%`,
  });
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
          <span
            className="collector-live-pin"
            style={pointStyle(data.collector.lat, data.collector.lng)}
          >
            <MapPinned size={16} />
          </span>
          {data.stops.map((stop) => (
            <button
              className={`stop-pin ${stop.status} ${stop.obligated ? "obligated" : ""}`}
              key={stop.id}
              style={pointStyle(stop.lat, stop.lng)}
              title={`${stop.order}. ${stop.client_name}`}
            >
              {stop.order}
            </button>
          ))}
          <div className="map-module-label">
            <strong>CobranzaMapas</strong>
            <span>Ruta calculada · {data.stops.length} PCP</span>
          </div>
        </section>
        <aside className="map-stops-panel">
          <div className="map-stops-heading">
            <strong>Paradas</strong>
            <span>{data.stops.length} puntos</span>
          </div>
          <div className="map-stops-list">
            {data.stops.map((stop) => (
              <button className="map-stop-row" key={stop.id}>
                <span className="stop-order">{stop.order}</span>
                <span>
                  <strong>{stop.client_name}</strong>
                  <small>
                    {stop.obligated ? "Obligado a cobrar" : "Cobro regular"} ·{" "}
                    {stop.status}
                  </small>
                </span>
                <strong>{moneyFromUnits(stop.amount_due)}</strong>
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
