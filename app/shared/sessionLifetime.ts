// A session lives only while its tab is open (observation of 2026-10-26: closing the browser or the
// tab left the session open for whoever came next).
//  - The token is kept in sessionStorage, never in localStorage, which survives closing the browser.
//  - Browsers that restore closed tabs also bring back their sessionStorage. So an open tab writes a
//    heartbeat every few seconds and when it is left; a page that starts with an old heartbeat was
//    closed and reopened, and its token is discarded. A reload keeps the session, and so does a tab
//    the system put to sleep and woke up again (document.wasDiscarded).
export const SESSION_ALIVE_KEY = "cyp-session-alive";
export const CLOSED_TAB_AFTER_MS = 30_000;
const HEARTBEAT_MS = 5_000;

/** True when the heartbeat left by this tab is too old: the tab was closed and has been reopened. */
export function tabWasClosed(lastBeat: string | null, now: number, wasDiscarded: boolean): boolean {
  if (wasDiscarded || lastBeat === null) return false;
  const last = Number(lastBeat);
  return !Number.isFinite(last) || Math.abs(now - last) > CLOSED_TAB_AFTER_MS;
}

/** Runs once when a portal starts, before it reads its token. */
export function startSessionLifetime(tokenKeys: readonly string[]) {
  try {
    // Before 2026-10-26 the office token lived in localStorage and outlived the browser.
    for (const key of tokenKeys) localStorage.removeItem(key);
  } catch {
    /* storage blocked: nothing kept there */
  }
  try {
    const discarded = (document as Document & { wasDiscarded?: boolean }).wasDiscarded === true;
    if (tabWasClosed(sessionStorage.getItem(SESSION_ALIVE_KEY), Date.now(), discarded))
      for (const key of tokenKeys) sessionStorage.removeItem(key);
    const beat = () => {
      try {
        sessionStorage.setItem(SESSION_ALIVE_KEY, String(Date.now()));
      } catch {
        /* storage blocked */
      }
    };
    beat();
    window.setInterval(beat, HEARTBEAT_MS);
    window.addEventListener("pagehide", beat);
  } catch {
    /* without sessionStorage there is no saved session to protect */
  }
}
