import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = resolve(root, '.local/runtime');
const metadataPath = resolve(runtime, 'processes.json');
mkdirSync(runtime, { recursive: true });
const urlsPath = resolve(runtime, 'urls.json');
const urls = existsSync(urlsPath) ? JSON.parse(readFileSync(urlsPath, 'utf8')) : {};
const isListening = (port) => new Promise((resolvePort) => {
  const socket = net.connect({ host: '127.0.0.1', port });
  socket.once('connect', () => { socket.destroy(); resolvePort(true); });
  socket.once('error', () => resolvePort(false));
});
const definitions = [
  { name: 'api', port: 3001, args: ['--env-file=.env', 'app/server/dist/index.js'] },
  { name: 'admin', port: 5173, args: ['scripts/serve-web.mjs', '--portal=admin'] },
  { name: 'collector', port: 5174, args: ['scripts/serve-web.mjs', '--portal=collector'] },
];
const env = { ...process.env, HOST: '127.0.0.1', PORT: '3001', DEMO_MODE: 'false' };
if (urls.collector) env.COLLECTOR_URL = urls.collector;
env.ALLOWED_ORIGINS = ['http://127.0.0.1:5173', 'http://127.0.0.1:5174', urls.admin, urls.collector].filter(Boolean).join(',');
const started = [];
// A stale PID file cannot prove who owns a listener. Never reuse or stop it.
for (const item of definitions) if (await isListening(item.port))
  throw new Error(`Puerto ${item.port} ocupado. Comprobar el proceso existente antes de iniciar; no se modifico.`);
for (const item of definitions) {
  const log = openSync(resolve(runtime, `${item.name}.log`), 'a');
  const child = spawn(process.execPath, item.args, { cwd: root, env, detached: true, windowsHide: true, stdio: ['ignore', log, log] });
  child.on('error', () => console.error(`No se pudo iniciar ${item.name}`));
  child.unref(); closeSync(log);
  const record = { name: item.name, port: item.port, pid: child.pid, executable: process.execPath, args: item.args, startedAt: new Date().toISOString() };
  started.push(record);
  writeFileSync(metadataPath, JSON.stringify(started, null, 2));
  let listening = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await isListening(item.port)) { listening = true; break; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  if (!listening) throw new Error(`${item.name} no inicio; revisar su log local. No se detuvieron otros procesos.`);
}
writeFileSync(metadataPath, JSON.stringify(started, null, 2));
console.log(JSON.stringify({ processes: started.map(({ name, port, pid }) => ({ name, port, pid })), admin: 'http://127.0.0.1:5173', collector: 'http://127.0.0.1:5174' }));
