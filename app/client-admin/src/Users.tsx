import { useState } from "react";
import {
  ArrowRight,
  Check,
  CircleAlert,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "./api";
import { HelpNote, Modal } from "./components";
import type { PublicAccount, Snapshot } from "./types";

export type AccountOperation =
  | { type: "create" }
  | { type: "password"; account: PublicAccount }
  | { type: "status"; account: PublicAccount; status: "active" | "disabled" };

const MIN_LENGTH = 12;
const labelFor = (operation: AccountOperation) =>
  operation.type === "create"
    ? "Nueva cuenta"
    : operation.type === "password"
      ? "Restablecer contraseña"
      : operation.status === "disabled"
        ? "Desactivar cuenta"
        : "Activar cuenta";

export default function AccountModal({
  operation,
  snapshot,
  onClose,
  onComplete,
}: {
  operation: AccountOperation | null;
  snapshot: Snapshot;
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  if (!operation) return null;
  return (
    <AccountForm
      key={
        operation.type === "create"
          ? "create"
          : `${operation.type}-${operation.account.id}`
      }
      operation={operation}
      snapshot={snapshot}
      onClose={onClose}
      onComplete={onComplete}
    />
  );
}

function AccountForm({
  operation,
  snapshot,
  onClose,
  onComplete,
}: {
  operation: AccountOperation;
  snapshot: Snapshot;
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  const collectorName = (id?: string) =>
    snapshot.collectors.find((collector) => collector.id === id)?.name ??
    "Sin asignar";
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [role, setRole] = useState<"admin" | "collector">("collector"),
    [collectorId, setCollectorId] = useState(snapshot.collectors[0]?.id ?? ""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const creating = operation.type === "create",
    rotating = operation.type === "password";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (creating && !name.trim()) return setError("Escribe el nombre.");
    if (creating && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return setError("Escribe un correo válido.");
    if ((creating || rotating) && password.length < MIN_LENGTH)
      return setError(
        `La contraseña debe tener al menos ${MIN_LENGTH} caracteres.`,
      );
    setBusy(true);
    setError("");
    try {
      if (creating) {
        const account = await api<PublicAccount>("/usuarios", {
          method: "POST",
          body: JSON.stringify({ name, email, role, collectorId, password }),
          headers: { "Idempotency-Key": crypto.randomUUID() },
        });
        toast.success(`Cuenta creada para ${account.email}.`);
      } else if (rotating) {
        await api(`/usuarios/${operation.account.id}/clave`, {
          method: "POST",
          body: JSON.stringify({ password }),
          headers: { "Idempotency-Key": crypto.randomUUID() },
        });
        toast.success(
          `Contraseña actualizada. Las demás sesiones de ${operation.account.email} se cerraron.`,
        );
      } else {
        await api(`/usuarios/${operation.account.id}/estado`, {
          method: "POST",
          body: JSON.stringify({ status: operation.status }),
          headers: { "Idempotency-Key": crypto.randomUUID() },
        });
        toast.success(
          operation.status === "disabled"
            ? `${operation.account.email} desactivada.`
            : `${operation.account.email} activada.`,
        );
      }
      await onComplete();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Operación fallida.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={labelFor(operation)}
      description={
        creating
          ? "El cobrador o administrador entra al portal con su propio correo y contraseña."
          : rotating
            ? `La nueva contraseña cierra las sesiones abiertas de ${operation.account.email}.`
            : operation.status === "disabled"
              ? `Una cuenta desactivada no puede iniciar sesión y sus sesiones abiertas se cierran.`
              : `La cuenta vuelve a poder iniciar sesión.`
      }
    >
      <form className="dialog-form" onSubmit={submit}>
        {creating && (
          <>
            <label className="field">
              Nombre
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Nombre de la persona"
                autoComplete="name"
                required
              />
            </label>
            <label className="field">
              Correo
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="correo@empresa.com"
                autoComplete="email"
                required
              />
            </label>
            <label className="field">
              Rol
              <select
                value={role}
                onChange={(event) =>
                  setRole(event.target.value as "admin" | "collector")
                }
              >
                <option value="collector">Cobrador</option>
                <option value="admin">Administración</option>
              </select>
            </label>
            {role === "collector" && (
              <label className="field">
                Cobrador asignado
                <select
                  value={collectorId}
                  onChange={(event) => setCollectorId(event.target.value)}
                >
                  {snapshot.collectors.map((collector) => (
                    <option key={collector.id} value={collector.id}>
                      {collector.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
        {!creating && (
          <div className="readonly-summary">
            <div>
              <span>Nombre</span>
              <strong>{operation.account.name}</strong>
            </div>
            <div>
              <span>Correo</span>
              <strong>{operation.account.email}</strong>
            </div>
            <div>
              <span>Rol</span>
              <strong>
                {operation.account.role === "admin"
                  ? "Administración"
                  : `Cobrador · ${collectorName(operation.account.collectorId)}`}
              </strong>
            </div>
          </div>
        )}
        {(creating || rotating) && (
          <label className="field">
            Contraseña ({MIN_LENGTH} caracteres mínimo)
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Contraseña inicial"
              autoComplete="new-password"
              required
            />
          </label>
        )}
        {error && (
          <div className="inline-error" role="alert">
            <CircleAlert size={17} />
            {error}
          </div>
        )}
        {(creating || rotating) && (
          <HelpNote>
            Entrega esta contraseña personalmente. El cobrador puede cambiarla
            desde su portal; cambiarla aquí cierra las sesiones abiertas.
          </HelpNote>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : rotating ? (
              <KeyRound size={17} />
            ) : operation.type === "status" ? (
              <ShieldCheck size={17} />
            ) : (
              <Check size={17} />
            )}{" "}
            {busy
              ? "Guardando…"
              : creating
                ? "Crear cuenta"
                : rotating
                  ? "Cambiar contraseña"
                  : operation.status === "disabled"
                    ? "Desactivar"
                    : "Activar"}
            {!busy && <ArrowRight size={15} />}
          </button>
        </div>
      </form>
    </Modal>
  );
}
