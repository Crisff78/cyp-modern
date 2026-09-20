import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
console.log('TAB:', tab.url);
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const run = async (e) => { const rr = await c.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return rr.result?.result?.value; };

const st = await run(`(() => {
  const out = { title: document.title, url: location.href };
  out.bodyHead = (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 400);
  const loginU = document.getElementById('O93_id');
  const loginP = document.getElementById('O9B_id');
  out.loginUserField = !!loginU;
  out.loginPassField = !!loginP;
  if (loginU) out.userFilled = loginU.value.length > 0;
  if (loginP) out.passFilled = loginP.value.length > 0;
  const wins = [];
  if (window.Ext && Ext.ComponentMgr) {
    const all = Ext.ComponentMgr.all.items || [];
    for (const w of all) {
      if (w && w.isWindow && w.rendered) {
        wins.push({ id: w.id, t: (w.title || w.headerText || '').slice(0, 40), z: w.getEl ? (w.getEl().getZIndex ? w.getEl().getZIndex() : null) : null, vis: w.hidden === false, x: w.x, y: w.y, w: w.width, h: w.height });
      }
    }
  }
  out.winCount = wins.length;
  out.wins = wins.slice(0, 60);
  out.maskCount = document.querySelectorAll('.ext-el-mask').length;
  out.bodyMasked = document.body.classList.contains('x-body-masked');
  return out;
})()`);
console.log(JSON.stringify(st, null, 1));
c.close();
