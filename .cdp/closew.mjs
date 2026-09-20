import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const cdp = await connect(tab.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const locEl = async (expr) => (await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
const clickAt = async (x,y) => {
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseMoved', x, y });
  await sleep(200);
  await cdp.send('Input.dispatchMouseEvent', { type:'mousePressed', x, y, button:'left', clickCount:1 });
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseReleased', x, y, button:'left', clickCount:1 });
};
const list = await locEl(`(() => [...document.querySelectorAll('.x-window')].filter(w=>getComputedStyle(w).display!=='none').map(w=>({title:(w.querySelector('.x-window-header-text')?.innerText||'').trim(), z:parseInt(w.style.zIndex||'0',10), hasClose: !!w.querySelector('.x-tool-close'), closeRect: (()=>{const t=w.querySelector('.x-tool-close'); if(!t) return null; const r=t.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2};})()})))()`);
console.log('ANTES:', JSON.stringify(list, null, 1));
// cerrar la ventana de modulo (todo lo que no sea Opciones/Confirm/Monitor de Cobradores/header)
for (const w of list) {
  if (!w.title || w.title==='Opciones' || w.title==='Confirm' || w.title==='Monitor de Cobradores') continue;
  if (w.closeRect) { await clickAt(w.closeRect.x, w.closeRect.y); await sleep(1000); }
}
const list2 = await locEl(`(() => [...document.querySelectorAll('.x-window')].filter(w=>getComputedStyle(w).display!=='none').map(w=>({title:(w.querySelector('.x-window-header-text')?.innerText||'').trim(), z:parseInt(w.style.zIndex||'0',10)})))()`);
console.log('DESPUES:', JSON.stringify(list2));
cdp.close();