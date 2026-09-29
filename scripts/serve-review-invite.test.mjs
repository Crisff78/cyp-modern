import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const source = resolve(dirname(fileURLToPath(import.meta.url)), 'serve-review.mjs');

async function restrictWindowsInvite(dir, file) {
  if (process.platform !== 'win32') return;
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$ids = @([System.Security.Principal.WindowsIdentity]::GetCurrent().User,
  [System.Security.Principal.SecurityIdentifier]'S-1-5-18',
  [System.Security.Principal.SecurityIdentifier]'S-1-5-32-544')
foreach ($entry in @(@($env:CYP_TEST_INVITE_DIR, $true), @($env:CYP_TEST_INVITE_FILE, $false))) {
  $acl = if ($entry[1]) { [System.Security.AccessControl.DirectorySecurity]::new() }
    else { [System.Security.AccessControl.FileSecurity]::new() }
  $acl.SetOwner($ids[0])
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($id in $ids) {
    $rule = if ($entry[1]) {
      [System.Security.AccessControl.FileSystemAccessRule]::new($id, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
    } else {
      [System.Security.AccessControl.FileSystemAccessRule]::new($id, 'FullControl', 'Allow')
    }
    $acl.AddAccessRule($rule)
  }
  if ($entry[1]) { [System.IO.Directory]::SetAccessControl($entry[0], $acl) }
  else { [System.IO.File]::SetAccessControl($entry[0], $acl) }
}`;
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, CYP_TEST_INVITE_DIR: dir, CYP_TEST_INVITE_FILE: file },
    windowsHide: true,
    timeout: 10000,
  });
}

async function freePort() {
  const server = net.createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

function launch(path, port, publicHost, apiPort = '3012') {
  return spawn(process.execPath, [path], {
    env: { ...process.env, REVIEW_PORT: String(port), REVIEW_PUBLIC_HOST: publicHost, REVIEW_API_PORT: apiPort },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function ready(child) {
  let output = '';
  let errors = '';
  child.stderr.on('data', (chunk) => { errors += chunk; });
  let timer;
  try {
    await Promise.race([
      new Promise((done, fail) => {
        child.stdout.on('data', (chunk) => {
          output += chunk;
          if (output.includes('CyP review gateway:')) done();
        });
        child.once('exit', (code) => fail(new Error(`Review server exited before ready (${code}): ${errors}`)));
      }),
      new Promise((_, fail) => { timer = setTimeout(() => fail(new Error('Review server startup timed out')), 5000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function exited(child) {
  let timer;
  let code;
  try {
    code = await Promise.race([
      new Promise((done) => child.once('exit', done)),
      new Promise((_, fail) => { timer = setTimeout(() => fail(new Error('Review server did not exit')), 5000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  assert.notEqual(code, 0);
}

async function stop(child) {
  if (child.exitCode !== null) return;
  const done = new Promise((resolveExit) => child.once('exit', resolveExit));
  child.kill('SIGTERM');
  await done;
}

function request(port, path, { method = 'GET', host = '127.0.0.1', cookie, body, contentType } = {}) {
  return new Promise((done, fail) => {
    const headers = { Host: host };
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) {
      headers['Content-Type'] = contentType ?? 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', fail);
    req.end(body);
  });
}

test('public review invitation protects every host and route; local mode remains open', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cyp-review-invite-'));
  assert.ok(resolve(fixture).startsWith(resolve(tmpdir()) + sep));
  const script = join(fixture, 'scripts', 'serve-review.mjs');
  const local = join(fixture, '.local');
  const admin = join(local, 'review-build', 'one-link-admin');
  const collector = join(local, 'review-build', 'one-link-collector');
  let child;
  try {
    await Promise.all([mkdir(dirname(script), { recursive: true }), mkdir(join(admin, 'assets'), { recursive: true }), mkdir(collector, { recursive: true })]);
    await copyFile(source, script);
    await Promise.all([
      writeFile(join(admin, 'index.html'), 'ADMIN_FIXTURE'),
      writeFile(join(admin, 'assets', 'fixture.js'), 'ASSET_FIXTURE'),
      writeFile(join(collector, 'index.html'), 'COLLECTOR_FIXTURE'),
    ]);
    const port = await freePort();
    child = launch(script, port, 'demo.example.test');
    await exited(child);
    child = undefined;

    const privateDir = join(local, 'review-private');
    await mkdir(privateDir, { mode: 0o700 });
    const codeFile = join(privateDir, 'invite-code');
    const code = randomBytes(32).toString('base64url');
    await writeFile(codeFile, code, { mode: 0o600 });
    if (process.platform === 'win32') {
      child = launch(script, port, 'demo.example.test');
      await exited(child);
      child = undefined;
    }
    await restrictWindowsInvite(privateDir, codeFile);
    await writeFile(codeFile, 'too-short');
    child = launch(script, port, 'demo.example.test');
    await exited(child);
    child = undefined;
    await writeFile(codeFile, code);
    child = launch(script, port, 'demo.example.test', '3011');
    await exited(child);
    child = undefined;

    child = launch(script, port, 'demo.example.test');
    await ready(child);
    for (const path of ['/', '/collector/', '/assets/fixture.js']) {
      const response = await request(port, path);
      assert.equal(response.status, 303);
      assert.equal(response.headers.location, '/acceso-demo');
    }
    assert.equal((await request(port, '/api/health')).status, 401);
    assert.equal((await request(port, '/assets/fixture.js', { host: 'demo.example.test' })).status, 303);
    assert.equal((await request(port, '/acceso-demo')).status, 200);
    assert.equal((await request(port, '/acceso-demo', { method: 'POST', body: 'codigo=x', contentType: 'text/plain' })).status, 415);
    assert.equal((await request(port, '/acceso-demo', { method: 'POST', body: `codigo=${'x'.repeat(1025)}` })).status, 413);
    assert.equal((await request(port, '/acceso-demo', { method: 'POST', body: 'codigo=incorrecto' })).status, 403);
    const login = await request(port, '/acceso-demo', { method: 'POST', body: `codigo=${encodeURIComponent(code)}` });
    assert.equal(login.status, 303);
    const cookie = login.headers['set-cookie']?.[0];
    assert.match(cookie, /^__Host-cyp-review=[A-Za-z0-9_-]{43};/);
    for (const flag of ['Path=/', 'Max-Age=1800', 'HttpOnly', 'Secure', 'SameSite=Lax']) assert.ok(cookie.includes(flag));
    const session = cookie.split(';')[0];
    assert.equal((await request(port, '/', { cookie: session })).body, 'ADMIN_FIXTURE');
    assert.equal((await request(port, '/collector/', { cookie: session })).body, 'COLLECTOR_FIXTURE');
    const asset = await request(port, '/assets/fixture.js', { cookie: session, host: 'demo.example.test' });
    assert.equal(asset.body, 'ASSET_FIXTURE');
    assert.equal(asset.headers['cache-control'], 'private, no-store');
    assert.equal((await request(port, '/', { cookie: session, host: 'wrong.example.test' })).status, 403);
    assert.equal((await request(port, '/assets/fixture.js', { cookie: `${session}; ${session}` })).status, 303);
    await stop(child);
    child = undefined;

    await rm(codeFile);
    child = launch(script, port, '');
    await ready(child);
    assert.equal((await request(port, '/')).body, 'ADMIN_FIXTURE');
    assert.equal((await request(port, '/assets/fixture.js')).headers['cache-control'], 'public, max-age=31536000, immutable');
  } finally {
    if (child) await stop(child);
    await rm(fixture, { recursive: true, force: true });
  }
});
