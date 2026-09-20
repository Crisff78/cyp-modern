import { findOrCreateTab, connect } from './cdp.mjs';
const want = process.argv[2];
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const cdp = await connect(tab.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
const ev = await cdp.send('Runtime.evaluate', { expression: `(() => {
  const want = ${JSON.stringify(want||'')};
  const wins = [...document.querySelectorAll('.x-window')].filter(w => getComputedStyle(w).display !== 'none');
  if (!want) {
    return { list: wins.map(w => ({ title:(w.querySelector('.x-window-header-text')?.innerText||'').trim(), z: parseInt(w.style.zIndex||'0',10), items: w.querySelectorAll('label,table.x-btn,.x-grid3').length, txt:(w.innerText||'').trim().slice(0,60) })) };
  }
  let w = wins.find(w => (w.querySelector('.x-window-header-text')?.innerText||'').trim() === want);
  if (!w) w = wins.find(w => (w.innerText||'').includes(want));
  if (!w) return { err: 'not-found', want };
  const out = {};
  out.title = (w.querySelector('.x-window-header-text')?.innerText||'').trim();
  out.z = parseInt(w.style.zIndex||'0',10);
  out.texto = (w.innerText||'').slice(0,3500);
  out.grids = [...w.querySelectorAll('.x-grid3')].map(g=>({cols:[...g.querySelectorAll('.x-grid3-hd-inner')].map(h=>h.innerText.trim()).filter(Boolean), rows:g.querySelectorAll('.x-grid3-row').length, rowsTxt:[...g.querySelectorAll('.x-grid3-row')].slice(0,10).map(r=>[...r.querySelectorAll('.x-grid3-cell')].map(c=>c.innerText.trim()))}));
  out.forms = [...w.querySelectorAll('.x-form-field')].filter(f=>f.type!=='hidden').map(f=>({id:f.id, name:f.name||'', tipo:f.type||f.tagName, lbl:(f.closest('.x-form-item')?.querySelector('label')?.innerText||'').trim(), val:(f.value||'').slice(0,20)}));
  out.labels = [...w.querySelectorAll('label')].map(l=>({id:l.id, txt:(l.innerText||'').trim().slice(0,60)})).filter(x=>x.txt);
  out.btns = [...w.querySelectorAll('table.x-btn, .x-btn-text, .x-menu-item-text, button')].map(b=>({txt:(b.innerText||'').trim(), id:b.id})).filter(x=>x.txt);
  out.tabs = [...w.querySelectorAll('.x-tab-strip-text, .x-tab-inner')].map(e=>e.innerText.trim()).filter(Boolean);
  return out;
})()`, returnByValue: true });
console.log(JSON.stringify(ev.result?.result?.value, null, 1));
cdp.close();