import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const cdp = await connect(tab.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
console.log('MONITOR ACTIVO - esperando login...');
let logged = false;
for (let i = 0; i < 90; i++) {  // hasta 90s
  await new Promise(r => setTimeout(r, 1000));
  try {
    const ev = await cdp.send('Runtime.evaluate', { expression: `(() => ({
      url: location.href,
      loginVisible: !!document.getElementById('O93_id'),
      texto: document.body.innerText.slice(0,150)
    }))()`, returnByValue: true });
    const v = ev.result?.result?.value;
    if (v && !v.loginVisible) {
      console.log('>>> LOGIN SUPERADO en t=' + i + 's');
      console.log('URL:', v.url);
      console.log('TEXTO:', JSON.stringify(v.texto));
      logged = true;
      break;
    }
  } catch (e) { /* pestana reiniciando, seguir */ }
}
if (!logged) console.log('TIMEOUT: el login sigue visible tras 90s');
cdp.close();
