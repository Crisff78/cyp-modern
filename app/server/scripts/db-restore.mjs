#!/usr/bin/env node
// Restauracion de un dump pg_dump (formato custom) hacia una base DESTINO distinta.
//
// Uso desde la raiz del repo (via npm):
//   npm run db:restore -- --file=<ruta del dump> --target=<base destino>
//   npm run db:restore -- --file=<ruta del dump> --target=<base destino> --yes
//
// - PROHIBIDO restaurar sobre la base de DATABASE_URL: se valida y se aborta.
// - Si la base destino existe y ya tiene tablas en el esquema public, se
//   aborta pidiendo confirmacion explicita. Con --yes se ejecuta
//   DROP DATABASE ... WITH (FORCE) y se recrea antes de restaurar.
// - pg_restore con --no-owner --no-privileges --exit-on-error.
// - Al final imprime los conteos de clients, charges y collections.
// - Nunca imprime credenciales; PGPASSWORD viaja por el entorno del hijo.

import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import process from 'node:process';

const PG_DEFAULT_BIN_DIR = 'C:\\Program Files\\PostgreSQL\\17\\bin';

function fail(message) {
  console.error('[db-restore] ERROR: ' + message);
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = { file: null, target: null, yes: false };
  for (const arg of argv) {
    if (arg.startsWith('--file=')) parsed.file = arg.slice('--file='.length).trim();
    else if (arg.startsWith('--target=')) parsed.target = arg.slice('--target='.length).trim();
    else if (arg === '--yes') parsed.yes = true;
    else fail('Argumento no reconocido: ' + arg + '. Uso: --file=<dump> --target=<base destino> [--yes]');
  }
  return parsed;
}

function readDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) fail('DATABASE_URL no esta definida en el entorno. Ejecuta con el .env de la raiz (npm run db:restore).');
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

function quoteIdent(name) {
  return '"' + name.replace(/"/g, '""') + '"';
}

// Conexion de administracion para CREATE/DROP DATABASE: primero "postgres",
// con "template1" como respaldo. Usa las credenciales de DATABASE_URL.
async function connectAdmin(creds) {
  for (const maintenanceDb of ['postgres', 'template1']) {
    const client = new pg.Client({
      host: creds.host,
      port: creds.port,
      user: creds.user,
      password: creds.password,
      database: maintenanceDb,
    });
    try {
      await client.connect();
      return client;
    } catch {
      // Probar la siguiente base de mantenimiento.
    }
  }
  fail('No se pudo conectar a una base de mantenimiento (postgres/template1) en ' + creds.host + ':' + creds.port + ' con el usuario de DATABASE_URL.');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) fail('--file es obligatorio: ruta del dump a restaurar.');
  if (!args.target) fail('--target es obligatorio: nombre de la base destino.');

  const dumpFile = resolve(args.file);
  if (!existsSync(dumpFile)) fail('No existe el dump: ' + dumpFile);
  let dumpSize = 0;
  try {
    dumpSize = statSync(dumpFile).size;
  } catch {
    fail('No se puede leer el dump: ' + dumpFile);
  }
  if (dumpSize === 0) fail('El dump indicado esta vacio (0 bytes): ' + dumpFile);

  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(args.target)) {
    fail('Nombre de base destino invalido: "' + args.target + '". Usa un identificador simple (letras, numeros, guion bajo).');
  }

  const source = readDatabaseUrl();
  if (args.target.toLowerCase() === source.database.toLowerCase()) {
    fail('PROHIBIDO restaurar sobre la base de DATABASE_URL ("' + source.database + '"). Elige una base destino distinta.');
  }

  const pgRestore = resolvePgTool('pg_restore');
  const admin = await connectAdmin(source);

  try {
    const existsRes = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [args.target]);
    const targetExists = (existsRes.rowCount || 0) > 0;
    let publicTables = 0;
    if (targetExists) {
      const probe = new pg.Client({
        host: source.host,
        port: source.port,
        user: source.user,
        password: source.password,
        database: args.target,
      });
      try {
        await probe.connect();
        const res = await probe.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'");
        publicTables = Number(res.rows[0].n);
        await probe.end();
      } catch (err) {
        fail('La base destino "' + args.target + '" existe pero no se pudo inspeccionar: ' + err.message);
      }
    }

    if (targetExists && publicTables > 0 && !args.yes) {
      console.error('[db-restore] La base "' + args.target + '" ya existe y tiene ' + publicTables + ' tabla(s) en el esquema public.');
      console.error('[db-restore] Para REEMPLAZARLA por completo vuelve a ejecutar con --yes (se aplica DROP DATABASE ... WITH (FORCE) y se recrea).');
      process.exit(1);
    }

    if (targetExists && args.yes) {
      console.log('[db-restore] --yes: eliminando la base "' + args.target + '" (DROP DATABASE ... WITH (FORCE))...');
      await admin.query('DROP DATABASE ' + quoteIdent(args.target) + ' WITH (FORCE)');
      console.log('[db-restore] Recreando la base "' + args.target + '"...');
      await admin.query('CREATE DATABASE ' + quoteIdent(args.target));
    } else if (!targetExists) {
      console.log('[db-restore] Creando la base "' + args.target + '"...');
      await admin.query('CREATE DATABASE ' + quoteIdent(args.target));
    } else {
      console.log('[db-restore] La base "' + args.target + '" existe y esta vacia; se restaura sobre ella.');
    }

    console.log('[db-restore] Ejecutando pg_restore sobre "' + args.target + '"...');
    const restored = spawnSync(
      pgRestore,
      [
        '--no-owner',
        '--no-privileges',
        '--exit-on-error',
        '--host', source.host,
        '--port', source.port,
        '--username', source.user,
        '--dbname', args.target,
        dumpFile,
      ],
      {
        env: { ...process.env, PGPASSWORD: source.password },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    if (restored.error) fail('No se pudo ejecutar pg_restore: ' + restored.error.message);
    const restoreErr = String(restored.stderr || '').trim();
    if (restored.status !== 0) {
      fail('pg_restore termino con codigo ' + restored.status + (restoreErr ? '\n' + restoreErr : ''));
    }
    if (restoreErr) console.log('[db-restore] Avisos de pg_restore:\n' + restoreErr);

    const target = new pg.Client({
      host: source.host,
      port: source.port,
      user: source.user,
      password: source.password,
      database: args.target,
    });
    await target.connect();
    for (const table of ['clients', 'charges', 'collections']) {
      try {
        const res = await target.query('SELECT count(*)::int AS n FROM ' + quoteIdent(table));
        console.log('[db-restore] count(' + table + ') = ' + res.rows[0].n);
      } catch {
        console.log('[db-restore] count(' + table + ') = tabla ausente en el destino');
      }
    }
    await target.end();
    console.log('[db-restore] Restauracion completada: dump -> "' + args.target + '".');
  } finally {
    await admin.end().catch(() => {});
  }
}

main().catch((err) => fail(err && err.message ? err.message : String(err)));
