import { findOrCreateTab, connect } from './cdp.mjs';
import fs from 'fs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
await c.send('Page.enable');
await c.send('Network.enable', {}, 30000);
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const run = async (e) => (await c.send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

const L = await run(`(() => { const el=document.getElementById('O16C_id'); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`);
console.log('coord Clientes:', JSON.stringify(L));
await c.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:L.x, y:L.y });
await sleep(250);
await c.send('Input.dispatchMouseEvent', { type:'mousePressed', x:L.x, y:L.y, button:'left', clickCount:1 });
await c.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:L.x, y:L.y, button:'left', clickCount:1 });
await sleep(4500);

const evs = c.drain();
const reqs = [];
for (const ev of evs) {
  if (ev.method === 'Network.requestWillBeSent') {
    reqs.push({ id: ev.params.requestId, url: ev.params.request.url, m: ev.params.request.method,
      post: ev.params.request.postData ? ev.params.request.postData.slice(0,300) : null });
  }
}
console.log('PETICIONES (' + reqs.length + '):');
for (const r of reqs) console.log(' ', r.m, r.url.slice(0,120), r.post?('POST='+r.post.slice(0,150)):'');
fs.writeFileSync('.cdp/net1.json', JSON.stringify(reqs, null, 1));
c.close();
