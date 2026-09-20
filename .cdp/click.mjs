import { findOrCreateTab, connect } from './cdp.mjs';
const target = process.argv[2];
const wait = parseInt(process.argv[3] || '3000', 10);
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const cdp = await connect(tab.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
// localizar elemento y obtener coordenadas
const loc = await cdp.send('Runtime.evaluate', { expression: `(() => {
  let el = document.getElementById(${JSON.stringify(target)});
  if (!el) {
    const all = [...document.querySelectorAll('label,td,span,table.x-btn,.x-btn-text')];
    el = all.find(e => (e.innerText||'').trim() === ${JSON.stringify(target)});
  }
  if (!el) return { ok:false };
  const r = el.getBoundingClientRect();
  return { ok:true, id: el.id, txt:(el.innerText||'').trim(), x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height, vis: getComputedStyle(el).display };
})()`, returnByValue: true });
const L = loc.result?.result?.value;
console.log('LOC:', JSON.stringify(L));
if (!L?.ok) { cdp.close(); process.exit(1); }
// mover mouse y clic real
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: L.x, y: L.y });
await new Promise(r => setTimeout(r, 300));
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: L.x, y: L.y, button: 'left', clickCount: 1 });
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: L.x, y: L.y, button: 'left', clickCount: 1 });
await new Promise(r => setTimeout(r, wait));
const ev = await cdp.send('Runtime.evaluate', { expression: `(() => {
  const out = {};
  out.texto = (document.body.innerText||'').slice(0,2200);
  out.windows = [...document.querySelectorAll('.x-window')].filter(w=>getComputedStyle(w).display!=='none' && w.offsetParent!==null).map(w=>({title:(w.querySelector('.x-window-header-text')?.innerText||'').trim(), z:w.style.zIndex}));
  out.tabs = [...document.querySelectorAll('.x-tab-strip-text, .x-tab-inner')].map(e=>e.innerText.trim()).filter(Boolean);
  out.grids = [...document.querySelectorAll('.x-grid3')].map(g=>({cols:[...g.querySelectorAll('.x-grid3-hd-inner')].map(h=>h.innerText.trim()).filter(Boolean), rows:g.querySelectorAll('.x-grid3-row').length, firstRow:[...g.querySelectorAll('.x-grid3-row')].slice(0,2).map(r=>[...r.querySelectorAll('.x-grid3-cell')].map(c=>c.innerText.trim()))}));
  out.forms = [...document.querySelectorAll('.x-form-field')].filter(f=>f.type!=='hidden').map(f=>({id:f.id, name:f.name||'', tipo:f.type||f.tagName, lbl:(f.closest('.x-form-item')?.querySelector('label')?.innerText||'').trim()}));
  out.btns = [...document.querySelectorAll('table.x-btn, .x-menu-item-text, .x-btn-text')].map(b=>({txt:(b.innerText||'').trim(), id:b.id})).filter(x=>x.txt);
  return out;
})()`, returnByValue: true });
const v = ev.result?.result?.value;
console.log('=== WINDOWS ==='); console.log(JSON.stringify(v.windows));
console.log('=== TABS ==='); console.log(JSON.stringify(v.tabs));
console.log('=== GRIDS ==='); console.log(JSON.stringify(v.grids).slice(0,2500));
console.log('=== FORMS ==='); console.log(JSON.stringify(v.forms).slice(0,2000));
console.log('=== BTNS ==='); console.log(JSON.stringify(v.btns));
console.log('=== TEXTO ==='); console.log(v.texto.slice(0,1200));
cdp.close();