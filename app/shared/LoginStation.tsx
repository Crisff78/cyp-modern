import { useCallback, useEffect, useRef, useState } from "react";
import { hasPermission, type AccessActor } from "./access.mjs";
import { createStrictApi, StrictApiError } from "./remittances/strictApi";
import { createStationRegistrar } from "./registerSessionStation";
import { lastStationNumber, type StationChoice } from "./sessionStationsApi";
import "./login-station.css";

type AuthResult<U> = { user: U; token: string };
type LoginChoice = StationChoice & { remembered?: boolean };
type Credentials = { email: string; password: string };
type PendingLogin<U> = {
  result: AuthResult<U>;
  api: ReturnType<typeof createStrictApi>;
  register: ReturnType<typeof createStationRegistrar>;
};

export function useStationLogin<U extends AccessActor & { id: string }>() {
  const [choice, setChoice] = useState<LoginChoice | null>(null);
  const [credentialsLocked, setCredentialsLocked] = useState(false);
  const pending = useRef<PendingLogin<U> | null>(null);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const release = useCallback(() => {
    const session = pending.current;
    pending.current = null;
    if (session) void session.api("/auth/logout", { method: "POST", body: "{}" }).catch(() => {});
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; release(); };
  }, [release]);
  const restoreChoice = useCallback((row: StationChoice) => setChoice(previous => previous ?? { ...row, remembered: true }), []);

  async function signIn(credentials: Credentials, authenticate: (values: Credentials) => Promise<AuthResult<U>>,
    checkAccess: (user: U) => void): Promise<AuthResult<U>> {
    if (submitting.current) throw new Error("El ingreso ya se está procesando.");
    submitting.current = true;
    try {
      if (!pending.current) {
        const result = await authenticate(credentials);
        const api = createStrictApi(() => result.token, () => false);
        pending.current = { api, result, register: createStationRegistrar(api) };
        if (!mounted.current) { release(); throw new Error("Se cerró el formulario de ingreso."); }
        try { checkAccess(result.user); } catch (error) { release(); throw error; }
      }
      const { result, register } = pending.current;
      if (choice) {
        const canRegister = hasPermission(result.user, 111) && hasPermission(result.user, 113);
        await register(result.user.id, choice, { canRegister, onlyExisting: choice.remembered });
      }
      if (!mounted.current) throw new Error("Se cerró el formulario de ingreso.");
      pending.current = null;
      setCredentialsLocked(false);
      return result;
    } catch (error) {
      if (choice?.remembered && pending.current) setChoice(null);
      if (error instanceof StrictApiError && error.status === 401) release();
      setCredentialsLocked(Boolean(pending.current));
      throw error;
    } finally { submitting.current = false; }
  }
  function changeAccount() {
    release();
    setCredentialsLocked(false);
  }
  return { choice, setChoice, restoreChoice, credentialsLocked, signIn, changeAccount };
}

export function LoginStationField({ api, choice, onChange, restoreChoice, disabled }: {
  api: <T>(path: string) => Promise<T>;
  choice: LoginChoice | null;
  onChange: (row: StationChoice | null) => void;
  restoreChoice: (row: StationChoice) => void;
  disabled: boolean;
}) {
  const [stations, setStations] = useState<StationChoice[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setState("loading");
    api<StationChoice[]>("/auth/estaciones").then(rows => {
      if (!Array.isArray(rows)) throw new Error("Catálogo no disponible");
      if (current) {
        setStations(rows); setState("ready");
        const lastNumber = lastStationNumber();
        const last = rows.find(row => row.number === lastNumber);
        if (last) restoreChoice(last);
      }
    }).catch(() => { if (current) setState("error"); });
    return () => { current = false; };
  }, [api, attempt, restoreChoice]);
  return <div className="login-station-field">
    {/* data-capture-skip: Enter does not stop on this optional list, so Enter in the password signs in, as always
        (docs/TECLADO-COMPLETO.md). Tab and ↓ reach it. */}
    <label className="field">Estación
      <select name="station" data-capture-skip value={choice?.number ?? ""} disabled={disabled || state !== "ready"}
        onChange={event => onChange(stations.find(row => row.number === event.currentTarget.value) ?? null)}>
        <option value="">Usar vínculo actual</option>
        {stations.map(row => <option key={row.number} value={row.number}>{row.number} · {row.name}</option>)}
      </select>
    </label>
    {state === "loading" && <small role="status">Cargando estaciones…</small>}
    {state === "error" && <small role="status">No se pudo cargar la lista. Puedes entrar con el vínculo actual.{" "}
      <button type="button" disabled={disabled} onClick={() => setAttempt(n => n + 1)}>Reintentar</button></small>}
    {state === "ready" && <small>{!stations.length ? "Sin estaciones activas. Puedes entrar sin registrar este navegador."
      : choice?.remembered ? "Última estación usada en este navegador. Se comprobará al entrar."
      : choice ? "Al entrar se comprobará el vínculo. Si el navegador está libre y tienes permiso, quedará registrado en esta estación."
      : "Para registrar este navegador, elige una estación de la lista."}</small>}
  </div>;
}
