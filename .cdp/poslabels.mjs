import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const run = async (e) => (await c.send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

const est = await run(`(() => {
  const out = {};
  for (const id of ['O11B_id','O12A_id','O1FB_id']) {
    const w = document.getElementById(id);
    if (!w) { out[id]='gone'; continue; }
    const r = w.getBoundingClientRect();
    out[id] = { hReal: Math.round(r.height), clip: w.style.clip||'', ovf: getComputedStyle(w).overflow };
  }
  // posiciones reales de labels clave
  const labels = {};
  for (const id of ['O16C_id','O164_id','O174_id','O184_id','O18C_id','O14C_id','O1C1_id','O1D1_id','O1D9_id','O20E_id','O216_id','O21E_id','O226_id']) {
    const el = document.getElementById(id);
    if (!el) { labels[id]='gone'; continue; }
    const r = el.getBoundingClientRect();
    labels[id] = { x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height), vis:getComputedStyle(el).display };
  }
  return JSON.stringify({cuerpos:out, labels});
})()`);
console.log(est);
c.close();
