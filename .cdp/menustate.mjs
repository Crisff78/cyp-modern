import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const run = async (e) => { const rr = await c.send('Runtime.evaluate', { expression: e, returnByValue: true }); return rr.result?.result?.value; };
const info = await run(`(() => {
  const out = { masks: [], ventanas: [], labels: [] };
  for (const m of [...document.querySelectorAll('.ext-el-mask')]) out.masks.push({ id: m.id, z: getComputedStyle(m).zIndex });
  for (const w of [...document.querySelectorAll('.x-window')]) {
    const cs = getComputedStyle(w);
    out.ventanas.push({ id: w.id, t: (w.querySelector('.x-window-header-text')?.innerText||'').trim().slice(0,30), disp: cs.display, z: cs.zIndex });
  }
  // labels del menu Opciones: buscar dentro de la region del menu
  const menu = document.getElementById('OBF_id');
  out.menuExiste = !!menu;
  const root = menu || document;
  for (const el of [...root.querySelectorAll('.x-menu-item-text, .x-menu-item')]) {
    const t = (el.innerText||'').trim();
    if (!t) continue;
    const r = el.getBoundingClientRect();
    out.labels.push({ id: el.closest('.x-menu-item')?.id || el.id, t: t.slice(0,22), x: Math.round(r.x), y: Math.round(r.y), h: Math.round(r.height) });
  }
  return out;
})()`);
console.log(JSON.stringify(info, null, 1));
c.close();
