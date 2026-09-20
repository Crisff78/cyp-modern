import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
console.log('TAB:', tab.id, tab.url);
const cdp = await connect(tab.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp.send('Page.navigate', { url: 'http://gdemos.ddns.net/cypdemo/' });
await new Promise(r => setTimeout(r, 7000));
const ev = await cdp.send('Runtime.evaluate', { expression: `(() => {
  return {
    url: location.href,
    title: document.title,
    bodyTextLen: document.body ? document.body.innerText.length : 0,
    forms: [...document.querySelectorAll('form')].map(f => ({action: f.action, method: f.method,
      fields: [...f.querySelectorAll('input,select,button')].map(i => ({name: i.name, id: i.id, type: i.type, placeholder: i.placeholder, value: i.type==='button'||i.type==='submit' ? i.value : (i.value? '[SET]':'')}))})),
    iframes: [...document.querySelectorAll('iframe')].map(i => i.src),
    metaRefresh: [...document.querySelectorAll('meta[http-equiv="refresh"]')].map(m => m.content),
    scripts: [...document.querySelectorAll('script[src]')].map(s => s.src).slice(0,20)
  };
})()`, returnByValue: true });
console.log('EVAL RESULT:', JSON.stringify(ev.result?.result?.value ?? ev, null, 1));
cdp.close();
