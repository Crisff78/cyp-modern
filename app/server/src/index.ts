import { resolve } from "node:path";
import { buildApp } from "./app.js";
import { emptyState } from "./domain.js";
import { seed } from "./seed.js";
import { FileStore, MemoryStore, PostgresStore, type Store } from "./store.js";

const requestedDemo = process.env.DEMO_MODE === "true";
if (!process.env.JWT_SECRET)
  throw new Error("Set JWT_SECRET in the root .env; see .env.example.");

async function openStore(): Promise<{
  store: Store;
  demo: boolean;
  source: string;
}> {
  const demoInitial = seed();

  if (process.env.DATABASE_URL) {
    const postgres = new PostgresStore(process.env.DATABASE_URL);
    try {
      await postgres.read();
      if (requestedDemo)
        await postgres.transaction((s) => {
          if (s.collectors.length === 0) Object.assign(s, demoInitial);
        });
      return {
        store: postgres,
        demo: requestedDemo,
        source: requestedDemo ? "PostgreSQL demo" : "PostgreSQL configured",
      };
    } catch (error) {
      await postgres.close().catch(() => undefined);
      console.warn(
        `PostgreSQL no disponible; usando MemoryStore demo temporal. ${(error as Error).message}`,
      );
      return {
        store: new MemoryStore(demoInitial),
        demo: true,
        source: "MemoryStore demo fallback",
      };
    }
  }

  if (!requestedDemo) {
    console.warn(
      "DATABASE_URL no está configurado; usando MemoryStore demo temporal para desarrollo local.",
    );
    return {
      store: new MemoryStore(demoInitial),
      demo: true,
      source: "MemoryStore demo fallback",
    };
  }

  return {
    store: await FileStore.open(
      resolve(process.env.DATA_FILE ?? "../../.local/demo-state.json"),
      demoInitial,
    ),
    demo: true,
    source: "FileStore demo",
  };
}

const { store, demo, source } = await openStore();
const app = await buildApp({
  store,
  secret: process.env.JWT_SECRET,
  demo,
  origins: (
    process.env.ALLOWED_ORIGINS ?? "http://127.0.0.1:5173,http://127.0.0.1:5174"
  ).split(","),
  collectorUrl: process.env.COLLECTOR_URL ?? "http://127.0.0.1:5174",
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
});
await app.listen({
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? "127.0.0.1",
});
console.log(
  `CyP API ready at http://${process.env.HOST ?? "127.0.0.1"}:${process.env.PORT ?? 3001} (${demo ? "fictional demo" : "configured"} mode · ${source})`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
