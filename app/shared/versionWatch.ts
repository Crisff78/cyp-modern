// A tab left open keeps running the version it loaded, even days later (observation of 2026-10-26:
// some people kept seeing old versions of the published demo). From time to time, and when the person
// comes back to the tab, the portal asks the server for its own page and compares the program that
// page points to with the one running. A different one means a new version was published.
const MODULE_SCRIPT = /<script\b(?=[^>]*\btype=["']module["'])[^>]*\bsrc=["']([^"']+)["'][^>]*>/i;

/** The first module script of a page, as written in its HTML (Vite: /assets/index-<hash>.js). */
export function moduleScriptOf(html: string): string | null {
  return MODULE_SCRIPT.exec(html)?.[1] ?? null;
}

/** Only a page that really names a different program is a new version; anything else is unknown. */
export function isNewVersion(running: string | null, published: string | null): boolean {
  return Boolean(running && published && running !== published);
}

export function runningModuleScript(): string | null {
  return document.querySelector('script[type="module"][src]')?.getAttribute("src") ?? null;
}

/** The program the server publishes now, or null when the answer is not the portal page (asleep, error, gate). */
export async function publishedModuleScript(pageUrl: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  const response = await fetcher(pageUrl, { cache: "no-store", credentials: "same-origin", headers: { Accept: "text/html" } });
  if (!response.ok || !(response.headers.get("content-type") ?? "").includes("text/html")) return null;
  return moduleScriptOf(await response.text());
}
