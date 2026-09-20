import { findOrCreateTab, connect } from './cdp.mjs';
import fs from 'fs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
await c.send('Network.enable', {}, 30000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = async (e) => { const rr = await c.send('Runtime.evaluate', { expression: e, returnByValue: true }); return rr.result?.result?.value; };

// cerrar el Confirm colgante de forma segura
await run(`(() => { try { if (Ext.MessageBox) Ext.MessageBox.hide(); } catch(e){} return 1; })()`);
await sleep(400);
await run(`(() => { for (const m of [...document.querySelectorAll('.ext-el-mask')]) m.remove(); const b=document.querySelector('body.x-body-masked'); if(b) b.classList.remove('x-body-masked'); return 1; })()`);

const lista = await run(`(() => {
  return [...document.querySelectorAll('.x-window')].filter(w => getComputedStyle(w).display !== 'none')
    .map(w => ({ id: w.id, t: (w.querySelector('.x-window-header-text')?.innerText||'').trim() }))
    .filter(o => o.t && o.t !== 'Opciones' && o.t !== 'Monitor de Cobradores' && o.t !== 'Confirm');
})()`);
console.log("ventanas abiertas:", JSON.stringify(lista));

const capturaUna = async (id) => run(`(() => {
  const w = document.getElementById(${JSON.stringify(id)});
  if (!w) return null;
  const out = { title: (w.querySelector('.x-window-header-text')?.innerText||'').trim() };
  out.texto = (w.innerText||'').replace(/\\n\\s*\\n/g,'\\n').slice(0,3500);
  out.grids = [...w.querySelectorAll('.x-grid3')].map(g=>({cols:[...g.querySelectorAll('.x-grid3-hd-inner')].map(h=>h.innerText.trim()).filter(Boolean), rows:g.querySelectorAll('.x-grid3-row').length, rowsTxt:[...g.querySelectorAll('.x-grid3-row')].slice(0,10).map(r=>[...r.querySelectorAll('.x-grid3-cell')].map(c2=>c2.innerText.trim()))}));
  out.forms = [...w.querySelectorAll('.x-form-field')].filter(f=>f.type!=='hidden').map(f=>({id:f.id, tipo:f.type||f.tagName, val:(f.value||'').slice(0,25)}));
  out.labels = [...w.querySelectorAll('label')].map(l=>(l.innerText||'').trim().slice(0,40)).filter(Boolean);
  out.btns = [...w.querySelectorAll('table.x-btn, .x-btn-text, button')].map(b=>(b.innerText||b.value||'').trim().slice(0,30)).filter(Boolean);
  out.tabs = [...w.querySelectorAll('.x-tab-strip-text, .x-tab-inner')].map(e=>e.innerText.trim()).filter(Boolean);
  out.toolbars = [...w.querySelectorAll('.x-toolbar, .x-statusbar')].map(t=>(t.innerText||'').replace(/\\n\\s*\\n/g,'\\n').trim().slice(0,200));
  out.combos = [...w.querySelectorAll('select')].map(s=>({sel:s.options[s.selectedIndex]?.text||'', opts:[...s.options].map(o=>o.text).slice(0,15)}));
  return out;
})()`);

const result = {};
for (const w of lista) {
  // aislar: ocultar las demas, mostrar esta
  await run(`(() => { for (const x of [...document.querySelectorAll('.x-window')]) { const t=(x.querySelector('.x-window-header-text')?.innerText||'').trim(); if (t && t!=='Opciones' && t!=='Monitor de Cobradores' && x.id !== ${JSON.stringify(w.id)}) x.style.display='none'; } const el=document.getElementById(${JSON.stringify(w.id)}); if(el) el.style.display=''; return 1; })()`);
  await sleep(700);
  // forzar recarga de datos de la grid de esta ventana (viewrefresh)
  c.drain();
  const cap = await capturaUna(w.id);
  if (cap) {
    const evs = c.drain();
    const reqs = []; const fin = new Set(); const resp = {};
    for (const ev of evs) {
      const p = ev.params;
      if (ev.method === 'Network.requestWillBeSent' && p.request && p.request.url.includes('cyp10_front'))
        reqs.push({ id: p.requestId, postData: p.request.postData ? decodeURIComponent(p.request.postData).slice(0,300) : null });
      if (ev.method === 'Network.responseReceived' && p.response && p.response.url.includes('cyp10_front'))
        resp[p.requestId] = { status: p.response.status, mime: p.response.mimeType };
      if (ev.method === 'Network.loadingFinished') fin.add(p.requestId);
    }
    for (const r of reqs) if (fin.has(r.id)) { r.respStatus = resp[r.id]?resp[r.id].status:null; try { const rb = await c.send('Network.getResponseBody', { requestId: r.id }); if (rb && rb.body) r.respBody = rb.body.slice(0,600); } catch(e){} }
    cap.red = reqs.slice(0, 20);
  }
  result[w.t] = cap;
}
fs.writeFileSync('.cdp/openwins.json', JSON.stringify(result, null, 1));
console.log('capturadas', Object.keys(result).length, 'ventanas');
c.close();
