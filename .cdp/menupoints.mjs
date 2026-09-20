import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const run = async (e) => { const rr = await c.send('Runtime.evaluate', { expression: e, returnByValue: true }); return rr.result?.result?.value; };
const info = await run(`(() => {
  const menu = document.getElementById('OBF_id');
  const mr = menu.getBoundingClientRect();
  const out = { menu: { x: Math.round(mr.x), y: Math.round(mr.y), w: Math.round(mr.width), h: Math.round(mr.height) }, items: [] };
  const ids = ['O164_id','O16C_id','O10C_id','O12A_id','O174_id','O17C_id','O184_id','O18C_id','O19F_id','O1AE_id','O1C1_id','O1C9_id','O1D1_id','O1D9_id','O1EC_id','O1FB_id','O20E_id','O216_id','O21E_id','O226_id','O14C_id','O20A_id','O212_id','O21A_id','O222_id'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) { out.items.push({ id, t: 'NO-EXISTE' }); continue; }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    out.items.push({ id, t: (el.innerText||'').trim().slice(0,24), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), disp: cs.display });
  }
  return out;
})()`);
console.log(JSON.stringify(info, null, 1));
c.close();
