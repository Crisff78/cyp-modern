import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const run = async (e) => { const rr = await c.send('Runtime.evaluate', { expression: e, returnByValue: true }); return rr.result?.result?.value; };

const r = await run(`(() => {
  const wins = [...document.querySelectorAll('.x-window')].filter(w=>getComputedStyle(w).display!=='none').map(w=>({t:(w.querySelector('.x-window-header-text')?.innerText||'').trim(), z:w.style.zIndex, id:w.id})).filter(x=>x.t||x.id);
  const root = document.getElementById('OBF_id');
  const items = [];
  if (root) {
    for (const el of root.querySelectorAll('label[id], td[id], div[id]')) {
      const txt = (el.innerText||'').trim();
      if (!txt || txt.length > 25) continue;
      const rc = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      items.push({ id: el.id, txt, tag: el.tagName, x:Math.round(rc.x), y:Math.round(rc.y), w:Math.round(rc.width), h:Math.round(rc.height), cur: st.cursor, title: el.title||el.getAttribute('title')||'' });
    }
  }
  return JSON.stringify({wins, items});
})()`);
console.log(r);
c.close();
