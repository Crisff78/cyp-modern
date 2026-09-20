import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
console.log('URL:', tab.url);
const cdp = await connect(tab.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
const ev = await cdp.send('Runtime.evaluate', { expression: `(() => ({ txt:(document.body.innerText||'').slice(0,300) }))()`, returnByValue: true });
console.log(JSON.stringify(ev.result?.result?.value));
cdp.close();