import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const cdp = await connect(tab.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const run = async (expr) => (await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
const clickAt = async (x,y) => {
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseMoved', x, y });
  await sleep(200);
  await cdp.send('Input.dispatchMouseEvent', { type:'mousePressed', x, y, button:'left', clickCount:1 });
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseReleased', x, y, button:'left', clickCount:1 });
};
const no = await run(`(() => { const w=[...document.querySelectorAll('.x-window')].find(w=>(w.querySelector('.x-window-header-text')?.innerText||'').trim()==='Confirm'); if(!w) return null; const b=[...w.querySelectorAll('.x-btn-text, table.x-btn, button')].find(x=>(x.innerText||'').trim()==='No'); const r=b.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`);
console.log('NO btn:', JSON.stringify(no));
if (no) { await clickAt(no.x, no.y); await sleep(1200); }
const v0 = await run(`(() => [...document.querySelectorAll('.x-window')].filter(w=>getComputedStyle(w).display!=='none' && (w.querySelector('.x-window-header-text')?.innerText||'').trim()).map(w=>({title:(w.querySelector('.x-window-header-text')?.innerText||'').trim(), z:parseInt(w.style.zIndex||'0',10)})))()`);
console.log('VENTANAS:', JSON.stringify(v0));
const L = await run(`(() => { const el=document.getElementById('O174_id'); if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2, vis:getComputedStyle(el).display}; })()`);
console.log('LOC Cargos:', JSON.stringify(L));
await clickAt(L.x, L.y);
await sleep(3500);
const v1 = await run(`(() => [...document.querySelectorAll('.x-window')].filter(w=>getComputedStyle(w).display!=='none' && (w.querySelector('.x-window-header-text')?.innerText||'').trim()).map(w=>({title:(w.querySelector('.x-window-header-text')?.innerText||'').trim(), z:parseInt(w.style.zIndex||'0',10)})))()`);
console.log('DESPUES CLIC:', JSON.stringify(v1));
cdp.close();