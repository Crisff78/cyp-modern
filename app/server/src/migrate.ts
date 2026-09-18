import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const here = dirname(fileURLToPath(import.meta.url)),
    directory = join(here, "../database"),
    files = (await readdir(directory)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files)
    await pool.query(await readFile(join(directory, file), "utf8"));
  console.log(`Database migrations completed (${files.join(", ")}).`);
} finally {
  await pool.end();
}
