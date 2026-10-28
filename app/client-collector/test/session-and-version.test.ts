import assert from "node:assert/strict";
import test from "node:test";
import { CLOSED_TAB_AFTER_MS, tabWasClosed } from "../../shared/sessionLifetime.ts";
import { isNewVersion, moduleScriptOf, publishedModuleScript } from "../../shared/versionWatch.ts";
import { BUILD, buildInfoFromGit, updatedLabel } from "../../shared/buildInfo.ts";

test("a tab reopened after being closed ends its session; a reload or a woken tab keeps it", () => {
  const now = 1_800_000_000_000;
  assert.equal(tabWasClosed(String(now - 2_000), now, false), false, "reload: the heartbeat is seconds old");
  assert.equal(tabWasClosed(String(now - CLOSED_TAB_AFTER_MS), now, false), false, "at the limit it still counts as open");
  assert.equal(tabWasClosed(String(now - CLOSED_TAB_AFTER_MS - 1), now, false), true, "closed longer than the limit");
  assert.equal(tabWasClosed(String(now - 8 * 3_600_000), now, false), true, "browser reopened the next morning");
  assert.equal(tabWasClosed(String(now - 8 * 3_600_000), now, true), false, "tab put to sleep by the system and woken up");
  assert.equal(tabWasClosed(null, now, false), false, "no heartbeat yet: nothing to compare");
  assert.equal(tabWasClosed("not-a-time", now, false), true, "an unreadable heartbeat is not trusted");
  assert.equal(tabWasClosed(String(now + 10 * 60_000), now, false), true, "a heartbeat from the future is not trusted");
});

test("the published program is read from the portal page and compared with the running one", async () => {
  const vite = '<!doctype html><html><head><script type="module" crossorigin src="/assets/index-AbC123.js"></script><link rel="stylesheet" crossorigin href="/assets/index-Xy.css"></head><body><div id="root"></div></body></html>';
  assert.equal(moduleScriptOf(vite), "/assets/index-AbC123.js");
  assert.equal(moduleScriptOf('<script src="/legacy.js"></script><script src="/collector/assets/index-9.js" type="module"></script>'), "/collector/assets/index-9.js");
  assert.equal(moduleScriptOf("<h1>Render · Application loading</h1>"), null);

  assert.equal(isNewVersion("/assets/index-AbC123.js", "/assets/index-AbC123.js"), false, "same program");
  assert.equal(isNewVersion("/assets/index-AbC123.js", "/assets/index-NEW456.js"), true, "a new version was published");
  assert.equal(isNewVersion("/assets/index-AbC123.js", null), false, "an answer that is not the page tells nothing");
  assert.equal(isNewVersion(null, "/assets/index-NEW456.js"), false, "a page without its program (development) never asks to update");

  const page = (body: string, type = "text/html; charset=utf-8", status = 200) =>
    (async () => new Response(body, { status, headers: { "Content-Type": type } })) as unknown as typeof fetch;
  assert.equal(await publishedModuleScript("/", page(vite)), "/assets/index-AbC123.js");
  assert.equal(await publishedModuleScript("/", page(vite, "text/html", 503)), null, "server waking up or failing");
  assert.equal(await publishedModuleScript("/", page('{"status":"ok"}', "application/json")), null, "not the portal page");
  let asked: RequestInit | undefined;
  await publishedModuleScript("/collector/", (async (_url: string, init: RequestInit) => { asked = init; return new Response(vite, { headers: { "Content-Type": "text/html" } }); }) as unknown as typeof fetch);
  assert.equal(asked?.cache, "no-store", "always asks the server, never a stored copy");
  assert.equal(asked?.credentials, "same-origin");
});

test("the date of the version published is shown in Santo Domingo, and comes from the last commit", () => {
  // 15:23 UTC is 11:23 in Santo Domingo (UTC−4, no summer time).
  assert.match(updatedLabel({ updatedAt: "2026-10-28T15:23:42Z", commit: "45ea3e8" }), /^28\/10\/2026,? 11:23\s?a\.?\s?m\.?$/);
  assert.equal(updatedLabel(null), "", "no build: nothing is shown");
  assert.equal(updatedLabel({ updatedAt: "not a date", commit: "" }), "");
  assert.equal(BUILD, null, "outside a Vite build there is no build information");
  const asked: string[][] = [];
  const git = (args: string[]) => { asked.push(args); return args[0] === "log" ? "2026-10-28T11:23:42-04:00\n" : "45ea3e8f00d\n"; };
  assert.deepEqual(buildInfoFromGit(git), { updatedAt: "2026-10-28T11:23:42-04:00", commit: "45ea3e8" });
  assert.deepEqual(buildInfoFromGit(git, "ad9b1430123"), { updatedAt: "2026-10-28T11:23:42-04:00", commit: "ad9b143" }, "Render names its commit");
  const withoutGit = buildInfoFromGit(() => { throw new Error("no git"); });
  assert.equal(withoutGit.commit, "");
  assert.ok(Math.abs(Date.parse(withoutGit.updatedAt) - Date.now()) < 60_000, "without git: the time of the build");
  assert.ok(asked.some((args) => args.join(" ") === "log -1 --format=%cI"));
});
