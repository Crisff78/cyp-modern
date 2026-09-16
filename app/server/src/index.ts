import { resolve } from "node:path";
import { buildApp } from "./app.js";
import { emptyState } from "./domain.js";
import { seed } from "./seed.js";
import { FileStore, PostgresStore } from "./store.js";
const demo = process.env.DEMO_MODE === "true";
if (!process.env.JWT_SECRET)
  throw new Error("Set JWT_SECRET in the root .env; see .env.example.");
if (!demo && !process.env.DATABASE_URL)
  throw new Error("DATABASE_URL is required outside demo mode.");
const initial = demo ? seed() : emptyState();
const store = process.env.DATABASE_URL
  ? new PostgresStore(process.env.DATABASE_URL)
  : await FileStore.open(
      resolve(process.env.DATA_FILE ?? "../../.local/demo-state.json"),
      initial,
    );
if (process.env.DATABASE_URL && demo)
  await store.transaction((s) => {
    if (s.collectors.length === 0) Object.assign(s, initial);
  });
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
  `CyP API ready at http://${process.env.HOST ?? "127.0.0.1"}:${process.env.PORT ?? 3001} (${demo ? "fictional demo" : "configured"} mode)`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
