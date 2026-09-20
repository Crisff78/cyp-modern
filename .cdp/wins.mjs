import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const cdp = await connect(tab.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
const ev = await cdp.send('Runtime.evaluate', { expression: `(() => {
  const wins = [...document.querySelectorAll('.x-window')];
  const out = wins.map(w => {
    const title = (w.querySelector('.x-window-header-text')?.innerText||'').trim();
    const kids = [...w.querySelectorAll('.x-window-body > *')].map(k => ({
      tag: k.tagName, id: k.id, cls: (k.className||'').trim().slice(0,60),
      txt: (k.innerText||'').trim().slice(0,60),
      kids: [...k.querySelectorAll('label,td.x-btn-mc,.x-btn-text')].map(x=>({id:x.id,txt:(x.innerText||'').trim().slice(0,40)}))
    }));
    return { title, vis: getComputedStyle(w).display, kids };
  });
  return out;
})()`, returnByValue: true });
console.log(JSON.stringify(ev.result?.result?.value, null, 1));
cdp.close();