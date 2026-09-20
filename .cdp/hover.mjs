import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const run = async (e) => (await c.send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

const snapshot = async () => run(`(() => {
  const els = [...document.querySelectorAll('*')].map(e=>e.id).filter(Boolean);
  return els;
})()`);

const antes = await snapshot();
// HOVER sobre Cobros: mover el mouse lentamente hasta el item
const L = await run(`(() => { const el=document.getElementById('O10C_id'); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`);
await c.send('Input.dispatchMouseEvent', { type:'mouseMoved', x: 400, y: 400 });
await sleep(300);
for (let y=400; y<=L.y; y+=60) { await c.send('Input.dispatchMouseEvent', { type:'mouseMoved', x: L.x, y }); await sleep(120); }
await c.send('Input.dispatchMouseEvent', { type:'mouseMoved', x: L.x, y: L.y });
await sleep(1500);
const trasHover = await run(`(() => {
  const menus = [...document.querySelectorAll('.x-menu,.x-menu-floating,.ux-menu,.x-layer')].filter(m=>getComputedStyle(m).display!=='none')
    .map(m=>({id:m.id, cls:m.className, txt:(m.innerText||'').replace(/\\n/g,' | ').slice(0,300)}));
  return JSON.stringify(menus);
})()`);
console.log('TRAS HOVER menus:', trasHover);
const despues = await snapshot();
const nuevos = despues.filter(x=>!antes.includes(x));
console.log('IDS NUEVOS tras hover:', JSON.stringify(nuevos));
c.close();
