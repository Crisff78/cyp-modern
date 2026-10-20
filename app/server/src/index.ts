import { resolve } from "node:path";
import { buildApp } from "./app.js";
import { normalizeDemoCollectorLabel, seed, seedPublicDemo } from "./seed.js";
import { enrichPublicDemo } from "./demo-scenarios.js";
import { enrichCollectorDemo } from "./demo-collector-scenarios.js";
import { enrichCashierDemo } from "./demo-cashier-scenarios.js";
import { FileStore, PostgresStore, type Store } from "./store.js";
import { registerPublicWeb } from "./public-web.js";
import { createDemoStationControl, createRraaValidator, limitRraaCalls, type RraaValidator } from "./rraa.js";
import { validateDemoAccessCode } from "./demo-access.js";

const requestedDemo = process.env.DEMO_MODE === "true";
const publicWeb = process.env.CYP_PUBLIC_DEMO === "true";
const port = Number(process.env.PORT ?? 3001);
const publicOrigin = process.env.RENDER_EXTERNAL_URL ?? `http://127.0.0.1:${port}`;
if (publicWeb && !requestedDemo)
  throw new Error("CYP_PUBLIC_DEMO requires DEMO_MODE=true.");
if (publicWeb && !process.env.DATABASE_URL)
  throw new Error("CYP_PUBLIC_DEMO requires a dedicated DATABASE_URL.");
if (publicWeb) validateDemoAccessCode(process.env.DEMO_ACCESS_CODE);
if (publicWeb) {
  let databaseName = "";
  try {
    databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL!).pathname.slice(1));
  } catch {
    throw new Error("CYP_PUBLIC_DEMO requires a valid PostgreSQL URL.");
  }
  if (databaseName !== "cyp_demo")
    throw new Error("CYP_PUBLIC_DEMO only accepts the dedicated cyp_demo database.");
}
if (!process.env.JWT_SECRET)
  throw new Error("Set JWT_SECRET in the root .env; see .env.example.");

async function openStore(): Promise<{
  store: Store;
  demo: boolean;
  source: string;
}> {
  const demoInitial = publicWeb ? seedPublicDemo() : seed();

  if (process.env.DATABASE_URL) {
    const postgres = new PostgresStore(process.env.DATABASE_URL);
    try {
      await postgres.read();
      if (requestedDemo)
        await postgres.transaction((s) => {
          if (s.collectors.length === 0) Object.assign(s, demoInitial);
          normalizeDemoCollectorLabel(s, requestedDemo);
          // Requires migration 035, which allows the cashier role in users and sessions.
          enrichCashierDemo(s);
          if (publicWeb) {
            enrichPublicDemo(s);
            enrichCollectorDemo(s);
          }
        });
      return {
        store: postgres,
        demo: requestedDemo,
        source: requestedDemo ? "PostgreSQL demo" : "PostgreSQL configured",
      };
    } catch (error) {
      await postgres.close().catch(() => undefined);
      throw new Error("PostgreSQL no está disponible o faltan migraciones. El servidor no se inició.", { cause: error });
    }
  }

  if (!requestedDemo) {
    throw new Error("DATABASE_URL es obligatorio en modo real; DEMO_MODE=true habilita la demostración explícita.");
  }

  const store = await FileStore.open(
    resolve(process.env.DATA_FILE ?? "../../.local/demo-state.json"),
    demoInitial,
  );
  await store.transaction((state) => {
    normalizeDemoCollectorLabel(state, requestedDemo);
    enrichCashierDemo(state);
  });
  return {
    store,
    demo: true,
    source: "FileStore demo",
  };
}

// Decision of 2026-10-12: the public demo validates stations against the real provider when its
// service has both variables. It is shared, so its questions to the provider are capped; and a
// missing or wrong value must not take the demo down: the practice control answers instead.
// A slow provider holds every other write of the shared demo while it is asked, so it waits less there.
const PUBLIC_DEMO_RRAA_CALLS_PER_MINUTE = 20, PUBLIC_DEMO_RRAA_TIMEOUT_MS = 5000;
const buildRraa = (): RraaValidator | undefined => {
  if (Boolean(process.env.RRAA_ENDPOINT) !== Boolean(process.env.RRAA_CLIENT_ID))
    throw new Error("Configura RRAA_ENDPOINT y RRAA_CLIENT_ID juntos.");
  if (!process.env.RRAA_ENDPOINT || !process.env.RRAA_CLIENT_ID) return undefined;
  const validator = createRraaValidator({ endpoint: process.env.RRAA_ENDPOINT, clientId: process.env.RRAA_CLIENT_ID,
    timeoutMs: process.env.RRAA_TIMEOUT_MS ? Number(process.env.RRAA_TIMEOUT_MS) : publicWeb ? PUBLIC_DEMO_RRAA_TIMEOUT_MS : undefined });
  return publicWeb ? limitRraaCalls(validator, PUBLIC_DEMO_RRAA_CALLS_PER_MINUTE) : validator;
};
let rraa: RraaValidator | undefined;
try { rraa = buildRraa(); }
catch (error) {
  if (!publicWeb) throw error;
  // Only the reason is logged; it never contains the values of the variables.
  console.warn(`RRAA no quedó configurado (${error instanceof Error ? error.message : "configuración inválida"}). La demo usa el control de prueba de estaciones.`);
}
if (publicWeb) console.log(rraa ? `Estaciones: validación con RRAA (máximo ${PUBLIC_DEMO_RRAA_CALLS_PER_MINUTE} consultas por minuto).` : "Estaciones: control de prueba de la demo (RRAA sin configurar).");
const { store, demo, source } = await openStore();
const app = await buildApp({
  store,
  secret: process.env.JWT_SECRET,
  demo,
  publicWeb,
  demoAccess: publicWeb ? { code: process.env.DEMO_ACCESS_CODE!, origin: publicOrigin } : undefined,
  origins: (
    process.env.ALLOWED_ORIGINS ?? (publicWeb ? publicOrigin : "http://127.0.0.1:5173,http://127.0.0.1:5174")
  ).split(","),
  collectorUrl: process.env.COLLECTOR_URL ?? (publicWeb ? `${publicOrigin}/collector` : "http://127.0.0.1:5174"),
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  rraa,
  demoStationControl: demo ? createDemoStationControl() : undefined,
  buildVersion: /^[a-f0-9]{40}$/i.test(process.env.RENDER_GIT_COMMIT ?? "")
    ? process.env.RENDER_GIT_COMMIT : undefined,
});
if (publicWeb) await registerPublicWeb(app);
await app.listen({
  port,
  host: process.env.HOST ?? "127.0.0.1",
});
console.log(
  `CyP API ready at http://${process.env.HOST ?? "127.0.0.1"}:${process.env.PORT ?? 3001} (${demo ? "fictional demo" : "configured"} mode · ${source})`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
