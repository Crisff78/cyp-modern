import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const portal = process.argv.find((arg) => arg.startsWith('--portal='))?.split('=')[1];
if (!['admin', 'collector'].includes(portal)) throw new Error('Use --portal=admin or --portal=collector');
const port = portal === 'admin' ? 5173 : 5174;
const directory = resolve(root, `app/client-${portal}/dist`);
await stat(resolve(directory, 'index.html'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff' };

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const headers = { ...req.headers, host: '127.0.0.1:3001' };
      delete headers['proxy-authorization'];
      const proxy = http.request({ hostname: '127.0.0.1', port: 3001, method: req.method, path: url.pathname + url.search, headers }, (upstream) => {
        upstream.on('error', () => res.destroy());
        upstream.on('aborted', () => res.destroy());
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      });
      proxy.setTimeout(30000, () => proxy.destroy(new Error('Upstream timeout')));
      proxy.on('error', () => {
        if (res.headersSent) { res.destroy(); return; }
        res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'API_UNAVAILABLE', message: 'El servidor no esta disponible. No se confirmo la operacion.' }));
      });
      req.on('aborted', () => proxy.destroy());
      res.on('close', () => { if (!res.writableFinished) proxy.destroy(); });
      req.pipe(proxy);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    const pathname = decodeURIComponent(url.pathname);
    // Only compiled public assets are served. Dotfiles, source maps and source
    // directories cannot be reached through the public review URL.
    if (pathname.split('/').some((part) => part.startsWith('.') || part.includes('\\')) || pathname.endsWith('.map')) { res.writeHead(404); res.end(); return; }
    let path = resolve(directory, `.${pathname}`);
    if (path !== directory && !path.startsWith(directory + sep)) { res.writeHead(404); res.end(); return; }
    let info;
    try { info = await stat(path); } catch { /* SPA navigation is handled below. */ }
    if (!info?.isFile()) {
      if (extname(pathname)) { res.writeHead(404); res.end(); return; }
      path = resolve(directory, 'index.html');
    }
    const extension = extname(path);
    res.setHeader('Content-Type', types[extension] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store');
    if (req.method === 'HEAD') { res.writeHead(200); res.end(); return; }
    if (extension === '.html') {
      res.end(await readFile(path));
    } else createReadStream(path).on('error', () => res.destroy()).pipe(res);
  } catch { if (!res.headersSent) res.writeHead(400); res.end(); }
});
server.listen(port, '127.0.0.1', () => console.log(`CyP ${portal}: http://127.0.0.1:${port} (compiled assets)`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
