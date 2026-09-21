#!/usr/bin/env node
// Paridad de datos: compara la base de DATABASE_URL (origen) contra otra base
// del mismo servidor (--other-db=<nombre>) o contra una URL completa (--other).
//
// Uso desde la raiz del repo (via npm):
//   npm run db:parity -- --other-db=cyp_paridad
//   npm run db:parity -- --other-db=cyp_paridad --skip=idempotency
//   npm run db:parity -- --other=<URL completa de conexion a otra base>
//
// - Compara TODAS las tablas del esquema public: conteo y checksum md5 por
//   tabla (md5 de la concatenacion de cada fila serializada a JSON, en orden
//   determinista: por clave primaria; si no hay PK, por todas las columnas).
// - Imprime la tabla |tabla|origen|copia|estado| y el veredicto PASS/FAIL.
// - Sale con codigo 1 si existe cualquier diferencia.
// - --skip=tabla1,tabla2 excluye tablas de la comparacion (idempotency es
//   candidata tipica cuando su contenido es volatil entre respaldo y restore).
// - Nunca imprime credenciales.

import { createHash } from 'node:crypto';
import pg from 'pg';
import process from 'node:process';

function fail(message) {
  console.error('[db-parity] ERROR: ' + message);
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = { otherDb: null, otherUrl: null, skip: new Set() };
  for (const arg of argv) {
    if (arg.startsWith('--other-db=')) parsed.otherDb = arg.slice('--other-db='.length).trim();
    else if (arg.startsWith('--other=')) parsed.otherUrl = arg.slice('--other='.length).trim();
    else if (arg.startsWith('--skip=')) {
      for (const name of arg.slice('--skip='.length).split(',')) {
        const trimmed = name.trim();
        if (trimmed) parsed.skip.add(trimmed);
      }
    } else fail('Argumento no reconocido: ' + arg + '. Uso: --other-db=<base> | --other=<URL> [--skip=tabla1,tabla2]');
  }
  if (parsed.otherDb && parsed.otherUrl) fail('Usa solo una de las dos opciones: --other-db o --other.');
  if (!parsed.otherDb && !parsed.otherUrl) fail('Falta la base a comparar: usa --other-db=<nombre> o --other=<URL completa>.');
  return parsed;
}

function readDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) fail('DATABASE_URL no esta definida en el entorno. Ejecuta con el .env de la raiz (npm run db:parity).');
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

function quoteIdent(name) {
  return '"' + name.replace(/"/g, '""') + '"';
}

async function openClient(creds) {
  const client = new pg.Client({
    host: creds.host,
    port: creds.port,
    user: creds.user,
    password: creds.password,
    database: creds.database,
  });
  await client.connect();
  return client;
}

async function listPublicTables(client) {
  const res = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  return res.rows.map((row) => row.tablename);
}

// Columnas que definen el orden determinista de filas: PK si existe;
// si no, todas las columnas en su posicion ordinal.
async function orderingColumns(client, table) {
  const pkRes = await client.query(
    'SELECT a.attname AS col ' +
      'FROM pg_index i ' +
      'JOIN pg_class c ON c.oid = i.indrelid ' +
      'JOIN pg_namespace n ON n.oid = c.relnamespace ' +
      'CROSS JOIN LATERAL unnest(i.indkey::smallint[]) WITH ORDINALITY AS k(attnum, ord) ' +
      'JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum ' +
      "WHERE i.indisprimary AND n.nspname = 'public' AND c.relname = $1 " +
      'ORDER BY k.ord',
    [table],
  );
  if (pkRes.rows.length > 0) return pkRes.rows.map((row) => row.col);
  const colsRes = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
    [table],
  );
  return colsRes.rows.map((row) => row.column_name);
}

async function tableStats(client, table) {
  const orderCols = await orderingColumns(client, table);
  if (orderCols.length === 0) return { count: 0, checksum: '' };
  const orderSql = orderCols.map(quoteIdent).join(', ');
  const rowsRes = await client.query('SELECT * FROM ' + quoteIdent(table) + ' ORDER BY ' + orderSql);
  const hash = createHash('md5');
  for (const row of rowsRes.rows) hash.update(JSON.stringify(row) + '\n');
  return { count: rowsRes.rows.length, checksum: hash.digest('hex') };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = readDatabaseUrl();

  let otherCreds;
  if (args.otherUrl) {
    let url;
    try {
      url = new URL(args.otherUrl);
    } catch {
      fail('--other no es una URL valida.');
    }
    const otherDbName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!otherDbName) fail('--other no incluye el nombre de la base de datos.');
    otherCreds = {
      host: url.hostname,
      port: url.port || '5432',
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: otherDbName,
    };
  } else {
    if (args.otherDb.toLowerCase() === source.database.toLowerCase()) {
      fail('La base a comparar es la misma que la de DATABASE_URL ("' + source.database + '"); no hay nada que comparar.');
    }
    otherCreds = {
      host: source.host,
      port: source.port,
      user: source.user,
      password: source.password,
      database: args.otherDb,
    };
  }

  const origin = await openClient(source);
  const copy = await openClient(otherCreds);

  const originTables = new Set(await listPublicTables(origin));
  const copyTables = new Set(await listPublicTables(copy));
  const allTables = [...new Set([...originTables, ...copyTables])].sort();

  console.log('[db-parity] Origen: "' + source.database + '" | Copia: "' + otherCreds.database + '" (' + otherCreds.host + ':' + otherCreds.port + ')');
  console.log('|tabla|origen|copia|estado|');
  console.log('|---|---:|---:|---|');

  let compared = 0;
  let skipped = 0;
  let differences = 0;

  for (const table of allTables) {
    if (args.skip.has(table)) {
      skipped += 1;
      console.log('|' + table + '|-|-|OMITIDA (--skip)|');
      continue;
    }
    const inOrigin = originTables.has(table);
    const inCopy = copyTables.has(table);
    if (!inOrigin || !inCopy) {
      differences += 1;
      const estado = !inOrigin ? 'FALTA_EN_ORIGEN' : 'FALTA_EN_COPIA';
      console.log('|' + table + '|-|-' + estado + '|');
      continue;
    }
    let originStats;
    let copyStats;
    try {
      originStats = await tableStats(origin, table);
      copyStats = await tableStats(copy, table);
    } catch (err) {
      differences += 1;
      console.log('|' + table + '|?|?|ERROR (' + err.message + ')|');
      continue;
    }
    compared += 1;
    if (originStats.count !== copyStats.count) {
      differences += 1;
      console.log('|' + table + '|' + originStats.count + '|' + copyStats.count + '|CONTEO_DISTINTO|');
      continue;
    }
    if (originStats.checksum !== copyStats.checksum) {
      differences += 1;
      console.log('|' + table + '|' + originStats.count + '|' + copyStats.count + '|CHECKSUM_DISTINTO|');
      continue;
    }
    console.log('|' + table + '|' + originStats.count + '|' + copyStats.count + '|OK|');
  }

  await origin.end();
  await copy.end();

  console.log('');
  if (differences === 0) {
    console.log('[db-parity] Resultado: PASS (' + compared + ' tabla(s) comparadas, ' + skipped + ' omitida(s))');
  } else {
    console.log('[db-parity] Resultado: FAIL (' + differences + ' tabla(s) con diferencias, ' + compared + ' comparadas, ' + skipped + ' omitida(s))');
    process.exit(1);
  }
}

main().catch((err) => fail(err && err.message ? err.message : String(err)));
