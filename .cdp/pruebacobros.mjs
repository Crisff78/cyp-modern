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

const antes = await run(`(() => { const el=document.getElementById('O10C_id'); const r=el.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}; })()`);
console.log('COORD Cobros:', JSON.stringify(antes));
await clickAt(antes.x, antes.y);
await sleep(1800);

const despues = await run(`(() => {
  const out = {};
  // submenus Ext desplegados
  out.menus = [...document.querySelectorAll('.x-menu, .x-menu-floating')].filter(m=>getComputedStyle(m).display!=='none').map(m=>({
    id: m.id, txt: (m.innerText||'').replace(/\\n/g,' | ').slice(0,300),
    items: [...m.querySelectorAll('.x-menu-item, .x-menu-list-item, li')].map(li=>({txt:(li.innerText||'').trim().slice(0,30), id: li.id || li.querySelector('a')?.id})).filter(x=>x.txt),
    x: Math.round(m.getBoundingClientRect().x), y: Math.round(m.getBoundingClientRect().y)
  }));
  out.windows = [...document.querySelectorAll('.x-window')].filter(w=>getComputedStyle(w).display!=='none').map(w=>({t:(w.querySelector('.x-window-header-text')?.innerText||'').trim(), z:w.style.zIndex, id:w.id}));
  return JSON.stringify(out);
})()`);
console.log('DESPUES:', despues);
c.close();
