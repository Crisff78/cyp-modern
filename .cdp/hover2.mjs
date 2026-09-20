import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const run = async (e) => (await c.send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

const snap = async () => run(`(() => [...document.querySelectorAll('.x-window,.x-menu,.x-layer,.x-panel')].map(e=>e.id).filter(Boolean))()`);

const antes = await snap();
const L = await run(`(() => { const el=document.getElementById('O10C_id'); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`);
console.log('item Cobros en', JSON.stringify(L));
await c.send('Input.dispatchMouseEvent', { type:'mouseMoved', x: 400, y: 400 });
await sleep(300);
for (let y=400; y<=L.y; y+=80) { await c.send('Input.dispatchMouseEvent', { type:'mouseMoved', x: L.x, y }); await sleep(120); }
await c.send('Input.dispatchMouseEvent', { type:'mouseMoved', x: L.x, y: L.y });
await sleep(1600);
const menus = await run(`(() => JSON.stringify([...document.querySelectorAll('.x-menu,.x-menu-floating,.ux-menu,.x-layer')].filter(m=>getComputedStyle(m).display!=='none').map(m=>({id:m.id, cls:(m.className||'').toString().slice(0,60), txt:(m.innerText||'').replace(/\\n/g,' | ').slice(0,250)}))) )()`);
console.log('TRAS HOVER menus:', menus);
const despues = await snap();
console.log('IDS NUEVOS:', JSON.stringify(despues.filter(x=>!antes.includes(x))));
c.close();
