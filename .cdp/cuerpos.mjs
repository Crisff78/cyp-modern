import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const run = async (e) => (await c.send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

const est = await run(`(() => {
  const out = {};
  // cuerpo de cada grupo: O11B (Archivos->expandido), O12A (Cobros), ? (Pagos), O1FB (Reportes)
  for (const id of ['O11B_id','O12A_id','O1FB_id']) {
    const w = document.getElementById(id);
    if (!w) { out[id]='gone'; continue; }
    out[id] = { h: w.style.height, txt: (w.innerText||'').replace(/\\n/g,' | ').slice(0,150) };
  }
  return JSON.stringify(out);
})()`);
console.log('CUERPOS:', est);
c.close();
