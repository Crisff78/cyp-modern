import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
await c.send('Network.enable', {}, 30000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = async (e) => { const rr = await c.send('Runtime.evaluate', { expression: e, returnByValue: true }); return rr.result?.result?.value; };

const vis = await run(`(() => [...document.querySelectorAll('.x-window')].filter(w=>getComputedStyle(w).display!=='none').map(w=>w.id))()`);
console.log("visibles antes:", JSON.stringify(vis));
c.drain();
// intentar fireEvent click sobre el item de menu Clientes O16C_id
const r1 = await run(`(() => { try { const cmp = Ext.getCmp('O16C_id'); if (!cmp) return 'NO_CMP'; cmp.fireEvent('click', cmp); return 'fired'; } catch(e) { return 'ERR:'+e.message; } })()`);
console.log("fireEvent:", r1);
await sleep(5500);
const vis2 = await run(`(() => [...document.querySelectorAll('.x-window')].filter(w=>getComputedStyle(w).display!=='none').map(w=>({id:w.id, t:(w.querySelector('.x-window-header-text')?.innerText||'').trim()})))()`);
console.log("visibles despues:", JSON.stringify(vis2));
const evs = c.drain();
for (const ev of evs) {
  if (ev.method === 'Network.requestWillBeSent' && ev.params.request && ev.params.request.url.includes('cyp10_front')) {
    console.log("REQ:", decodeURIComponent(ev.params.request.postData || '').slice(0,200));
  }
}
c.close();
