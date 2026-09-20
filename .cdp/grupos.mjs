import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const run = async (e) => (await c.send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

const est = await run(`(() => {
  const out = {};
  for (const id of ['OEE_id','O11B_id','O10C_id','O139_id','O19F_id','O1EC_id']) {
    const w = document.getElementById(id);
    if (!w) { out[id]='gone'; continue; }
    const r = w.getBoundingClientRect();
    out[id] = { h: Math.round(r.height), txt: (w.innerText||'').replace(/\\n/g,' | ').slice(0,120) };
  }
  return JSON.stringify(out);
})()`);
console.log('ESTADO GRUPOS:', est);
c.close();
