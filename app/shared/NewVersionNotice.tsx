import { useEffect, useState } from "react";
import { isNewVersion, publishedModuleScript, runningModuleScript } from "./versionWatch";
import { workInProgress } from "./keyboard";

// Every minute, and when the person comes back to the tab (at most every 15 s): a new version reaches everyone soon
// (Rardiel, 28-10-2026: «Tienes que asegurarte de que a todos les salgan la versión actualizada, fuérzalo si es necesario»).
const CHECK_EVERY_MS = 60_000;
const MIN_GAP_MS = 15_000;
// Signed in, the new version loads by itself once nothing would be lost: no dialog open, nothing typed and not saved,
// and no key or click for this long (a request just sent has time to answer). The session stays: it lives in the tab.
const QUIET_MS = 20_000;
const SAFE_CHECK_MS = 2_000;

let lastActivity = 0;
let watchingActivity = false;
function watchActivity() {
  if (watchingActivity) return;
  watchingActivity = true;
  lastActivity = performance.now();
  for (const type of ["keydown", "pointerdown", "input", "wheel", "touchstart"]) document.addEventListener(type, () => { lastActivity = performance.now(); }, { capture: true, passive: true });
}

/** Watches for a newly published version while the tab stays open; see versionWatch.ts. */
export function useNewVersionPublished(pageUrl: string): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (available) return;
    let stopped = false;
    let lastCheck = 0; // the first return to the tab checks at once; later ones at most once a minute
    const check = (force = false) => {
      if (document.visibilityState !== "visible" || (!force && Date.now() - lastCheck < MIN_GAP_MS)) return;
      lastCheck = Date.now();
      void publishedModuleScript(pageUrl)
        .then((published) => {
          if (!stopped && isNewVersion(runningModuleScript(), published)) setAvailable(true);
        })
        .catch(() => {
          /* offline or asleep: try again later */
        });
    };
    const onReturn = () => check();
    const timer = window.setInterval(() => check(true), CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    window.addEventListener("online", onReturn);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("online", onReturn);
    };
  }, [pageUrl, available]);
  return available;
}

/**
 * Brings the new version as soon as it is out. On the sign-in page there is nothing to lose: it reloads straight away.
 * Signed in, it reloads by itself as soon as nothing would be lost (see QUIET_MS); meanwhile a notice says so and lets
 * the person load it at once.
 */
export function NewVersionNotice({ pageUrl, isSignedIn, quietMs = QUIET_MS }: { pageUrl: string; isSignedIn: () => boolean; quietMs?: number }) {
  const available = useNewVersionPublished(pageUrl);
  const signedIn = available && isSignedIn();
  useEffect(watchActivity, []);
  useEffect(() => {
    if (!available) return;
    if (!signedIn) { window.location.reload(); return; }
    const loadWhenSafe = () => { if (performance.now() - lastActivity >= quietMs && !workInProgress()) window.location.reload(); };
    loadWhenSafe();
    const timer = window.setInterval(loadWhenSafe, SAFE_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [available, signedIn, quietMs]);
  if (!available || !signedIn) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 2147483000,
        display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 10,
        maxWidth: "calc(100vw - 24px)", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8,
        background: "#fff4ce", color: "#3a2a00", border: "1px solid #d9a400", boxShadow: "0 4px 14px rgba(0,0,0,.18)",
        font: "500 14px/1.35 system-ui, sans-serif", textAlign: "center",
      }}
    >
      <span>Hay una versión nueva del sistema. Se cargará sola en cuanto termines lo que estás haciendo (guarda o cierra lo abierto), o pulsa «Actualizar ahora».</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{ border: 0, borderRadius: 6, padding: "6px 12px", background: "#14532d", color: "#ffffff", font: "600 14px/1.2 system-ui, sans-serif", cursor: "pointer" }}
      >
        Actualizar ahora
      </button>
    </div>
  );
}
