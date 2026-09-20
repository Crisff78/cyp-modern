import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const cdp = await connect(tab.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
// enfocar usuario y luego clave para disparar autofill de Opera
for (const id of ['O93_id','O9B_id']) {
  await cdp.send('Runtime.evaluate', { expression: `(() => { const el = document.getElementById('${id}'); el.focus(); el.click(); return el.id; })()` });
  await new Promise(r => setTimeout(r, 1200));
}
const ev = await cdp.send('Runtime.evaluate', { expression: `(() => {
  const u = document.getElementById('O93_id'), p = document.getElementById('O9B_id'), e = document.getElementById('OA7_id');
  return { usuario: u.value ? '[len='+u.value.length+']' : '', clave: p.value ? '[len='+p.value.length+']' : '', estacion: e.value ? '[len='+e.value.length+']' : '' };
})()`, returnByValue: true });
console.log('TRAS FOCUS:', JSON.stringify(ev.result?.result?.value ?? ev));
cdp.close();
