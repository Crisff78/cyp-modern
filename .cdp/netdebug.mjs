import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
console.log('TAB:', tab.url);
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
await c.send('Page.enable');
await c.send('Network.enable', {}, 30000);
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const run = async (e) => (await c.send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

const ifr = await run(`(() => JSON.stringify([...document.querySelectorAll('iframe')].map(f=>({src:f.src, id:f.id, name:f.name}))) )()`);
console.log('IFRAMES:', ifr);

// fetch de prueba para ver si Network captura
c.drain();
await run(`(() => { fetch('http://gdemos.ddns.net/cypdemo/testping').catch(()=>{}); return 1; })()`);
await sleep(2000);
const evs = c.drain();
const nets = evs.filter(e=>e.method.startsWith('Network.')).map(e=>e.method + ' ' + (e.params.requestId||'') + ' ' + (e.params.request?.url||e.params.response?.url||'').slice(0,90));
console.log('EVENTOS RED (' + nets.length + '):'); nets.slice(0,15).forEach(n=>console.log('  ', n));
c.close();
