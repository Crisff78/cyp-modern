#!/usr/bin/env node
// Respaldo de la base de datos PostgreSQL con pg_dump (formato custom -Fc).
//
// Uso desde la raiz del repo (recomendado, via npm):
//   npm run db:backup
//   npm run db:backup -- --out=C:/ruta/respaldo.dump
//
// - Lee DATABASE_URL del entorno (el script npm de la raiz carga el .env con
//   --env-file-if-exists=.env).
// - Nunca imprime la cadena de conexion ni credenciales; la contrasena viaja
//   al proceso hijo unicamente por entorno (PGPASSWORD).
// - Salida por defecto: <raiz del repo>/.local/backups/cyp-<timestamp>.dump
//   (crea el directorio si no existe). Con --out se respeta la ruta tal cual
//   (una ruta relativa se interpreta desde el directorio de ejecucion actual).
// - Sale con codigo 1 y mensaje claro si algo falla.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const PG_DEFAULT_BIN_DIR = 'C:\\Program Files\\PostgreSQL\\17\\bin';
// Raiz del repo: este archivo vive en app/server/scripts -> tres niveles arriba.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DEFAULT_OUT_DIR = join(REPO_ROOT, '.local', 'backups');

function fail(message) {
  console.error('[db-backup] ERROR: ' + message);
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = { out: null };
  for (const arg of argv) {
    if (arg.startsWith('--out=')) parsed.out = arg.slice('--out='.length).trim();
    else fail('Argumento no reconocido: ' + arg + '. Uso: [--out=<ruta del dump>]');
  }
  return parsed;
}

function readDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) fail('DATABASE_URL no esta definida en el entorno. Ejecuta con el .env de la raiz (npm run db:backup).');
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail('DATABASE_URL no es una URL valida.');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  if (!database) fail('DATABASE_URL no incluye el nombre de la base de datos.');
  return {
    host: url.hostname,
    port: url.port || '5432',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
  };
}

function resolvePgTool(tool) {
  const where = spawnSync('where.exe', [tool], { encoding: 'utf8' });
  if (where.status === 0) {
    const first = String(where.stdout)
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0);
    if (first) return first.trim();
  }
  const fallback = join(PG_DEFAULT_BIN_DIR, tool + '.exe');
  if (existsSync(fallback)) return fallback;
  fail('No se encontro ' + tool + '.exe: no esta en PATH ni en ' + PG_DEFAULT_BIN_DIR + '.');
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return bytes + ' B';
}

const args = parseArgs(process.argv.slice(2));
const db = readDatabaseUrl();
const pgDump = resolvePgTool('pg_dump');

const timestamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
const outFile = args.out ? resolve(args.out) : join(DEFAULT_OUT_DIR, 'cyp-' + timestamp + '.dump');
mkdirSync(dirname(outFile), { recursive: true });

const result = spawnSync(
  pgDump,
  [
    '--format=custom',
    '--host', db.host,
    '--port', db.port,
    '--username', db.user,
    '--dbname', db.database,
    '--file', outFile,
  ],
  {
    env: { ...process.env, PGPASSWORD: db.password },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  },
);

if (result.error) fail('No se pudo ejecutar pg_dump: ' + result.error.message);
if (result.status !== 0) {
  const errText = String(result.stderr || '').trim();
  fail('pg_dump termino con codigo ' + result.status + (errText ? '\n' + errText : ''));
}

let size = 0;
try {
  size = statSync(outFile).size;
} catch {
  fail('pg_dump termino sin error pero no se encontro el archivo de salida.');
}
if (size === 0) fail('El dump quedo vacio (0 bytes); revisa la conexion y los permisos.');

console.log('[db-backup] Respaldo creado: ' + outFile);
console.log('[db-backup] Base: ' + db.database + ' | Bytes: ' + size + ' (' + formatBytes(size) + ')');
