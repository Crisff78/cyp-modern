import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = async (e) => { const rr = await c.send('Runtime.evaluate', { expression: e, returnByValue: true }); return rr.result?.result?.value; };

const f = await run(`(() => { const u=document.getElementById('O93_id'); if(!u) return null; const r=u.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`);
console.log("campo usuario en:", JSON.stringify(f));
if (!f) { console.log("NO HAY LOGIN - ya logueado?"); c.close(); process.exit(0); }
await c.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:f.x, y:f.y });
await sleep(200);
await c.send('Input.dispatchMouseEvent', { type:'mousePressed', x:f.x, y:f.y, button:'left', clickCount:1 });
await c.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:f.x, y:f.y, button:'left', clickCount:1 });
await sleep(1000);
await run(`(() => { document.getElementById('O93_id').focus(); return 1; })()`);
await sleep(800);
for (let i=0;i<4;i++) {
  await c.send('Input.dispatchKeyEvent', { type:'keyDown', key:'ArrowDown', code:'ArrowDown', windowsVirtualKeyCode:40 });
  await c.send('Input.dispatchKeyEvent', { type:'keyUp', key:'ArrowDown', code:'ArrowDown', windowsVirtualKeyCode:40 });
  await sleep(600);
}
await sleep(1000);
const chk = await run(`(() => { const u=document.getElementById('O93_id'); const p=document.getElementById('O9B_id'); return {u: u?u.value:'?', pLen: p?p.value.length:-1}; })()`);
console.log("tras flechas:", JSON.stringify(chk));
// si el usuario se lleno, pulsar Enter para que la sugerencia de clave se aplique
if (chk.u && chk.u.length > 0) {
  await c.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Enter', code:'Enter', windowsVirtualKeyCode:13 });
  await c.send('Input.dispatchKeyEvent', { type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13 });
  await sleep(1200);
}
const chk2 = await run(`(() => { const u=document.getElementById('O93_id'); const p=document.getElementById('O9B_id'); return {u: u?u.value:'?', pLen: p?p.value.length:-1}; })()`);
console.log("tras enter:", JSON.stringify(chk2));
// clic en Ok
const L = await run(`(() => { const el=document.getElementById('O87_id'); if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`);
if (L) {
  await c.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:L.x, y:L.y });
  await sleep(250);
  await c.send('Input.dispatchMouseEvent', { type:'mousePressed', x:L.x, y:L.y, button:'left', clickCount:1 });
  await c.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:L.x, y:L.y, button:'left', clickCount:1 });
  await sleep(6000);
}
const fin = await run(`(() => (document.body.innerText||'').slice(0,250))()`);
console.log("FINAL:", JSON.stringify(fin));
c.close();
