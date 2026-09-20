import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const run = async (e) => { const rr = await c.send('Runtime.evaluate', { expression: e, returnByValue: true }); return rr.result?.result?.value; };

const chk = await run(`(() => {
  const ins = [...document.querySelectorAll('input')].map(i => ({id:i.id, type:i.type, val:(i.value||'').slice(0,15), x:Math.round(i.getBoundingClientRect().x), y:Math.round(i.getBoundingClientRect().y)}));
  const body = (document.body.innerText||'').slice(0,80);
  return JSON.stringify({ins, body});
})()`);
console.log(chk);
c.close();
