import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const cdp = await connect(tab.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
// localizar el campo de usuario en la ventana
const pos = await cdp.send('Runtime.evaluate', { expression: `(() => {
  const el = document.getElementById('O93_id');
  const r = el.getBoundingClientRect();
  return {x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height};
})()`, returnByValue: true });
const p = pos.result.result.value;
console.log('pos usuario:', JSON.stringify(p));
// click real con el dominio Input
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
await new Promise(r => setTimeout(r, 1500));
// presionar Tab y flecha abajo para abrir el dropdown de autofill
await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
await new Promise(r => setTimeout(r, 800));
for (let i=0;i<3;i++){
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  await new Promise(r => setTimeout(r, 400));
}
await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await new Promise(r => setTimeout(r, 1500));
const ev = await cdp.send('Runtime.evaluate', { expression: `(() => {
  const u = document.getElementById('O93_id'), p2 = document.getElementById('O9B_id');
  return { usuario: u.value ? '[len='+u.value.length+']='+u.value.slice(0,2)+'...' : '', clave: p2.value ? '[len='+p2.value.length+']' : '' };
})()`, returnByValue: true });
console.log('TRAS INPUT REAL:', JSON.stringify(ev.result?.result?.value ?? ev));
cdp.close();
