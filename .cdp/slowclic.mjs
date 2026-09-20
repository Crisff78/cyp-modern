import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const run = async (e) => (await c.send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

const attrs = await run(`(() => {
  const w = document.getElementById('O10C_id');
  if (!w) return 'no-existe';
  const a = w.querySelector('a');
  const out = { html: w.outerHTML.slice(0,600), td: null, aHtml: a ? a.outerHTML.slice(0,400) : null };
  const td = document.getElementById('O10C_id_td');
  if (td) out.td = td.outerHTML.slice(0,400);
  return JSON.stringify(out);
})()`);
console.log('ATTRS Cobros:', attrs);

const titulos = async () => run(`(() => JSON.stringify([...document.querySelectorAll('.x-window')].filter(w=>getComputedStyle(w).display!=='none').map(w=>({t:(w.querySelector('.x-window-header-text')?.innerText||'').trim(), z:w.style.zIndex, id:w.id})).filter(x=>x.t)) )()`);
const antes = await titulos();
console.log('ANTES:', antes);

const L = await run(`(() => { const el=document.getElementById('O10C_id_td')||document.getElementById('O10C_id'); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`);
await c.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:L.x, y:L.y });
await sleep(250);
await c.send('Input.dispatchMouseEvent', { type:'mousePressed', x:L.x, y:L.y, button:'left', clickCount:1 });
await c.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:L.x, y:L.y, button:'left', clickCount:1 });
await sleep(8000);
const despues = await titulos();
console.log('DESPUES (8s):', despues);
c.close();
