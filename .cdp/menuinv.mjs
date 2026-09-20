import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const run = async (e) => (await c.send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

const inv = await run(`(() => {
  const out = [];
  const wins = [...document.querySelectorAll('.x-window')].filter(w => getComputedStyle(w).display !== 'none');
  for (const w of wins) {
    const t = (w.querySelector('.x-window-header-text')?.innerText||'').trim();
    out.push({ win: t, z: w.style.zIndex, id: w.id });
    const items = [...w.querySelectorAll('.x-menu-item')];
    for (const it of items) {
      const txt = (it.innerText||'').trim();
      const a = it.querySelector('a');
      const sub = !!it.querySelector('.x-menu-item-arrow');
      const r = it.getBoundingClientRect();
      out.push({ item: txt, id: it.id, anc: a?.id||null, sub, vis: getComputedStyle(it).display, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), padre: t });
    }
  }
  return JSON.stringify(out);
})()`);
console.log(inv);
c.close();
