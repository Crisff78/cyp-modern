import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const cdp = await connect(tab.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
// verificar que la pestana sigue en login y traer la ventana al frente
const ev = await cdp.send('Runtime.evaluate', { expression: `(() => ({
  url: location.href,
  tieneLogin: !!document.getElementById('O93_id'),
  texto: document.body.innerText.slice(0,120)
}))()`, returnByValue: true });
console.log('ESTADO:', JSON.stringify(ev.result?.result?.value ?? ev));
await cdp.send('Page.bringToFront');
cdp.close();
