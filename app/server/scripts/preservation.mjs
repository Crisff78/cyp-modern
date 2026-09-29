// Operational fingerprints only: this receipt never stores row contents.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
const capture = process.argv.find((arg) => arg.startsWith('--capture='))?.slice(10);
const verify = process.argv.find((arg) => arg.startsWith('--verify='))?.slice(9);
if ((!capture && !verify) || (capture && verify)) throw new Error('Use --capture=<local receipt> or --verify=<local receipt>');
const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const identity = (await client.query('SELECT current_database() AS database,inet_server_port() AS port')).rows[0];
  if (capture) {
    const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map((row) => row.tablename);
    const receipt = { capturedAt: new Date().toISOString(), identity, tables: [] };
    for (const table of tables) {
      const columns = (await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [table])).rows.map((row) => row.column_name);
      if (!columns.includes('id')) throw new Error('Expected id column for preservation capture: ' + table);
      const rows = (await client.query(`SELECT ${columns.map(quote).join(',')} FROM ${quote(table)} ORDER BY id`)).rows;
      receipt.tables.push({ table, columns, rows: rows.map((row) => ({ key: digest(row.id), hash: digest(row) })) });
    }
    mkdirSync(dirname(resolve(capture)), { recursive: true });
    writeFileSync(capture, JSON.stringify(receipt, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ captured: receipt.tables.length, rows: receipt.tables.reduce((total, table) => total + table.rows.length, 0), contentsStored: false }));
  } else {
    const receipt = JSON.parse(readFileSync(verify, 'utf8'));
    const results = [];
    for (const item of receipt.tables) {
      const rows = (await client.query(`SELECT ${item.columns.map(quote).join(',')} FROM ${quote(item.table)} ORDER BY id`)).rows;
      const current = new Map(rows.map((row) => [digest(row.id), digest(row)]));
      const changed = item.rows.filter((row) => current.get(row.key) !== row.hash).length;
      results.push({ table: item.table, preserved: item.rows.length - changed, changedOrMissing: changed, added: rows.length - item.rows.length });
    }
    const pass = results.every((result) => result.changedOrMissing === 0);
    console.log(JSON.stringify({ pass, tables: results }));
    if (!pass) process.exitCode = 1;
  }
  await client.query('ROLLBACK');
} catch (error) {
  console.error('Preservation check failed', error.code ?? 'LOCAL_ERROR');
  process.exitCode = 1;
} finally { await client.end(); }
