import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  BellRing,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  CloudOff,
  Download,
  Eye,
  EyeOff,
  Fingerprint,
  Landmark,
  LoaderCircle,
  LocateFixed,
  LogOut,
  MapPin,
  Navigation,
  Phone,
  ReceiptText,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  Smartphone,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  ApiError,
  dateLabel,
  getToken,
  money,
  setToken,
  shortMoney,
} from "./api";
import { CollectionSheet } from "./CollectionSheet";
import { ReceiptView } from "./ReceiptView";
import RemittancesWorkspace from "../../shared/remittances/RemittancesWorkspace";
import { remittancesApi } from "./remittancesApi";
import { isMockToken } from "./mock";
import { GeoMap } from "../../client-admin/src/GeoMap";
import { locationUnavailable, locationError, validLocation } from "../../shared/geolocation";
import { INPUT_LIMITS, validateText } from "../../shared/inputRules";
import { transformRouteToMap } from "./services/mapAdapter";
import { businessDay as localDay, timeLabel } from "./services/dates";
import { pocketBalances } from "./services/pocket";
import type {
  Charge,
  Client,
  Collector,
  Operation,
  Snapshot,
  User,
} from "./types";
import { canAccessCollector, enrichUserRole, isSuspendedUser } from "./types";

const APP_BASE_URL = import.meta.env.BASE_URL;
type View = "route" | "payouts" | "receipts" | "pocket" | "remittances";
type Filter = "Todos" | "Pendientes" | "Cobrados" | "Con atraso";
type RouteMode = "Por rutas" | "Por zonas" | "Rutas y zonas";
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
const tabs = [
  { id: "route", name: "Mi ruta", icon: Route },
  { id: "payouts", name: "Pagos", icon: ArrowUpRight },
  { id: "receipts", name: "Recibos", icon: ReceiptText },
  { id: "remittances", name: "Envíos", icon: ArrowRight },
  { id: "pocket", name: "Mi bolsillo", icon: Wallet },
] as const;
const getView = (): View => {
  const view = new URLSearchParams(location.search).get("view");
  return tabs.some((tab) => tab.id === view) ? (view as View) : "route";
};
export function App() {
  const [user, setUser] = useState<User | null>(null);
  const currentUser = useRef<User | null>(user);
  currentUser.current = user;
  const [authenticating, setAuthenticating] = useState(!!getToken());
  const [authError, setAuthError] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [view, setView] = useState<View>(getView);
  const viewPanel = useRef<HTMLElement | null>(null);
  const viewAnimation = useRef<Animation | null>(null);
  const pendingViewMotion = useRef<{ direction: number; from?: Keyframe } | null>(null);
  const [receiptToken, setReceiptToken] = useState<string | null>(() =>
    new URLSearchParams(location.search).get("receipt"),
  );
  const [operation, setOperation] = useState<Operation | null>(null);
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [installHelp, setInstallHelp] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [trackingBusy, setTrackingBusy] = useState(false);
  const trackingRef = useRef<number | null>(null);
  const lastLocationSent = useRef(0);
  const [trackingDetail, setTrackingDetail] = useState("");

  useLayoutEffect(() => {
    const motion = pendingViewMotion.current;
    pendingViewMotion.current = null;
    const panel = viewPanel.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!motion || !panel?.animate || reducedMotion.matches) return;

    const animation = panel.animate(
      [
        motion.from ?? { opacity: 0.55, transform: `translateX(${motion.direction * 8}px)` },
        { opacity: 1, transform: "translateX(0)" },
      ],
      { id: "collector-tab-transition", duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    viewAnimation.current = animation;
    const stopMotion = () => animation.cancel();
    reducedMotion.addEventListener("change", stopMotion);
    return () => {
      animation.cancel();
      viewAnimation.current = null;
      reducedMotion.removeEventListener("change", stopMotion);
    };
  }, [view]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    const pop = () => {
      setView(getView());
      setReceiptToken(new URLSearchParams(location.search).get("receipt"));
    };
    const install = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallEvent);
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener("popstate", pop);
    window.addEventListener("beforeinstallprompt", install);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("popstate", pop);
      window.removeEventListener("beforeinstallprompt", install);
    };
  }, []);
  const authenticate = useCallback(async () => {
    if (!getToken()) return;
    setAuthenticating(true);
    setAuthError("");
    try {
      const result = await api<User | { user: User }>("/auth/me");
      const candidate = "user" in result ? result.user : result;
      const next = enrichUserRole(candidate);
      if (isSuspendedUser(next))
        throw new ApiError("Cuenta o empresa suspendida.", 401);
      if (!canAccessCollector(next))
        throw new ApiError(
          "Usa una cuenta de cobrador para entrar a este portal.",
          401,
        );
      setUser(next);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setToken(null);
      setAuthError(
        err instanceof Error ? err.message : "No se pudo verificar la sesión.",
      );
    } finally {
      setAuthenticating(false);
    }
  }, []);
  useEffect(() => {
    void authenticate();
  }, [authenticate]);
  const refresh = useCallback(
    async (quiet = false) => {
      if (!user || !navigator.onLine) return;
      if (!quiet) setLoading(true);
      try {
        const data = await api<Snapshot>("/snapshot");
        if (currentUser.current?.id !== user.id) return;
        setSnapshot(data);
        setError("");
      } catch (err) {
        if (currentUser.current?.id !== user.id) return;
        if (err instanceof ApiError && err.status === 401) {
          setToken(null);
          setUser(null);
          setSnapshot(null);
          toast.error("Tu sesión venció. Vuelve a entrar.");
        } else
          setError(
            err instanceof Error
              ? err.message
              : "No pudimos actualizar tu ruta.",
          );
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [user],
  );
  useEffect(() => {
    if (user && online) void refresh();
  }, [user, online, refresh]);
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine)
        void refresh(true);
    }, 30000);
    return () => window.clearInterval(interval);
  }, [refresh]);
  useEffect(
    () => () => {
      if (trackingRef.current !== null)
        navigator.geolocation.clearWatch(trackingRef.current);
    },
    [],
  );

  function navigate(next: View, pointerInitiated = false) {
    if (next === view && !receiptToken) return;
    const interrupted = viewAnimation.current?.playState === "running" && viewPanel.current
      ? getComputedStyle(viewPanel.current)
      : null;
    pendingViewMotion.current = pointerInitiated && next !== view && snapshot
      ? {
          direction: Math.sign(tabs.findIndex((tab) => tab.id === next) - tabs.findIndex((tab) => tab.id === view)),
          from: interrupted ? { opacity: interrupted.opacity, transform: interrupted.transform } : undefined,
        }
      : null;
    setView(next);
    setReceiptToken(null);
    history.pushState(
      {},
      "",
      next === "route" ? APP_BASE_URL : `${APP_BASE_URL}?view=${next}`,
    );
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function openReceipt(token: string) {
    setReceiptToken(token);
    history.pushState({}, "", `${APP_BASE_URL}?receipt=${encodeURIComponent(token)}`);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function stopTracking() {
    if (trackingRef.current !== null)
      navigator.geolocation.clearWatch(trackingRef.current);
    trackingRef.current = null;
    setTracking(false);
    setTrackingBusy(false);
  }
  function toggleTracking() {
    if (tracking || trackingBusy) {
      stopTracking();
      toast("Ubicación compartida detenida");
      return;
    }
    const unavailable = locationUnavailable();
    if (unavailable) {
      setTrackingDetail(unavailable);
      toast.error(unavailable);
      return;
    }
    if (!online) {
      toast.error("Conéctate para compartir tu ubicación.");
      return;
    }
    setTrackingBusy(true);
    setTrackingDetail("Solicitando permiso y señal GPS…");
    lastLocationSent.current = 0;
    trackingRef.current = navigator.geolocation.watchPosition(
      (position) => {
        if (!navigator.onLine || Date.now() - lastLocationSent.current < 45000)
          return;
        lastLocationSent.current = Date.now();
        void remittancesApi("/tracking", {
          method: "POST",
          body: JSON.stringify({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          }),
        })
          .then(() => {
            if (trackingRef.current !== null) {
              setTracking(true);
              setTrackingBusy(false);
              setTrackingDetail(`Ubicación enviada ${timeLabel(new Date())} · precisión aproximada ${Math.round(position.coords.accuracy)} m`);
            }
          })
          .catch((err) => {
            stopTracking();
            setTrackingDetail("No se confirmó el envío de ubicación. Revisa la conexión y vuelve a activar GPS.");
            lastLocationSent.current = 0;
            toast.error(
              err instanceof Error
                ? err.message
                : "No se pudo compartir tu ubicación.",
            );
          });
      },
      (error) => {
        stopTracking();
        setTrackingDetail(locationError(error));
        toast.error(locationError(error));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  }
  async function install() {
    if (installEvent) {
      await installEvent.prompt();
      await installEvent.userChoice;
      setInstallEvent(null);
    } else setInstallHelp(true);
  }
  function logout() {
    const token = getToken();
    // Capture authorization before cleaning up the local session and GPS watcher.
    const remote = token && !isMockToken(token)
      ? remittancesApi<{ id: string; closed: boolean }>("/auth/logout", { method: "POST", body: "{}" })
      : null;
    currentUser.current = null;
    stopTracking();
    setToken(null);
    setUser(null);
    setSnapshot(null);
    setOperation(null);
    navigate("route");
    if (remote) void remote.then((result) => {
      if (!result?.closed || !result.id) throw new Error("Cierre remoto no confirmado.");
    }).catch(() => toast.warning("La sesión se cerró en este dispositivo. No pudimos confirmar su cierre en el servidor; podría seguir activa hasta vencer."));
  }
  if (receiptToken)
    return (
      <ReceiptView
        token={receiptToken}
        onBack={user ? () => navigate("route") : undefined}
      />
    );
  if (authenticating)
    return (
      <div className="fullscreen-state">
        <div className="logo-mark">
          <ArrowRight />
        </div>
        <LoaderCircle className="spin" />
        <p>Preparando tu jornada…</p>
      </div>
    );
  if (!user)
    return (
      <Login
        onLogin={setUser}
        online={online}
        initialError={authError}
        onRetry={getToken() ? () => void authenticate() : undefined}
      />
    );

  const collector = snapshot?.collectors.find(
    (item) => item.id === user.collectorId,
  );
  const assignedRoute = snapshot?.routes.find(
    (item) => item.id === collector?.routeId,
  );
  const maxCash =
    (collector?.collectionLimit ?? 0) + (collector?.payoutLimit ?? 0);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Saltar al contenido
      </a>
      {(isMockToken(getToken()) || snapshot?.clients.some((client) => /PRUEBA|SINT[ÉE]TIC|DEMO/i.test(client.note ?? ""))) && <div className="demo-strip"><span />DATOS DE PRUEBA</div>}
      <header className="app-header">
        <div className="header-top">
          <a
            className="brand"
            href={APP_BASE_URL}
            onClick={(event) => {
              event.preventDefault();
              navigate("route", event.detail > 0);
            }}
            aria-label="CyP, ir a mi ruta"
          >
            <span className="logo-mark">
              <ArrowRight size={22} />
            </span>
            <span className="brand-word">
              cyp<span>.</span>
            </span>
            <span className="brand-divider" />
            <span className="brand-subtitle">EN RUTA</span>
          </a>
          <div className="header-actions">
            <button
              className="icon-button"
              aria-label="Actualizar datos"
              onClick={() => void refresh()}
              disabled={loading || !online}
            >
              <RefreshCw size={19} className={loading ? "spin" : ""} />
            </button>
            <button
              className="avatar"
              aria-label="Ver mi bolsillo y perfil"
              onClick={(event) => navigate("pocket", event.detail > 0)}
            >
              {collector?.initials ??
                user.name
                  .split(" ")
                  .map((word) => word[0])
                  .slice(0, 2)
                  .join("")}
            </button>
          </div>
        </div>
        <button className="cash-pill" onClick={(event) => navigate("pocket", event.detail > 0)}>
          <span className="cash-pill-icon">
            <Wallet size={17} />
          </span>
          <span>
            <strong>{money(collector?.cashInHand ?? 0)}</strong>
            <span> en mano</span>
          </span>
          <span className="cash-divider" />
          <span className="cash-limit">Máx. {shortMoney(maxCash)}</span>
          <ChevronRight size={17} />
        </button>
      </header>
      {!online && (
        <div className="offline-banner" role="status">
          <CloudOff size={18} />
          <span>
            Sin conexión · Solo lectura. Los movimientos requieren conexión.
          </span>
        </div>
      )}
      <main id="main" className="main-content" ref={viewPanel}>
        {error && (
          <div className="error-banner" role="alert">
            <CircleAlert size={19} />
            <p>
              {error}
              {snapshot &&
                " Los importes visibles pueden no estar actualizados."}
            </p>
            <button
              className="text-button"
              onClick={() => void refresh()}
              disabled={!online || loading}
            >
              Reintentar
            </button>
          </div>
        )}
        {!snapshot ? (
          loading ? (
            <LoadingCards />
          ) : (
            <EmptyState
              icon={CloudOff}
              title="Tu ruta está pendiente de cargar"
              text={
                online
                  ? "Actualiza para consultar tu jornada."
                  : "Conéctate para obtener tus datos de forma segura."
              }
              action={
                <button
                  className="primary"
                  disabled={!online}
                  onClick={() => void refresh()}
                >
                  Cargar mi ruta
                </button>
              }
            />
          )
        ) : (
          <>
            {view === "route" && (
              <RouteView
                snapshot={snapshot}
                user={user}
                routeName={assignedRoute?.name ?? "Mi ruta"}
                sector={assignedRoute?.sector ?? ""}
                online={online}
                onCollect={setOperation}
              />
            )}
            {view === "payouts" && (
              <PayoutsView
                snapshot={snapshot}
                online={online}
                onPay={setOperation}
              />
            )}
            {view === "receipts" && (
              <ReceiptsView snapshot={snapshot} onOpen={openReceipt} />
            )}
            {view === "remittances" && user && <RemittancesWorkspace api={remittancesApi} user={user} isAdmin={String(user.role).toUpperCase().replace("ROLE_", "") === "SUPERADMIN"} />}
            {view === "pocket" && (
              <PocketView
                snapshot={snapshot}
                collector={collector}
                user={user}
                tracking={tracking}
                trackingBusy={trackingBusy}
                online={online}
                onTracking={toggleTracking}
                onInstall={() => void install()}
                onLogout={logout}
              />
            )}
          </>
        )}
        {view === "pocket" && trackingDetail && <p className="location-feedback" role="status">{trackingDetail}</p>}
        <div className="content-end">
          <ShieldCheck size={14} />
          <span>CyP · Cobros y pagos, bajo control.</span>
        </div>
      </main>
      <nav className="bottom-nav" aria-label="Navegación principal">
        {tabs.map(({ id, name, icon: Icon }) => (
          <button
            key={id}
            className={view === id ? "active" : ""}
            aria-label={name}
            aria-current={view === id ? "page" : undefined}
            onClick={(event) => navigate(id, event.detail > 0)}
          >
            <span>
              <Icon size={23} />
            </span>
            {name}
          </button>
        ))}
      </nav>
      {operation && (
        <CollectionSheet
          key={`${user.id}-${operation.kind}-${operation.id}`}
          actorId={user.id}
          operation={operation}
          online={online}
          onClose={() => setOperation(null)}
          onSuccess={(token) => {
            setOperation(null);
            void refresh();
            openReceipt(token);
          }}
        />
      )}
      <Dialog.Root open={installHelp} onOpenChange={setInstallHelp}>
        <Dialog.Portal>
          <Dialog.Overlay className="sheet-overlay" />
          <Dialog.Content className="sheet help-sheet">
            <div className="sheet-handle" />
            <div className="sheet-heading">
              <span className="action-icon green">
                <Smartphone />
              </span>
              <div>
                <Dialog.Title>Tu ruta a un toque</Dialog.Title>
                <Dialog.Description>
                  Instala CyP desde el navegador.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  className="icon-button"
                  aria-label="Cerrar instrucciones"
                >
                  <X />
                </button>
              </Dialog.Close>
            </div>
            <p>
              En iPhone, abre el menú Compartir de Safari y elige «Agregar a
              inicio». En Android, abre el menú del navegador y elige «Instalar
              aplicación» o «Agregar a pantalla principal».
            </p>
            <p>
              La instalación requiere HTTPS o localhost y un navegador
              compatible. La aplicación conserva sus recursos visuales; para
              consultar datos y registrar operaciones necesitas conexión.
            </p>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function Login({
  onLogin,
  online,
  initialError,
  onRetry,
}: {
  onLogin: (user: User) => void;
  online: boolean;
  initialError: string;
  onRetry?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  useEffect(() => setError(initialError), [initialError]);
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      validateText(email, "Usuario / Email", INPUT_LIMITS.email, { required: true });
      if (!password || password.length > INPUT_LIMITS.password)
        throw new Error(`Escribe una contraseña de hasta ${INPUT_LIMITS.password} caracteres.`);
      const result = await api<{ token: string; user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
        }),
      });
      const next = enrichUserRole(result.user);
      if (isSuspendedUser(next))
        throw new Error("Cuenta o empresa suspendida.");
      if (!canAccessCollector(next))
        throw new Error(
          "Esta cuenta corresponde a administración. Entra con una cuenta de cobrador.",
        );
      setToken(result.token);
      onLogin(next);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo iniciar sesión.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-hero" aria-hidden="true">
        <div className="brand">
          <span className="logo-mark">
            <ArrowRight />
          </span>
          <span className="brand-word">
            cyp<span>.</span>
          </span>
        </div>
        <div className="login-eyebrow">
          <span /> TU OFICINA, EN EL BOLSILLO
        </div>
        <h1>
          Una buena ruta.
          <br />
          Todo en orden<span>.</span>
        </h1>
        <p>
          Cobra, entrega y sigue tu jornada con la tranquilidad de tener cada
          movimiento bajo control.
        </p>
        <div className="login-visual" aria-hidden="true">
          <div className="route-dotted" />
          <span className="visual-pin pin-one">
            <MapPin />
          </span>
          <span className="visual-pin pin-two">
            <Check />
          </span>
          <div className="visual-balance">
            <span>
              <Wallet size={18} /> Efectivo bajo control
            </span>
            <strong>Tu jornada, más simple.</strong>
            <div>
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
        <div className="login-assurance">
          <ShieldCheck size={20} />
          <span>Una cuenta. Tu ruta. Cada recibo.</span>
        </div>
      </section>
      <section className="login-form-section">
        <div className="login-form-top">
          <div className="brand">
            <span className="logo-mark">
              <ArrowRight />
            </span>
            <span className="brand-word">
              cyp<span>.</span>
            </span>
          </div>
          <h2>Cobros y Pagos — Acceso del Cobrador</h2>
          <p>Ingrese sus credenciales para continuar.</p>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            Usuario / Email
            <input
              type="text"
              required
              autoComplete="username"
              maxLength={INPUT_LIMITS.email}
              placeholder="usuario@empresa.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Contraseña
            <span className="password-wrap">
              <input
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                maxLength={INPUT_LIMITS.password}
                placeholder="Tu contraseña"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={
                  showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
                }
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </span>
          </label>
          {!online && (
            <p className="inline-error">
              <CloudOff size={17} />
              Conéctate para iniciar sesión.
            </p>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" type="submit" disabled={busy || !online}>
            {busy ? (
              <LoaderCircle className="spin" size={20} />
            ) : (
              <>
                Entrar a mi ruta
                <ArrowRight size={20} />
              </>
            )}
          </button>
        </form>
        {onRetry && (
          <button
            className="text-button retry-session"
            onClick={onRetry}
            disabled={!online || busy}
          >
            Verificar mi sesión guardada
          </button>
        )}
        <p className="login-note">Accede con la cuenta habilitada por el administrador.</p>
        <footer>
          <Fingerprint size={18} />
          Cobros y Pagos Móviles
        </footer>
      </section>
    </main>
  );
}

function RouteView({
  snapshot,
  user,
  routeName,
  sector,
  online,
  onCollect,
}: {
  snapshot: Snapshot;
  user: User;
  routeName: string;
  sector: string;
  online: boolean;
  onCollect: (operation: Operation) => void;
}) {
  const [filter, setFilter] = useState<Filter>("Todos");
  const [query, setQuery] = useState("");
  const [nextClientId, setNextClientId] = useState<string | null>(null);
  const [display, setDisplay] = useState<"map" | "list">("map");
  const [routeMode, setRouteMode] = useState<RouteMode>("Por rutas");
  const [delayReasons, setDelayReasons] = useState<Record<string, string>>({});
  const [delaySelector, setDelaySelector] = useState<{
    clientId: string;
    chargeId: string;
  } | null>(null);
  const [gpsStatus, setGpsStatus] = useState("GPS sin solicitar");
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const locate = () => {
    const unavailable = locationUnavailable();
    if (unavailable) {
      setGpsStatus(unavailable);
      return;
    }
    setGpsStatus("Solicitando permiso y señal GPS…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setOrigin({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setGpsStatus(`GPS obtenido · precisión aproximada ${Math.round(position.coords.accuracy)} m`);
      },
      (error) => setGpsStatus(locationError(error)),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  };
  const charges = snapshot.charges.filter(
    (charge) => charge.status !== "cancelled",
  );
  const total = charges.length;
  const paid = charges.filter((charge) => charge.status === "paid").length;
  const pending = charges.filter((charge) => charge.status !== "paid");
  const collected = snapshot.movements
    .filter(
      (item) =>
        item.type === "collection" &&
        localDay(item.createdAt) === snapshot.businessDate,
    )
    .reduce((sum, item) => sum + item.amount, 0);
  const list = snapshot.clients
    .map((client) => ({
      client,
      charges: charges.filter((charge) => charge.clientId === client.id),
    }))
    .filter(
      ({ client, charges: rows }) =>
        rows.length &&
        `${client.name} ${client.address} ${rows.map((row) => row.service).join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (filter === "Todos" ||
          (filter === "Cobrados" &&
            rows.every((row) => row.status === "paid")) ||
          (filter === "Pendientes" &&
            rows.some((row) => row.status !== "paid")) ||
          (filter === "Con atraso" &&
            rows.some(
              (row) =>
                row.status !== "paid" && row.dueDate < snapshot.businessDate,
            ))),
    );
  const progress = total ? Math.round((paid / total) * 100) : 0;
  const pendingStops = list.filter(({ charges: rows }) =>
    rows.some((row) => row.status !== "paid"),
  );
  const currentStop = pendingStops.find(({ client }) => client.id === nextClientId) ?? pendingStops[0];
  const currentCharge = currentStop?.charges.find(
    (row) => row.status !== "paid",
  );
  const routeMap = transformRouteToMap(
    list.filter(({ client }) => validLocation(client.lat, client.lng)).map(({ client, charges: rows }, index) => {
      const pendingCharge =
        rows.find((row) => row.status !== "paid") ?? rows[0];
      return {
        id: client.id,
        order: index + 1,
        clientName: client.name,
        lat: client.lat!,
        lng: client.lng!,
        amountDue: rows.reduce(
          (sum, row) => sum + row.amount - row.collected,
          0,
        ),
        status: delayReasons[pendingCharge?.id]
          ? "late"
          : rows.every((row) => row.status === "paid")
            ? "paid"
            : "pending",
        obligated: rows.some((row) => row.required),
        delayReason: delayReasons[pendingCharge?.id],
      };
    }),
  );
  const missingLocations = list.length - routeMap.waypoints.length;
  return (
    <>
      <div className="page-greeting">
        <div>
          <p className="eyebrow">
            {dateLabel(snapshot.businessDate).toUpperCase()}
          </p>
          <h1>
            Hola, {user.name.split(" ")[0]} <span className="greeting-dot" />
          </h1>
          <p>Tu ruta, cobros y recibos listos para trabajar.</p>
        </div>
        <span className="day-status">
          <span />
          {gpsStatus}
        </span>
      </div>
      <div className="route-mode-tabs" role="group" aria-label="Modo de ruta">
        {(["Por rutas", "Por zonas", "Rutas y zonas"] as RouteMode[]).map(
          (item) => (
            <button
              key={item}
              className={routeMode === item ? "selected" : ""}
              onClick={() => setRouteMode(item)}
            >
              {item}
            </button>
          ),
        )}
      </div>
      <section className="journey-card">
        <div className="journey-top">
          <span>
            <ArrowDownLeft size={17} />
            Cobrado hoy
          </span>
          <span className="journey-date">TU JORNADA</span>
        </div>
        <div className="journey-amount">
          {money(collected)}
          <span>
            <ArrowUpRight size={25} />
          </span>
        </div>
        <div className="journey-divider" />
        <div className="journey-progress-label">
          <span>
            {paid} de {total} cargos cobrados
          </span>
          <strong>{progress}%</strong>
        </div>
        <div className="progress-track">
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="journey-bottom">
          <span>
            <Clock3 size={14} />
            {pending.length} por completar
          </span>
          <span>
            Un paso a la vez
            <ArrowRight size={14} />
          </span>
        </div>
      </section>
      <section className="route-metrics">
        <div>
          <span>Clientes ubicados</span>
          <strong>{routeMap.waypoints.length} con GPS</strong>
        </div>
        <div>
          <span>Ubicación pendiente</span>
          <strong>{missingLocations} sin GPS</strong>
        </div>
        <div>
          <span>Pendientes / Procesadas</span>
          <strong>
            {pending.length}/{paid}
          </strong>
        </div>
      </section>
      <section className="assigned-route">
        <div className="route-illustration" aria-hidden="true">
          <span />
          <i />
          <b />
          <Navigation size={20} />
        </div>
        <div>
          <p>RUTA ASIGNADA</p>
          <h2>{routeName}</h2>
          <span>
            {sector || "Tu zona de trabajo"} · {snapshot.clients.filter((client) => client.active !== false).length}{" "}
            clientes
          </span>
        </div>
        <span className="route-number">
          <MapPin size={19} />
        </span>
      </section>
      <section className="collector-route-panel">
        <div className="route-panel-header">
          <div>
            <span>CobranzaMapas</span>
            <strong>{routeMode}</strong>
          </div>
          <button
            className="secondary map-toggle"
            onClick={() => setDisplay(display === "map" ? "list" : "map")}
          >
            {display === "map" ? "Ver Lista" : "Ver Mapa"}
          </button>
        </div>
        {display === "map" ? (
          <div className="real-route-map">
            <GeoMap points={[
              ...routeMap.markers.map((marker) => ({ id: marker.id, lat: marker.lat, lng: marker.lng, label: marker.clientName, detail: marker.popupSubtitle, kind: marker.status === "paid" ? "paid" as const : "pending" as const })),
              ...(origin ? [{ id: "my-location", ...origin, label: "Mi ubicación GPS", kind: "operator" as const }] : []),
            ]} />
            <button className="secondary" type="button" onClick={locate}>Obtener mi ubicación GPS</button>
            <p className="location-feedback" role="status">{gpsStatus}</p>
            {missingLocations > 0 && <p>{missingLocations} cliente(s) sin coordenadas registradas. Puedes ver sus datos en la lista.</p>}
            {list.some(({ client }) => /PRUEBA|SINT[ÉE]TIC|DEMO/i.test(client.note ?? "")) && <p className="location-feedback">DATOS DE PRUEBA: las ubicaciones de ejemplo sirven para revisar la aplicación.</p>}
          </div>
        ) : (
          <div className="compact-route-list">
            {list.slice(0, 5).map(({ client, charges: rows }, index) => (
              <div key={client.id}>
                <strong>#{index + 1}</strong>
                <span>{client.name}</span>
                <small>
                  {money(
                    rows.reduce(
                      (sum, row) => sum + row.amount - row.collected,
                      0,
                    ),
                  )}
                </small>
              </div>
            ))}
          </div>
        )}
      </section>
      {currentStop && currentCharge && (
        <section className="current-stop-sheet">
          <div>
            <span>
              #{list.indexOf(currentStop) + 1} · {currentStop.client.name}
            </span>
            {currentCharge.required && (
              <strong>Prioridad / Obligado a cobrar</strong>
            )}
          </div>
          <label>
            Cuota exigible
            <input
              readOnly
              inputMode="decimal"
              value={(currentCharge.amount - currentCharge.collected) / 100}
            />
          </label>
          <div className="current-stop-actions">
            <button
              className="primary"
              disabled={!online}
              onClick={() =>
                onCollect({
                  id: currentCharge.id,
                  clientName: currentStop.client.name,
                  concept: currentCharge.service,
                  outstanding: currentCharge.amount - currentCharge.collected,
                  kind: "collection",
                })
              }
            >
              Registrar Cobro
            </button>
            <button
              className="amber-action"
              disabled={!online}
              onClick={() =>
                setDelaySelector({
                  clientId: currentStop.client.id,
                  chargeId: currentCharge.id,
                })
              }
            >
              Sin Cobro / Atraso
            </button>
            <button className="secondary" disabled={pendingStops.length < 2}
              onClick={() => {
                const index = pendingStops.indexOf(currentStop);
                setNextClientId(pendingStops[(index + 1) % pendingStops.length].client.id);
              }}>Omitir / Siguiente</button>
          </div>
        </section>
      )}
      {delaySelector && (
        <Dialog.Root
          open
          onOpenChange={(open) => !open && setDelaySelector(null)}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="sheet-overlay" />
            <Dialog.Content className="sheet delay-reason-sheet">
              <div className="sheet-handle" />
              <Dialog.Title>Motivo de atraso</Dialog.Title>
              <Dialog.Description>
                Selecciona por qué no fue posible cobrar esta parada.
              </Dialog.Description>
              {["Local cerrado", "Cliente ausente", "Promesa de pago"].map(
                (reason) => (
                  <button
                    className="delay-reason-option"
                    key={reason}
                    onClick={() => {
                      setDelayReasons((items) => ({
                        ...items,
                        [delaySelector.chargeId]: reason,
                      }));
                      toast.info(`Atraso guardado: ${reason}`);
                      setDelaySelector(null);
                    }}
                  >
                    {reason}
                  </button>
                ),
              )}
              <button
                className="secondary"
                onClick={() => setDelaySelector(null)}
              >
                Cancelar
              </button>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
      <div className="section-heading">
        <h2>
          Mis paradas <span>{list.length}</span>
        </h2>
        <span>Orden de ruta</span>
      </div>
      <label className="search-box">
        <Search size={20} />
        <input
          placeholder="Buscar cliente o servicio"
          aria-label="Buscar cliente o servicio"
          maxLength={INPUT_LIMITS.name}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button
            className="icon-button"
            aria-label="Limpiar búsqueda"
            onClick={() => setQuery("")}
          >
            <X size={17} />
          </button>
        )}
      </label>
      <div className="filter-tabs" role="group" aria-label="Filtrar paradas">
        {(["Todos", "Pendientes", "Cobrados", "Con atraso"] as Filter[]).map(
          (item) => (
            <button
              key={item}
              aria-pressed={filter === item}
              className={filter === item ? "selected" : ""}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ),
        )}
      </div>
      <div className="stop-list">
        {list.length ? (
          list.map(({ client, charges: rows }, index) => (
            <StopCard
              key={client.id}
              client={client}
              charges={rows}
              index={index}
              businessDate={snapshot.businessDate}
              online={online}
              onCollect={onCollect}
            />
          ))
        ) : (
          <EmptyState
            icon={BadgeCheck}
            title={
              filter === "Con atraso"
                ? "Todo al día por aquí"
                : "No hay paradas para mostrar"
            }
            text={
              query
                ? "Prueba con otro nombre o servicio."
                : "Los clientes aparecerán aquí cuando tengan cargos asignados."
            }
            action={
              filter !== "Todos" ? (
                <button
                  className="text-button"
                  onClick={() => setFilter("Todos")}
                >
                  Ver todas las paradas
                  <ArrowRight size={17} />
                </button>
              ) : undefined
            }
          />
        )}
      </div>
    </>
  );
}

function StopCard({
  client,
  charges,
  index,
  businessDate,
  online,
  onCollect,
}: {
  client: Client;
  charges: Charge[];
  index: number;
  businessDate: string;
  online: boolean;
  onCollect: (operation: Operation) => void;
}) {
  const allPaid = charges.every((charge) => charge.status === "paid");
  const priority = charges.some(
    (charge) => charge.required && charge.status !== "paid",
  );
  return (
    <article className={`stop-card ${allPaid ? "is-paid" : ""}`}>
      <div className="stop-top">
        <span className={`stop-number ${allPaid ? "done" : ""}`}>
          {allPaid ? <Check size={20} /> : String(index + 1).padStart(2, "0")}
        </span>
        <div className="stop-client">
          <h3>{client.name}</h3>
          <p>{client.code}</p>
        </div>
        {priority ? (
          <span className="priority-badge">
            <BellRing size={12} />
            Obligado a cobrar
          </span>
        ) : allPaid ? (
          <span className="paid-badge">Cobrado</span>
        ) : (
          <span className="pending-badge">Pendiente</span>
        )}
      </div>
      <a
        className="stop-address"
        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(validLocation(client.lat, client.lng) ? `${client.lat},${client.lng}` : client.address)}`}
        target="_blank"
        rel="noreferrer"
      >
        <MapPin size={15} />
        <span>{client.address}</span>
        <ArrowUpRight size={14} />
      </a>
      {charges.map((charge) => {
        const late = charge.status !== "paid" && charge.dueDate < businessDate;
        return (
          <div className="stop-charge" key={charge.id}>
            <div className="charge-description">
              <span>{charge.service}</span>
              <p>
                {charge.status === "paid" ? (
                  <>
                    <Check size={12} />
                    Completado
                  </>
                ) : late ? (
                  <>
                    <CircleAlert size={12} />
                    <span className="late-text">
                      Con atraso · {dateLabel(charge.dueDate)}
                    </span>
                  </>
                ) : charge.status === "partial" ? (
                  "Abono registrado"
                ) : (
                  `Vence ${dateLabel(charge.dueDate)}`
                )}
              </p>
            </div>
            <div className="charge-amount">
              <strong>
                {money(
                  charge.status === "paid"
                    ? charge.amount
                    : charge.amount - charge.collected,
                )}
              </strong>
              <span>
                {charge.status === "paid" ? "total recibido" : "por cobrar"}
              </span>
            </div>
            {charge.status !== "paid" && (
              <button
                className="collect-button"
                disabled={!online}
                onClick={() =>
                  onCollect({
                    id: charge.id,
                    clientName: client.name,
                    concept: charge.service,
                    outstanding: charge.amount - charge.collected,
                    kind: "collection",
                  })
                }
              >
                Cobrar
                <ArrowRight size={17} />
              </button>
            )}
          </div>
        );
      })}
      <div className="stop-footer">
        <span>
          <ShieldCheck size={13} />
          {allPaid ? "Pago registrado" : "Recibo digital al cobrar"}
        </span>
        {client.phone && (
          <a
            href={`tel:${client.phone.replace(/[^+\d]/g, "")}`}
            aria-label={`Llamar a ${client.name}`}
          >
            <Phone size={14} />
            Llamar
          </a>
        )}
      </div>
    </article>
  );
}

function PayoutsView({
  snapshot,
  online,
  onPay,
}: {
  snapshot: Snapshot;
  online: boolean;
  onPay: (operation: Operation) => void;
}) {
  const pending = snapshot.payouts.filter(
    (item) => item.status === "pending" || item.status === "partial",
  );
  const total = pending.reduce((sum, item) => sum + item.amount - item.paid, 0);
  return (
    <>
      <PageTitle
        eyebrow="ENTREGAS A CLIENTES"
        title="Pagos pendientes"
        description="Cada entrega, con su comprobante."
      />
      <div className="light-summary">
        <span className="action-icon blue">
          <ArrowUpRight />
        </span>
        <div>
          <p>Por entregar</p>
          <strong>{money(total)}</strong>
        </div>
        <span>{pending.length} pagos</span>
      </div>
      <div className="section-heading">
        <h2>Tu lista de pagos</h2>
      </div>
      {pending.length ? (
        pending.map((item) => {
          const client = snapshot.clients.find(
            (client) => client.id === item.clientId,
          );
          return (
            <article key={item.id} className="payout-card">
              <div className="stop-top">
                <span className="action-icon blue">
                  <Banknote size={23} />
                </span>
                <div className="stop-client">
                  <h3>{client?.name ?? "Cliente"}</h3>
                  <p>{item.concept}</p>
                </div>
              </div>
              <div className="payout-bottom">
                <div>
                  <span>
                    {item.status === "partial"
                      ? "Saldo por entregar"
                      : "Importe a entregar"}
                  </span>
                  <strong>{money(item.amount - item.paid)}</strong>
                </div>
                <button
                  className="primary compact"
                  disabled={!online}
                  onClick={() =>
                    onPay({
                      id: item.id,
                      clientName: client?.name ?? "Cliente",
                      concept: item.concept,
                      outstanding: item.amount - item.paid,
                      kind: "payout",
                    })
                  }
                >
                  Registrar pago
                  <ArrowUpRight size={18} />
                </button>
              </div>
            </article>
          );
        })
      ) : (
        <EmptyState
          icon={Check}
          title="Entregas al día"
          text="No tienes pagos pendientes. Las nuevas entregas asignadas por oficina aparecerán aquí."
        />
      )}
      <p className="info-note">
        <ShieldCheck size={18} />
        Solo podrás entregar efectivo disponible y dentro de tu límite
        autorizado.
      </p>
    </>
  );
}

function ReceiptsView({
  snapshot,
  onOpen,
}: {
  snapshot: Snapshot;
  onOpen: (token: string) => void;
}) {
  const [query, setQuery] = useState("");
  const rows = useMemo(
    () =>
      [...snapshot.movements]
        .filter((movement) => movement.receiptToken)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [snapshot],
  );
  const filtered = rows.filter((item) =>
    `${snapshot.clients.find((client) => client.id === item.clientId)?.name ?? ""} ${item.id}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <>
      <PageTitle
        eyebrow="CADA MOVIMIENTO CUENTA"
        title="Mis recibos"
        description="Consulta, comparte o imprime un comprobante."
      />
      <label className="search-box">
        <Search size={19} />
        <input
          aria-label="Buscar recibo"
          maxLength={INPUT_LIMITS.name}
          placeholder="Buscar cliente o referencia"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="section-heading">
        <h2>Actividad reciente</h2>
        <span>{filtered.length} recibos</span>
      </div>
      {filtered.length ? (
        <div className="receipt-list">
          {filtered.map((item) => (
            <button
              className="receipt-row"
              key={item.id}
              onClick={() => onOpen(item.receiptToken!)}
            >
              <span
                className={`action-icon ${item.type === "collection" ? "green" : "blue"}`}
              >
                {item.type === "collection" ? (
                  <ArrowDownLeft size={21} />
                ) : (
                  <ArrowUpRight size={21} />
                )}
              </span>
              <span>
                <strong>
                  {snapshot.clients.find(
                    (client) => client.id === item.clientId,
                  )?.name ?? "Cliente"}
                </strong>
                <small>
                  {item.type === "collection" ? "Cobro" : "Pago"} ·{" "}
                  {dateLabel(item.createdAt)}
                </small>
              </span>
              <span className="receipt-row-amount">
                <strong>{money(item.amount)}</strong>
                <small>
                  Ver recibo
                  <ChevronRight size={12} />
                </small>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={ReceiptText}
          title="Aquí estarán tus recibos"
          text={
            query
              ? "No encontramos un recibo con esa búsqueda."
              : "Cada cobro o pago confirmado genera su comprobante digital."
          }
        />
      )}
    </>
  );
}

function PocketView({
  snapshot,
  collector,
  user,
  tracking,
  trackingBusy,
  online,
  onTracking,
  onInstall,
  onLogout,
}: {
  snapshot: Snapshot;
  collector?: Collector;
  user: User;
  tracking: boolean;
  trackingBusy: boolean;
  online: boolean;
  onTracking: () => void;
  onInstall: () => void;
  onLogout: () => void;
}) {
  const { collectionCash, payoutCash } = pocketBalances(snapshot.movements, collector?.id);
  return (
    <>
      <PageTitle
        eyebrow="TU EFECTIVO, CLARO"
        title="Mi bolsillo"
        description="Tu saldo y límites, siempre a mano."
      />
      <section className="pocket-balance">
        <div>
          <Wallet size={20} />
          <span>Efectivo en mano</span>
        </div>
        <strong>{money(collector?.cashInHand ?? 0)}</strong>
        <p>Saldo de cobros + fondos para pagos</p>
      </section>
      <div className="pocket-limits">
        <LimitCard
          title="Efectivo de cobros"
          amount={collectionCash}
          limit={collector?.collectionLimit ?? 0}
          icon={ArrowDownLeft}
        />
        <LimitCard
          title="Fondos para pagos"
          amount={payoutCash}
          limit={collector?.payoutLimit ?? 0}
          icon={ArrowUpRight}
        />
      </div>
      <section className="pocket-formula">
        <span className="action-icon green">
          <Landmark size={22} />
        </span>
        <div>
          <h2>Tu cuadre, desde oficina</h2>
          <p>
            Los depósitos y las entregas de oficina actualizan este saldo. Para
            cerrar la jornada, la diferencia debe ser RD$ 0.00.
          </p>
        </div>
      </section>
      <div className="section-heading">
        <h2>Mi cuenta</h2>
      </div>
      <section className="profile-card">
        <div className="profile-identity">
          <span className="avatar large">
            {collector?.initials ?? user.name.slice(0, 2)}
          </span>
          <div>
            <strong>{user.name}</strong>
            <span>
              Cobrador ·{" "}
              {snapshot.routes.find((route) => route.id === collector?.routeId)
                ?.name ?? "Sin ruta"}
            </span>
          </div>
          <BadgeCheck size={22} />
        </div>
        <button
          className="profile-row"
          onClick={onTracking}
          disabled={!online && !tracking && !trackingBusy}
        >
          <span className="action-icon neutral">
            {trackingBusy ? (
              <LoaderCircle className="spin" size={20} />
            ) : (
              <LocateFixed size={20} />
            )}
          </span>
          <span>
            <strong>
              {trackingBusy
                ? "Cancelar solicitud de ubicación"
                : tracking
                  ? "Dejar de compartir ubicación"
                  : "Compartir mi ubicación"}
            </strong>
            <small>
              {import.meta.env.VITE_PUBLIC_DEMO === "true"
                ? "La última ubicación queda guardada y visible para administradores de esta demo"
                : tracking
                  ? "Activa mientras esta aplicación esté abierta"
                  : "Activa el permiso solo cuando lo necesites"}
            </small>
          </span>
          <span
            className={`toggle-switch ${tracking ? "on" : ""}`}
            aria-hidden="true"
          >
            <i />
          </span>
        </button>
        <button className="profile-row" onClick={onInstall}>
          <span className="action-icon neutral">
            <Download size={20} />
          </span>
          <span>
            <strong>Instalar CyP</strong>
            <small>Acceso directo desde tu pantalla de inicio</small>
          </span>
          <ChevronRight size={20} />
        </button>
        <button className="profile-row logout-row" onClick={onLogout}>
          <span className="action-icon neutral">
            <LogOut size={20} />
          </span>
          <span>
            <strong>Cerrar sesión</strong>
            <small>Termina tu sesión en esta pestaña</small>
          </span>
          <ChevronRight size={20} />
        </button>
      </section>
      <p className="privacy-note">
        <ShieldCheck size={15} />
        La ubicación solo se comparte al activarla y no continúa en segundo
        plano con la aplicación cerrada.
      </p>
    </>
  );
}

function LimitCard({
  title,
  amount,
  limit,
  icon: Icon,
}: {
  title: string;
  amount: number;
  limit: number;
  icon: typeof Wallet;
}) {
  const percent = limit
    ? Math.min(100, Math.max(0, (amount / limit) * 100))
    : 0;
  return (
    <div className="limit-card">
      <div>
        <Icon size={18} />
        <span>{title}</span>
      </div>
      <strong>{money(amount)}</strong>
      <div className={`limit-progress ${percent >= 85 ? "high" : ""}`}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <p>Límite {shortMoney(limit)}</p>
    </div>
  );
}
function PageTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-title">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
function EmptyState({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: typeof Wallet;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={29} />
      </span>
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </div>
  );
}
function LoadingCards() {
  return (
    <div className="loading-cards" role="status" aria-label="Cargando tu ruta">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-hero" />
      <div className="skeleton skeleton-route" />
      <div className="skeleton skeleton-stop" />
      <div className="skeleton skeleton-stop" />
      <span className="sr-only">Cargando datos…</span>
    </div>
  );
}
