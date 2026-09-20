// Cliente CDP minimo para inspeccionar el sitio legado en Opera GX
const CDP_HTTP = 'http://127.0.0.1:9222';

async function listTargets() {
  const r = await fetch(`${CDP_HTTP}/json/list`);
  return r.json();
}
async function findOrCreateTab(url) {
  const list = await listTargets();
  const existing = list.find(t => t.type === 'page' && t.url.includes('cypdemo'));
  if (existing) return existing;
  const r = await fetch(`${CDP_HTTP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  return r.json();
}

export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws connect failed')); });
  let mid = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method) events.push(m);
  };
  const send = (method, params = {}, timeout = 20000) =>
    new Promise((res, rej) => {
      const id = ++mid;
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
    });
  const drain = () => { const out = events.slice(); events.length = 0; return out; };
  const close = () => { try { ws.close(); } catch {} };
  return { send, drain, close };
}

export { findOrCreateTab, listTargets };
