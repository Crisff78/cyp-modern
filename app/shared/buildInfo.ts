// When the version in use was published, to tell at a glance whether the browser runs the latest one (Rardiel,
// 28-10-2026: «sería bueno que saliera la fecha de la última actualización que hemos hecho a la aplicación para saber si
// en realidad está saliendo la aplicación actualizada»). Vite writes it when it builds (see vite.config.ts): the date of
// the last change published (its commit) and the short name of that commit. Absent in development and in the tests.
declare const __CYP_BUILD__: { updatedAt: string; commit: string } | undefined;

export type BuildInfo = { updatedAt: string; commit: string };

export const BUILD: BuildInfo | null = typeof __CYP_BUILD__ === "undefined" ? null : __CYP_BUILD__;

/** «28/10/2026, 11:23 a. m.», in Santo Domingo; empty when the date is unknown. */
export function updatedLabel(build: BuildInfo | null = BUILD): string {
  const date = build ? new Date(build.updatedAt) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** What Vite writes as __CYP_BUILD__: the date of the last commit (or now, without git) and its short name. */
export function buildInfoFromGit(run: (args: string[]) => string, commitFromHost?: string): BuildInfo {
  const ask = (args: string[]) => { try { return run(args).trim(); } catch { return ""; } };
  const updatedAt = ask(["log", "-1", "--format=%cI"]);
  return { updatedAt: updatedAt || new Date().toISOString(), commit: (commitFromHost || ask(["rev-parse", "HEAD"])).slice(0, 7) };
}
