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
    const btns = [...w.querySelectorAll('table.x-btn, .x-btn, button, .x-menu-item, a.x-menu-item, .x-toolbar .x-btn-text')]
      .map(b => ({ txt: (b.innerText||b.value||'').trim().slice(0,30), id: b.id, vis: getComputedStyle(b).display, h: b.offsetHeight }))
      .filter(x => x.txt || x.id);
    out.push({ win: t||'(sintitulo)', wid: w.id, z: w.style.zIndex, btns });
  }
  return JSON.stringify(out, null, 1);
})()`);
console.log(inv);
c.close();
