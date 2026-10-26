import { useEffect, useState } from "react";
import { isNewVersion, publishedModuleScript, runningModuleScript } from "./versionWatch";

const CHECK_EVERY_MS = 5 * 60_000;
const MIN_GAP_MS = 60_000;

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
 * Tells the person that a new version is out. Signed in, it waits for them so nothing being typed is
 * lost; on the sign-in page there is nothing to lose, so it reloads straight away.
 */
export function NewVersionNotice({ pageUrl, isSignedIn }: { pageUrl: string; isSignedIn: () => boolean }) {
  const available = useNewVersionPublished(pageUrl);
  const signedIn = available && isSignedIn();
  useEffect(() => {
    if (available && !signedIn) window.location.reload();
  }, [available, signedIn]);
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
      <span>Hay una versión nueva del sistema. Guarda lo que estés haciendo y pulsa «Actualizar ahora».</span>
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
