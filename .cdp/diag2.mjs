import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const run = async (e) => { const rr = await c.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return rr.result?.result?.value; };

// estructura del Panel de Control O2CD
const pc = await run(`(() => {
  const w = document.getElementById('O2CD_id');
  if (!w) return null;
  return {
    title: (w.querySelector('.x-window-header-text')?.innerText||'').trim(),
    tabs: [...w.querySelectorAll('.x-tab-strip-text, .x-tab-inner, .x-tab-strip li')].map(e=>({cls:(e.className||'').toString().slice(0,60), txt:(e.innerText||'').trim().slice(0,40)})),
    grids: [...w.querySelectorAll('.x-grid3')].map(g=>g.id),
    paneles: [...w.querySelectorAll('.x-panel')].map(p=>({id:p.id, t:(p.querySelector('.x-panel-header-text')?.innerText||'').trim().slice(0,40)})),
    texto: (w.innerText||'').replace(/\\n\\s*\\n/g,'\\n').slice(0,800)
  };
})()`);
console.log('PANEL DE CONTROL:', JSON.stringify(pc, null, 1));

// estructura del menu lateral O2DD (opciones de configuracion)
const mn = await run(`(() => {
  const w = document.getElementById('O2DD_id');
  if (!w) return null;
  return {
    items: [...w.querySelectorAll('label, .x-menu-item, .x-panel-header')].map(e=>({id:e.id, cls:(e.className||'').toString().slice(0,50), txt:(e.innerText||'').trim().slice(0,40)})),
  };
})()`);
console.log('MENU CFG (O2DD):', JSON.stringify(mn, null, 1));
c.close();
