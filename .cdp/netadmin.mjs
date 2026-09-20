import { findOrCreateTab, connect } from './cdp.mjs';
import fs from 'fs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
await c.send('Network.enable', {}, 30000);
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const run = async (e) => { const rr = await c.send('Runtime.evaluate', { expression: e, returnByValue: true }); return rr.result?.result?.value; };

c.drain();
const dbg = await run(`(() => {
  const el = document.getElementById('O164_id');
  if (!el) return 'NO-EL';
  const r = el.getBoundingClientRect();
  return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height, txt: el.innerText});
})()`);
console.log('dbg:', dbg);
if (!dbg || dbg === 'NO-EL') { console.log('no se pudo localizar Admin.'); c.close(); process.exit(1); }
const L = JSON.parse(dbg);

await c.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:L.x, y:L.y });
await sleep(250);
await c.send('Input.dispatchMouseEvent', { type:'mousePressed', x:L.x, y:L.y, button:'left', clickCount:1 });
await c.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:L.x, y:L.y, button:'left', clickCount:1 });
await sleep(6000);

const evs = c.drain();
const reqs = new Map();
for (const ev of evs) {
  if (ev.method === 'Network.requestWillBeSent') {
    reqs.set(ev.params.requestId, { url: ev.params.request.url, m: ev.params.request.method,
      post: ev.params.request.postData || null });
  }
}
console.log('total peticiones:', reqs.size);
const out = [];
for (const [id, r] of reqs) {
  if (!r.url.includes('HandleEvent') && !r.url.includes('cyp10_front')) continue;
  const entry = { url: r.url, m: r.m, post: r.post ? decodeURIComponent(r.post).slice(0,700) : null };
  try {
    const rb = await c.send('Network.getResponseBody', { requestId: id });
    entry.resp = rb.body ? rb.body.slice(0,900) : null;
  } catch(e) { entry.resp = null; }
  out.push(entry);
}
fs.writeFileSync('.cdp/admin_net.json', JSON.stringify(out, null, 1));
console.log('peticiones cyp:', out.length);
for (const o of out) {
  console.log('---', o.m, o.url.slice(0,80));
  if (o.post) console.log('   POST:', o.post.slice(0,400));
  if (o.resp) console.log('   RESP:', o.resp.slice(0,400));
}
c.close();
