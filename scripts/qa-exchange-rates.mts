// Manual browser fixture: actual rate screens + actual API; every write stays in MemoryStore.
// No .env files, database, shared browser credentials or remote services are loaded.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildApp } from "../app/server/src/app.js";
import { seed } from "../app/server/src/seed.js";
import { MemoryStore } from "../app/server/src/store.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adminRoot = path.join(root, "app/client-admin");
const localRequire = createRequire(path.join(adminRoot, "package.json"));
const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-rates-flow-"));
const cleanOutput = () => {
  if (fs.existsSync(output) && path.dirname(path.resolve(output)) === path.resolve(os.tmpdir()) && path.basename(output).startsWith("cyp-rates-flow-")) fs.rmSync(output, { recursive: true });
};
process.on("exit", cleanOutput);
const store = new MemoryStore(seed());
const app = await buildApp({ store, demo: true, secret: "synthetic-rates-fixture-key-at-least-32", origins: [], collectorUrl: "http://127.0.0.1/collector" });
const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@cyp.local", password: "Demo-CyP-2026!" } });
if (login.statusCode !== 200) throw new Error("Synthetic fixture login failed");
const { token, user } = login.json();
const source = (relative: string) => JSON.stringify(path.join(root, relative).replaceAll("\\", "/"));
const fixture = path.join(output, "fixture.tsx");
fs.writeFileSync(fixture, `import {createRoot} from "react-dom/client";
import {ConnectedExchangeRates} from ${source("app/client-admin/src/ConnectedExchangeRates.tsx")};
import RemittancesWorkspace from ${source("app/shared/remittances/RemittancesWorkspace.tsx")};
import {remittancesApi} from ${source("app/client-admin/src/remittancesApi.ts")};
const user=${JSON.stringify(user)};
const workspace=new URLSearchParams(location.search).get("view")==="workspace";
createRoot(document.getElementById("root")).render(workspace?<RemittancesWorkspace api={remittancesApi} user={user} isAdmin={true} initialTab="tasas"/>:<ConnectedExchangeRates actorId={user.id} isAdmin={true}/>);
`, "utf8");
const [{ build }, { default: react }] = await Promise.all([
  import(pathToFileURL(localRequire.resolve("vite")).href),
  import(pathToFileURL(localRequire.resolve("@vitejs/plugin-react")).href),
]);
await build({ root: adminRoot, configFile: false, envFile: false, publicDir: false, cacheDir: path.join(output, "cache"), resolve: { dedupe: ["react", "react-dom"] }, plugins: [react()], define: { "process.env.NODE_ENV": JSON.stringify("production") }, logLevel: "error", build: { outDir: path.join(output, "dist"), emptyOutDir: false, sourcemap: false, cssCodeSplit: false, lib: { entry: fixture, formats: ["es"], fileName: () => "fixture.js", cssFileName: "fixture" } } });
const writes: Array<{ path: string; status: number; key: string; body: unknown; result: unknown }> = [];
let loseNextResponse = false;
let rejectNextSave = false;
let invalidNextResponse = false;
const html = `<!doctype html><html lang="es"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><style>body{font:14px Arial;background:#eef2f4}button,input,select{margin:4px}table{border-collapse:collapse}th,td{padding:6px;border:1px solid #bbb}.legacy-dialog-overlay{position:fixed;inset:0;display:grid;place-items:center;background:#0003;z-index:100}.legacy-dialog{padding:15px;background:white;min-width:500px;max-height:90vh;overflow:auto}.legacy-dialog-titlebar,.legacy-dialog-actions{display:flex;justify-content:space-between;gap:8px}.legacy-dialog-form{display:grid;gap:10px}.qa-controls{background:#fff8d0;padding:12px}</style><div class="qa-controls"><strong>QA aislada: datos ficticios en memoria</strong> <a href="/">Tasas de Cambio</a> · <a href="/?view=workspace">Envíos/Tasas</a><button onclick="fetch('/qa/lose-next',{method:'POST'}).then(()=>this.textContent='Respuesta perdida preparada')">Perder próxima respuesta</button><button onclick="fetch('/qa/reject-next',{method:'POST'}).then(()=>this.textContent='Rechazo preparado')">Rechazar próximo guardado</button><button onclick="fetch('/qa/invalid-next',{method:'POST'}).then(()=>this.textContent='Respuesta incompleta preparada')">Devolver respuesta incompleta</button><a href="/qa/status" target="_blank">Estado de QA</a></div><div id="root"></div><script>localStorage.setItem('cyp-admin-token',${JSON.stringify(token)});</script><script type="module" src="/fixture.js"></script></html>`;
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/qa/lose-next" && request.method === "POST") { loseNextResponse = true; response.end("ok"); return; }
    if (pathname === "/qa/reject-next" && request.method === "POST") { rejectNextSave = true; response.end("ok"); return; }
    if (pathname === "/qa/invalid-next" && request.method === "POST") { invalidNextResponse = true; response.end("ok"); return; }
    if (pathname === "/qa/status") { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify({ writes, remittances: (await store.read()).remittances })); return; }
    if (pathname.startsWith("/api/")) {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
      const mutation = request.method === "POST" && pathname === "/api/envios/tasas";
      if (mutation && rejectNextSave) {
        rejectNextSave = false;
        response.writeHead(422, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { code: "RATE_DATE", message: "QA: la jornada cambió; actualiza antes de registrar la tasa." } })); return;
      }
      const result = await app.inject({ method: request.method as "GET" | "POST", url: request.url!, headers: request.headers, ...(body ? { payload: body } : {}) });
      if (mutation) {
        writes.push({ path: pathname, status: result.statusCode, key: String(request.headers["idempotency-key"] ?? ""), body, result: result.json() });
        if (invalidNextResponse) { invalidNextResponse = false; response.writeHead(200, { "Content-Type": "application/json" }); response.end("{}"); return; }
        if (loseNextResponse) { loseNextResponse = false; response.writeHead(502, { "Content-Type": "application/json" }); response.end('{"error":{"message":"QA: respuesta perdida despues de confirmar el guardado."}}'); return; }
      }
      response.writeHead(result.statusCode, { "Content-Type": "application/json; charset=utf-8" }); response.end(result.body); return;
    }
    if (pathname === "/") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end(html); return; }
    const assets: Record<string, string> = { "/fixture.js": "text/javascript", "/fixture.css": "text/css" };
    if (assets[pathname]) { response.writeHead(200, { "Content-Type": assets[pathname] }); response.end(fs.readFileSync(path.join(output, "dist", pathname.slice(1)))); return; }
    response.writeHead(404); response.end();
  } catch { response.writeHead(500, { "Content-Type": "application/json" }); response.end('{"error":{"message":"Synthetic fixture failure"}}'); }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Loopback listener unavailable");
console.log(JSON.stringify({ origin: `http://127.0.0.1:${address.port}`, output, storage: "MemoryStore synthetic only" }));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { server.close(); void app.close().then(() => { cleanOutput(); process.exit(0); }); });
