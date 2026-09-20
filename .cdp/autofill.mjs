import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const run = async (e) => { const rr = await c.send('Runtime.evaluate', { expression: e, returnByValue: true }); return rr.result?.result?.value; };

// enfocar campo usuario por coordenadas reales
const L = await run(`(() => { const el=document.getElementById('O93_id'); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`);
await c.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:L.x, y:L.y });
await sleep(200);
await c.send('Input.dispatchMouseEvent', { type:'mousePressed', x:L.x, y:L.y, button:'left', clickCount:1 });
await c.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:L.x, y:L.y, button:'left', clickCount:1 });
await sleep(900);
//.focus via DOM
await run(`(() => { document.getElementById('O93_id').focus(); return 1; })()`);
await sleep(800);
// pulsar flecha abajo para abrir el dropdown de contraseñas guardadas
for (let i=0;i<3;i++) {
  await c.send('Input.dispatchKeyEvent', { type:'keyDown', key:'ArrowDown', code:'ArrowDown', windowsVirtualKeyCode:40 });
  await c.send('Input.dispatchKeyEvent', { type:'keyUp', key:'ArrowDown', code:'ArrowDown', windowsVirtualKeyCode:40 });
  await sleep(500);
}
await sleep(800);
const chk = await run(`(() => {
  const u = document.getElementById('O93_id');
  const p = document.getElementById('O9B_id');
  // buscar cualquier dropdown/sugerencia de autocompletar visible
  const sug = [...document.querySelectorAll('[role=listbox], .autocomplete-suggestions, [bubbletagname]')].length;
  return JSON.stringify({ u: u?.value||'', pLen: p?.value?.length||0, sug });
})()`);
console.log('TRAS FLECHAS:', chk);
c.close();
