import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
const args = process.argv.slice(2);
if (args.some((arg) => !/^(--apply|--status|--from=\d{1,3}|--to=\d{1,3})$/.test(arg)))
  throw new Error("Uso: db:migrate [--status] [--from=009] [--to=013] [--apply]");
const apply = args.includes("--apply");
const fromArg = args.find((arg) => arg.startsWith("--from="));
const from = Number(fromArg?.split("=")[1] ?? 1);
const to = Number(args.find((arg) => arg.startsWith("--to="))?.split("=")[1] ?? 999);
if (from < 1 || to < from) throw new Error("Rango de migraciones invalido");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
// Validate the target before connecting or applying any migration. The public
// demo must never migrate a configured operational database by mistake.
if (process.env.CYP_PUBLIC_DEMO === "true") {
  let target: URL;
  try { target = new URL(process.env.DATABASE_URL); }
  catch { throw new Error("Public demo migrations require a valid PostgreSQL URL."); }
  if (process.env.DEMO_MODE !== "true" ||
      !["postgres:", "postgresql:"].includes(target.protocol) ||
      decodeURIComponent(target.pathname.slice(1)) !== "cyp_demo")
    throw new Error("Public demo migrations require DEMO_MODE=true and the dedicated cyp_demo database.");
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
let inTransaction = false;
try {
  await client.connect();
  if (apply) {
    await client.query("BEGIN"); inTransaction = true;
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SELECT pg_advisory_xact_lock(7341920)");
  }
  const directory = join(dirname(fileURLToPath(import.meta.url)), "../database");
  const files = (await readdir(directory)).filter((file) => /^\d{3}_.+\.sql$/.test(file)).sort();
  const sources = await Promise.all(files.map(async (file) => {
    const sql = await readFile(join(directory, file), "utf8");
    return { file, number: Number(file.slice(0, 3)), sql, sha256: createHash("sha256").update(sql).digest("hex") };
  }));
  const exists = (await client.query("SELECT to_regclass('public.cyp_schema_migrations') AS ledger,to_regclass('public.clients') AS clients")).rows[0];
  const applied: { name: string; sha256: string }[] = exists.ledger
    ? (await client.query("SELECT name,sha256 FROM cyp_schema_migrations ORDER BY name")).rows : [];
  for (const row of applied) {
    const source = sources.find((file) => file.file === row.name);
    if (!source || source.sha256 !== row.sha256) throw new Error(`Migration checksum changed: ${row.name}`);
  }
  // An explicitly inspected legacy baseline remains below the first recorded
  // migration. Do not replay that historical range on later default runs.
  const effectiveFrom = fromArg ? from : applied.length ? Math.min(...applied.map((row) => Number(row.name.slice(0, 3)))) : 1;
  const selected = sources.filter((source) => source.number >= effectiveFrom && source.number <= to && !applied.some((row) => row.name === source.file));
  console.log(JSON.stringify({ mode: apply ? "apply" : "status", existingDatabase: Boolean(exists.clients), tracked: applied.map((row) => row.name), selected: selected.map(({ file, sha256 }) => ({ file, sha256 })) }));
  if (apply) {
    if (exists.clients && !exists.ledger && !fromArg)
      throw new Error("Existing untracked database: inspect its schema and specify --from explicitly; no changes made.");
    await client.query("CREATE TABLE IF NOT EXISTS cyp_schema_migrations(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())");
    for (const migration of selected) {
      // Use one outer transaction; preserve BEGIN inside function bodies.
      const body = migration.sql.replace(/^\s*(?:--[^\n]*\n\s*)*BEGIN\s*;/i, "").replace(/COMMIT\s*;\s*$/i, "");
      await client.query(body);
      await client.query("INSERT INTO cyp_schema_migrations(name,sha256) VALUES($1,$2)", [migration.file, migration.sha256]);
    }
    await client.query("COMMIT"); inTransaction = false;
    console.log(JSON.stringify({ applied: selected.map((migration) => migration.file), committed: true }));
  }
} catch (error) {
  if (inTransaction) await client.query("ROLLBACK");
  const code = (error as { code?: string }).code;
  console.error(code ? `Migration failed (${code}); transaction rolled back.` : (error as Error).message);
  process.exitCode = 1;
} finally {
  await client.end();
}
