import { useEffect, useId, useState } from "react";
import type { Rate } from "./types";
import { rateMoment } from "./suggestions";

const registrationTime = new Intl.DateTimeFormat("es-DO", {
  timeZone: "America/Santo_Domingo",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function RateRegistrationTime({ rate, className, labelClassName }: { rate?: Rate; className?: string; labelClassName?: string }) {
  const noteId = useId();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const hasRecordedTime = typeof rate?.updatedAt === "string" && Number.isFinite(Date.parse(rate.updatedAt));
  return <>
    <label className={className}><span className={labelClassName}>Hora:</span><input type="text" readOnly aria-label="Hora actual del formulario" aria-describedby={noteId} value={registrationTime.format(now)} /></label>
    <p id={noteId} className="rate-registration-note">Hora actual (America/Santo_Domingo). La hora de cada cambio la registra el servidor.<br />Último cambio registrado: {hasRecordedTime ? rateMoment(rate.updatedAt) : "Sin hora registrada"}.</p>
  </>;
}
