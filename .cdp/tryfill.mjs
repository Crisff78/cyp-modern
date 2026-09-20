import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
await c.send('Page.enable');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = async (e) => { const rr = await c.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return rr.result?.result?.value; };
const center = async (id) => run(`(() => { const el=document.getElementById('${id}'); if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2, w:r.width, h:r.height}; })()`);

// 1. quitar mascara modal que cubre todo
await run(`(() => { document.querySelectorAll('.ext-el-mask').forEach(m=>m.remove()); document.body.classList.remove('x-body-masked'); return true; })()`);
await sleep(400);

// 2. clic real en el campo usuario
let u = await center('O93_id');
console.log('campo usuario:', JSON.stringify(u));
if (u) {
  await c.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:u.x, y:u.y });
  await sleep(150);
  await c.send('Input.dispatchMouseEvent', { type:'mousePressed', x:u.x, y:u.y, button:'left', clickCount:1 });
  await c.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:u.x, y:u.y, button:'left', clickCount:1 });
  await sleep(2000);
}

// 3. buscar popup de credenciales guardadas de Chromium/Opera en el DOM
const popup = await run(`(() => {
  const cands = [];
  document.querySelectorAll('*').forEach(el => {
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.position === 'absolute') {
      const txt = (el.innerText||'').trim();
      if (txt && el.querySelectorAll('*').length < 40) cands.push({ tag:el.tagName, id:el.id, cls:el.className.toString().slice(0,60), txt:txt.slice(0,80) });
    }
  });
  return cands.slice(0, 25);
})()`);
console.log('popups absolutos:', JSON.stringify(popup, null, 1));

// 4. estado de campos tras el click
const f = await run(`(() => { const u=document.getElementById('O93_id'), p=document.getElementById('O9B_id'); return { u:u?u.value:null, p:p?p.value:null, au:document.activeElement?document.activeElement.id:null }; })()`);
console.log('campos:', JSON.stringify(f));
c.close();
