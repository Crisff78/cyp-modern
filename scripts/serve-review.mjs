import http from 'node:http';
import { execFile } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const adminDir = resolve(root, '.local/review-build/one-link-admin');
const collectorDir = resolve(root, '.local/review-build/one-link-collector');
const port = Number(process.env.REVIEW_PORT ?? 5390);
const apiPort = 3012;
const publicHost = (process.env.REVIEW_PUBLIC_HOST ?? '').toLowerCase();
const inviteFile = resolve(root, '.local/review-private/invite-code');
const sessionCookie = '__Host-cyp-review';
const sessionLifetimeMs = 30 * 60 * 1000;
const sessions = new Map();

if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('Invalid review port');
if (process.env.REVIEW_API_PORT && process.env.REVIEW_API_PORT !== '3012')
  throw new Error('Review API port is fixed at 3012');
if (publicHost && !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(publicHost))
  throw new Error('REVIEW_PUBLIC_HOST must be one hostname without a scheme or port');

async function checkPrivateInviteFile() {
  for (let path = inviteFile; ; path = dirname(path)) {
    if ((await lstat(path)).isSymbolicLink()) throw new Error('Review invite path contains a reparse point');
    if (dirname(path) === path) break;
  }
  const actual = await realpath(inviteFile);
  if (process.platform === 'win32' ? actual.toLowerCase() !== inviteFile.toLowerCase() : actual !== inviteFile)
    throw new Error('Review invite path is redirected');
  if (process.platform !== 'win32') return;
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowed = @($current, 'S-1-5-18', 'S-1-5-32-544')
$directoryAcl = [System.IO.Directory]::GetAccessControl($env:CYP_REVIEW_INVITE_DIR)
$fileAcl = [System.IO.File]::GetAccessControl($env:CYP_REVIEW_INVITE_FILE)
foreach ($acl in @($directoryAcl, $fileAcl)) {
  if (-not $acl.AreAccessRulesProtected) { throw 'Inherited invite ACL' }
  $owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  if ($allowed -notcontains $owner) { throw 'Unexpected invite owner' }
  foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
        $allowed -notcontains $rule.IdentityReference.Value) { throw 'Broad invite ACL' }
  }
}
[Console]::Out.Write('PRIVATE')`;
  try {
    const powerShell = resolve(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const result = await promisify(execFile)(powerShell, ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, CYP_REVIEW_INVITE_DIR: dirname(inviteFile), CYP_REVIEW_INVITE_FILE: inviteFile },
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 4096,
    });
    if (result.stdout.trim() !== 'PRIVATE') throw new Error('Unexpected ACL check result');
  } catch {
    throw new Error('Review invite ACL verification failed');
  }
}

let inviteCode;
if (publicHost) {
  await checkPrivateInviteFile();
  const directoryInfo = await lstat(dirname(inviteFile));
  const fileInfo = await lstat(inviteFile);
  if (!directoryInfo.isDirectory() || !fileInfo.isFile() || fileInfo.size < 43 || fileInfo.size > 128 ||
      (process.platform !== 'win32' && ((directoryInfo.mode | fileInfo.mode) & 0o077) !== 0))
    throw new Error('Review invite code file must be private and regular');
  const code = (await readFile(inviteFile, 'utf8')).trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(code) || Buffer.from(code, 'base64url').length !== 32 ||
      Buffer.from(code, 'base64url').toString('base64url') !== code || new Set(code).size < 12)
    throw new Error('Review invite code must be a random 32-byte base64url value');
  inviteCode = Buffer.from(code);
}
await Promise.all([adminDir, collectorDir].map((dir) => stat(resolve(dir, 'index.html'))));
const [adminRealDir, collectorRealDir] = await Promise.all([adminDir, collectorDir].map((dir) => realpath(dir)));

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

const allowedRequestHeaders = new Set([
  'authorization', 'content-type', 'content-length', 'accept', 'accept-language', 'idempotency-key',
]);
const hopByHopHeaders = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

function connectionTokens(value) {
  return new Set(String(value ?? '').toLowerCase().split(',').map((token) => token.trim()));
}

function hasSession(req) {
  const values = String(req.headers.cookie ?? '').split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${sessionCookie}=`));
  if (values.length !== 1) return false;
  const token = values[0].slice(sessionCookie.length + 1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const expiry = sessions.get(token);
  if (!expiry) return false;
  if (expiry <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function invitePage(res, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; form-action 'self'; base-uri 'none'",
  });
  res.end('<!doctype html><html lang="es"><meta charset="utf-8"><title>Acceso a la demo</title><h1>Acceso a la demo</h1><form method="post" action="/acceso-demo"><label>Código de invitación <input name="codigo" type="password" autocomplete="one-time-code" required autofocus></label><button type="submit">Entrar</button></form>');
}

async function acceptInvite(req, res) {
  if (!/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) {
    res.writeHead(415, { 'Cache-Control': 'no-store' });
    res.end();
    return;
  }
  const length = Number(req.headers['content-length']);
  if (!Number.isSafeInteger(length) || length < 1 || !req.headers['content-length']) {
    res.writeHead(411, { 'Cache-Control': 'no-store', Connection: 'close' });
    res.end();
    return;
  }
  if (length > 1024) {
    res.writeHead(413, { 'Cache-Control': 'no-store', Connection: 'close' });
    res.end();
    return;
  }
  const chunks = [];
  let received = 0;
  const deadline = setTimeout(() => req.destroy(), 10000);
  try {
    for await (const chunk of req) {
      received += chunk.length;
      if (received > 1024) throw new Error('Invite form too large');
      chunks.push(chunk);
    }
  } finally {
    clearTimeout(deadline);
  }
  if (received !== length) throw new Error('Invalid invite form length');
  const fields = new URLSearchParams(Buffer.concat(chunks).toString('utf8')).getAll('codigo');
  const candidate = Buffer.from(fields.length === 1 ? fields[0] : '');
  const padded = Buffer.alloc(inviteCode.length);
  candidate.copy(padded, 0, 0, padded.length);
  const valid = timingSafeEqual(inviteCode, padded) && candidate.length === inviteCode.length;
  if (!valid) {
    invitePage(res, 403);
    return;
  }
  const now = Date.now();
  for (const [token, expiry] of sessions) if (expiry <= now) sessions.delete(token);
  const token = randomBytes(32).toString('base64url');
  sessions.set(token, now + sessionLifetimeMs);
  res.writeHead(303, {
    Location: '/',
    'Cache-Control': 'no-store',
    'Set-Cookie': `${sessionCookie}=${token}; Path=/; Max-Age=1800; HttpOnly; Secure; SameSite=Lax`,
  });
  res.end();
}

async function staticFile(path, directory) {
  let actual;
  try {
    actual = await realpath(path);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
  const fromRoot = relative(directory, actual);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return false;
  return (await stat(actual)).isFile() ? actual : null;
}

function proxyApi(req, res, path) {
  const headers = { host: `127.0.0.1:${apiPort}` };
  const requestConnectionTokens = connectionTokens(req.headers.connection);
  for (const [name, value] of Object.entries(req.headers)) {
    if (allowedRequestHeaders.has(name) && !requestConnectionTokens.has(name)) headers[name] = value;
  }
  const proxy = http.request(
    { hostname: '127.0.0.1', port: apiPort, method: req.method, path, headers },
    (upstream) => {
      upstream.on('error', () => res.destroy());
      upstream.on('aborted', () => res.destroy());
      const responseConnectionTokens = connectionTokens(upstream.headers.connection);
      const responseHeaders = {};
      for (const [name, value] of Object.entries(upstream.headers)) {
        if (!hopByHopHeaders.has(name) && !responseConnectionTokens.has(name)) responseHeaders[name] = value;
      }
      if (publicHost) responseHeaders['cache-control'] = 'private, no-store';
      responseHeaders['x-frame-options'] = 'DENY';
      const upstreamCsp = responseHeaders['content-security-policy'];
      responseHeaders['content-security-policy'] = upstreamCsp
        ? [...(Array.isArray(upstreamCsp) ? upstreamCsp : [upstreamCsp]), "frame-ancestors 'none'"]
        : "frame-ancestors 'none'";
      res.writeHead(upstream.statusCode ?? 502, responseHeaders);
      upstream.pipe(res);
    },
  );
  proxy.setTimeout(30000, () => proxy.destroy(new Error('Upstream timeout')));
  proxy.on('error', () => {
    if (res.headersSent) return res.destroy();
    res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'API_UNAVAILABLE', message: 'El servidor no esta disponible. No se confirmo la operacion.' }));
  });
  req.on('aborted', () => proxy.destroy());
  res.on('close', () => { if (!res.writableFinished) proxy.destroy(); });
  req.pipe(proxy);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  const host = req.headers.host?.toLowerCase().replace(/:\d+$/, '');
  if (!host || !['127.0.0.1', 'localhost', publicHost].includes(host)) {
    res.writeHead(403);
    res.end();
    return;
  }

  try {
    if (!req.url?.startsWith('/') || req.url.startsWith('//')) throw new Error('Invalid request path');
    const url = new URL(req.url, 'http://127.0.0.1');
    if (publicHost) {
      if (url.pathname === '/acceso-demo') {
        if (req.method === 'GET') invitePage(res);
        else if (req.method === 'HEAD') {
          res.writeHead(200, { 'Cache-Control': 'no-store' });
          res.end();
        } else if (req.method === 'POST') await acceptInvite(req, res);
        else {
          res.writeHead(405, { Allow: 'GET, HEAD, POST', 'Cache-Control': 'no-store' });
          res.end();
        }
        return;
      }
      if (!hasSession(req)) {
        if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
          res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'INVITE_REQUIRED' }));
        } else {
          res.writeHead(303, { Location: '/acceso-demo', 'Cache-Control': 'no-store' });
          res.end();
        }
        return;
      }
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      proxyApi(req, res, url.pathname + url.search);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }
    if (url.pathname === '/collector') {
      res.writeHead(308, { Location: `/collector/${url.search}`, 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    const collector = url.pathname.startsWith('/collector/');
    const directory = collector ? collectorDir : adminDir;
    const realDirectory = collector ? collectorRealDir : adminRealDir;
    const pathname = decodeURIComponent(collector ? url.pathname.slice('/collector'.length) : url.pathname);
    if (pathname.split('/').some((part) => part.startsWith('.') || part.includes('\\') || part.includes('\0')) || pathname.endsWith('.map')) {
      res.writeHead(404);
      res.end();
      return;
    }
    let path = resolve(directory, `.${pathname}`);
    if (path !== directory && !path.startsWith(directory + sep)) {
      res.writeHead(404);
      res.end();
      return;
    }
    let file = await staticFile(path, realDirectory);
    if (file === false) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (!file) {
      if (extname(pathname)) {
        res.writeHead(404);
        res.end();
        return;
      }
      path = resolve(directory, 'index.html');
      file = await staticFile(path, realDirectory);
      if (!file) {
        res.writeHead(404);
        res.end();
        return;
      }
    }
    const extension = extname(file);
    res.setHeader('Content-Type', types[extension] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', publicHost ? 'private, no-store' : pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store');
    if (req.method === 'HEAD') {
      res.writeHead(200);
      res.end();
    } else if (extension === '.html') {
      res.end(await readFile(file));
    } else {
      createReadStream(file).on('error', () => res.destroy()).pipe(res);
    }
  } catch {
    if (!res.headersSent) res.writeHead(400);
    res.end();
  }
});

server.listen(port, '127.0.0.1', () => console.log(`CyP review gateway: http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => server.close(() => process.exit(0)));
