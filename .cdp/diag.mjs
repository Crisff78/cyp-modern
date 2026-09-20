import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const run = async (e) => { const rr = await c.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return rr.result?.result?.value; };

// 1. inventario de ventanas abiertas
const wins = await run(`(() => [...document.querySelectorAll('.x-window')].filter(w=>getComputedStyle(w).display!=='none').map(w=>({id:w.id, t:(w.querySelector('.x-window-header-text')?.innerText||'').trim(), z:w.style.zIndex, kids:[...w.children].map(k=>k.className.toString().slice(0,40)).join(' / ')})))()`);
console.log('VENTANAS:', JSON.stringify(wins, null, 1));

// 2. estructura interna de la ventana Descargos (O4EE)
const est = await run(`(() => {
  const w = document.getElementById('O4EE_id');
  if (!w) return null;
  const clases = {};
  for (const el of w.querySelectorAll('*')) { const cl = (el.className||'').toString(); if (cl) clases[cl] = (clases[cl]||0)+1; }
  return { clasesTop: Object.entries(clases).sort((a,b)=>b[1]-a[1]).slice(0,30), grid3: w.querySelectorAll('.x-grid3').length, grid: w.querySelectorAll('.x-grid').length, panel: w.querySelectorAll('.x-panel').length, hijos: [...w.children].map(k=>k.className.toString().slice(0,50)) };
})()`);
console.log('O4EE estructura:', JSON.stringify(est, null, 1));

// 3. innerHTML de un item del grupo Cerrar
const cerrar = await run(`(() => {
  const ids = ['O150_id','O154_id','O158_id','O15C_id'];
  return ids.map(id => { const el = document.getElementById(id); if (!el) return {id, nulo:true};
    return { id, html: el.innerHTML.slice(0, 300), txtHijos: [...el.querySelectorAll('*')].map(h=>(h.innerText||'').trim()).filter(Boolean).slice(0,8) }; });
})()`);
console.log('CERRAR items:', JSON.stringify(cerrar, null, 1));
c.close();
