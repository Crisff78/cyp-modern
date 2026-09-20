import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const run = async (e) => (await c.send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
const clickAt = async (x,y) => {
  await c.send('Input.dispatchMouseEvent', { type:'mouseMoved', x, y });
  await sleep(200);
  await c.send('Input.dispatchMouseEvent', { type:'mousePressed', x, y, button:'left', clickCount:1 });
  await c.send('Input.dispatchMouseEvent', { type:'mouseReleased', x, y, button:'left', clickCount:1 });
};

// localizar y clicar el boton "No" del Confirm
const L = await run(`(() => {
  const w = document.getElementById('ext-comp-1042');
  if (!w || getComputedStyle(w).display==='none') return {ok:false};
  const btns = [...w.querySelectorAll('button, table.x-btn, .x-btn-text')];
  const no = btns.find(b => (b.innerText||'').trim()==='No');
  if (!no) return {ok:false, n:btns.length};
  const r = no.getBoundingClientRect();
  return {ok:true, x:r.x+r.width/2, y:r.y+r.height/2};
})()`);
console.log('BTN No:', JSON.stringify(L));
if (L.ok) { await clickAt(L.x, L.y); await sleep(1200); }

const estado = await run(`(() => {
  const conf = document.getElementById('ext-comp-1042');
  const confirmVisible = conf && getComputedStyle(conf).display!=='none';
  const wins = [...document.querySelectorAll('.x-window')].filter(w=>getComputedStyle(w).display!=='none').map(w=>({t:(w.querySelector('.x-window-header-text')?.innerText||'').trim(), z:w.style.zIndex, id:w.id}));
  const logueado = (document.body.innerText||'').includes('Usuario: Administrador');
  return JSON.stringify({confirmVisible, logueado, wins});
})()`);
console.log('ESTADO:', estado);
c.close();
