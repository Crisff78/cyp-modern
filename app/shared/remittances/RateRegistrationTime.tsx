import { useId } from "react";
import type { Rate } from "./types";

const registrationTime = new Intl.DateTimeFormat("es-DO", {
  timeZone: "America/Santo_Domingo",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function RateRegistrationTime({ rate, className, labelClassName }: { rate?: Rate; className?: string; labelClassName?: string }) {
  const noteId = useId();
  let value = "Se asigna al guardar";
  if (rate?.currency === "DOP") value = "Referencia fija 1";
  else if (rate) {
    const timestamp = typeof rate.updatedAt === "string" ? new Date(rate.updatedAt) : null;
    value = timestamp && Number.isFinite(timestamp.getTime()) ? registrationTime.format(timestamp) : "Hora no disponible";
  }
  return <>
    <label className={className}><span className={labelClassName}>Hora:</span><input type="text" readOnly aria-label="Hora del último cambio de tasa" aria-describedby={noteId} value={value} /></label>
    <p id={noteId} className="rate-registration-note">America/Santo_Domingo. La hora de cada cambio se registra automáticamente al confirmar.</p>
  </>;
}
