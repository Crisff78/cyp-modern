import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const cdp = await connect(tab.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const ev = await cdp.send('Runtime.evaluate', { expression: `(() => {
  const out = {};
  out.hasExt = typeof Ext !== 'undefined';
  const wins = [...document.querySelectorAll('.x-window')].filter(w => getComputedStyle(w).display !== 'none');
  const w = wins.find(w => (w.querySelector('.x-window-header-text')?.innerText||'').trim() === 'Listado de Clientes');
  if (!w) return { ...out, err: 'no-window' };
  out.winId = w.id;
  if (out.hasExt) {
    try {
      const cmp = Ext.getCmp(w.id);
      out.cmpFound = !!cmp;
      if (cmp) { cmp.close(); out.closed = true; }
    } catch (e) { out.err = String(e); }
  }
  return out;
})()`, returnByValue: true });
console.log('CLOSE EXT:', JSON.stringify(ev.result?.result?.value));
await sleep(1500);
const ev2 = await cdp.send('Runtime.evaluate', { expression: `(() => [...document.querySelectorAll('.x-window')].filter(w=>getComputedStyle(w).display!=='none' && (w.querySelector('.x-window-header-text')?.innerText||'').trim()).map(w=>({title:(w.querySelector('.x-window-header-text')?.innerText||'').trim(), z:parseInt(w.style.zIndex||'0',10)})))()`, returnByValue: true });
console.log('VENTANAS:', JSON.stringify(ev2.result?.result?.value));
cdp.close();