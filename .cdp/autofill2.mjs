import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = async (e) => { const rr = await c.send('Runtime.evaluate', { expression: e, returnByValue: true }); return rr.result?.result?.value; };
const key = async (k, code, vk) => {
  await c.send('Input.dispatchKeyEvent', { type:'rawKeyDown', key:k, code, windowsVirtualKeyCode:vk });
  await c.send('Input.dispatchKeyEvent', { type:'keyUp', key:k, code, windowsVirtualKeyCode:vk });
};
const chk = async () => run(`(() => { const u=document.getElementById('O93_id'); const p=document.getElementById('O9B_id'); return {u: u?u.value:'?', pLen: p?p.value.length:-1}; })()`);

await run(`(() => { const u=document.getElementById('O93_id'); if(u) u.focus(); return 1; })()`);
await sleep(600);
// teclear 'a' para activar el popup de credenciales
await key('a', 'KeyA', 65);
await sleep(800);
console.log("tras 'a':", JSON.stringify(await chk()));
// flecha abajo + enter para elegir la sugerencia
for (let i=0;i<3;i++) { await key('ArrowDown','ArrowDown',40); await sleep(400); }
await key('Enter','Enter',13);
await sleep(1000);
console.log("tras enter:", JSON.stringify(await chk()));
// borrar lo tecleado si quedo 'a' suelto y reintentar flechas
const v = await run(`(() => document.getElementById('O93_id')?.value || '')()`);
if (v === 'a') {
  await key('Backspace','Backspace',8); await sleep(400);
  for (let i=0;i<3;i++) { await key('ArrowDown','ArrowDown',40); await sleep(400); }
  await key('Enter','Enter',13); await sleep(1000);
  console.log("retry:", JSON.stringify(await chk()));
}
c.close();
