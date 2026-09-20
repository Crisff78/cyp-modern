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

const b = await run(`(() => (document.body.innerText||'').includes('Desea salir'))()`);
console.log('body contiene Desea salir?', b);

// minimizar Listado de Clientes residual y Monitor para dejar paso limpio
await run(`(() => { for (const id of ['O2D8_id']) { try { Ext.getCmp(id).minimize(); } catch(e){} } return 1; })()`);
await sleep(600);

const L = await run(`(() => { const el=document.getElementById('O10C_id'); const r=el.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}; })()`);
console.log('clic Cobros en', JSON.stringify(L));
await clickAt(L.x, L.y);
await sleep(2500);

const despues = await run(`(() => {
  const out = {};
  out.menus = [...document.querySelectorAll('.x-menu')].filter(m=>getComputedStyle(m).display!=='none').map(m=>({id:m.id, txt:(m.innerText||'').replace(/\\n/g,' | ').slice(0,400)}));
  out.windows = [...document.querySelectorAll('.x-window')].filter(w=>getComputedStyle(w).display!=='none')
    .map(w=>({t:(w.querySelector('.x-window-header-text')?.innerText||'').trim(), z:w.style.zIndex, id:w.id}))
    .filter(x=>x.t);
  return JSON.stringify(out);
})()`);
console.log('DESPUES clic Cobros:', despues);
c.close();
