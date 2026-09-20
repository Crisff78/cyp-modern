import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
await c.send('Page.enable');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = async (e) => { const rr = await c.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return rr.result?.result?.value; };
const key = async (k) => { await c.send('Input.dispatchKeyEvent', { type:'keyDown', key:k, code:k.replace('Arrow','Arrow'), windowsVirtualKeyCode: k==='ArrowDown'?40:13 }); await c.send('Input.dispatchKeyEvent', { type:'keyUp', key:k }); };
const center = async (id) => run(`(() => { const el=document.getElementById('${id}'); if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`);
const campos = () => run(`(() => { const u=document.getElementById('O93_id'), p=document.getElementById('O9B_id'); return { u:u?u.value.length:-1, p:p?p.value.length:-1 }; })()`);

const u = await center('O93_id');
await c.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:u.x, y:u.y });
await sleep(120);
await c.send('Input.dispatchMouseEvent', { type:'mousePressed', x:u.x, y:u.y, button:'left', clickCount:1 });
await c.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:u.x, y:u.y, button:'left', clickCount:1 });
await sleep(1500);
console.log('tras click usuario:', JSON.stringify(await campos()));
for (let i = 0; i < 3; i++) { await key('ArrowDown'); await sleep(400); }
await sleep(500);
console.log('tras 3 flechas:', JSON.stringify(await campos()));
await key('Enter');
await sleep(2500);
console.log('tras Enter:', JSON.stringify(await campos()));
// screenshot de la zona del login para ver si aparece dropdown de credenciales
const shot = await c.send('Page.captureScreenshot', { format:'png', clip:{ x: Math.max(0,u.x-420), y: Math.max(0,u.y-90), width:840, height:420, scale:1 } });
if (shot && shot.data) {
  const fs = await import('node:fs');
  fs.writeFileSync('.cdp/loginregion.png', Buffer.from(shot.data, 'base64'));
  console.log('screenshot guardado en .cdp/loginregion.png');
}
c.close();
