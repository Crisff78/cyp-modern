import { findOrCreateTab, connect } from './cdp.mjs';
import fs from 'fs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
await c.send('Network.enable');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = async (e) => { const rr = await c.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return rr.result?.result?.value; };

await run(`(() => { try { Ext.MessageBox.hide(); } catch(e){} return 1; })()`);
await sleep(300);
await run(`(() => { for (const m of [...document.querySelectorAll('.ext-el-mask')]) m.remove(); const b=document.querySelector('body.x-body-masked'); if(b) b.classList.remove('x-body-masked'); return 1; })()`);

const wins = [
  { id:'O2CD_id', nombre:'Panel de Control (Admin.)' },
  { id:'O365_id', nombre:'Listado de Clientes' },
  { id:'O48C_id', nombre:'Listado de Descargos' },
  { id:'O5C5_id', nombre:'Pagos' },
  { id:'O70C_id', nombre:'Entregas de Dinero' },
];

const aislar = async (keep) => run(`(() => {
  for (const x of [...document.querySelectorAll('.x-window')]) {
    if (x.id === ${JSON.stringify(keep)}) { x.style.display=''; continue; }
    const t = (x.querySelector('.x-window-header-text')?.innerText||'').trim();
    if (t && t !== 'Opciones') x.style.display='none';
  }
  for (const m of [...document.querySelectorAll('.ext-el-mask')]) m.remove();
  const b=document.querySelector('body.x-body-masked'); if(b) b.classList.remove('x-body-masked');
  return 1;
})()`);

const restaurar = async () => run(`(() => { for (const x of [...document.querySelectorAll('.x-window')]) x.style.display=''; return 1; })()`);

const capturaUna = async (id) => run(`(() => {
  const w = document.getElementById(${JSON.stringify(id)});
  if (!w) return null;
  const out = { title: (w.querySelector('.x-window-header-text')?.innerText||'').trim() };
  out.texto = (w.innerText||'').replace(/\\n\\s*\\n/g,'\\n').slice(0,4500);
  out.grids = [...w.querySelectorAll('.x-grid3')].map(g=>({cols:[...g.querySelectorAll('.x-grid3-hd-inner')].map(h=>h.innerText.trim()).filter(Boolean), rows:g.querySelectorAll('.x-grid3-row').length, rowsTxt:[...g.querySelectorAll('.x-grid3-row')].slice(0,12).map(r=>[...r.querySelectorAll('.x-grid3-cell')].map(c2=>c2.innerText.trim()))}));
  out.forms = [...w.querySelectorAll('.x-form-field')].filter(f=>f.type!=='hidden').map(f=>({id:f.id, tipo:f.type||f.tagName, val:(f.value||'').slice(0,25)}));
  out.labels = [...w.querySelectorAll('label')].map(l=>(l.innerText||'').trim().slice(0,40)).filter(Boolean);
  out.btns = [...w.querySelectorAll('table.x-btn, .x-btn-text, button')].map(b=>(b.innerText||b.value||'').trim().slice(0,30)).filter(Boolean);
  out.tabs = [...w.querySelectorAll('.x-tab-strip-text, .x-tab-inner')].map(e=>e.innerText.trim()).filter(Boolean);
  out.toolbars = [...w.querySelectorAll('.x-toolbar, .x-statusbar')].map(t=>(t.innerText||'').replace(/\\n\\s*\\n/g,'\\n').trim().slice(0,220));
  out.combos = [...w.querySelectorAll('select')].map(s=>({sel:s.options[s.selectedIndex]?.text||'', opts:[...s.options].map(o=>o.text).slice(0,15)}));
  return out;
})()`);

const result = { capturado: {}, errores: [] };
for (const w of wins) {
  await aislar(w.id);
  await sleep(700);
  // forzar recarga de stores de grids
  await run(`(() => {
    const win = document.getElementById(${JSON.stringify(w.id)});
    if (!win) return;
    for (const g of [...win.querySelectorAll('.x-grid3')]) {
      try { const cmp = Ext.getCmp(g.id); if (cmp && cmp.getStore) { const st = cmp.getStore(); if (st && st.reload) st.reload(); } }
      catch(e){}
    }
    return 1;
  })()`);
  await sleep(4500);
  c.drain();
  const cap = await capturaUna(w.id);
  if (!cap) { result.errores.push(`${w.nombre}: no capturable`); continue; }
  cap.winId = w.id;
  const evs = c.drain();
  const reqs = []; const fin = new Set(); const resp = {};
  for (const ev of evs) {
    const p = ev.params;
    if (ev.method === 'Network.requestWillBeSent' && p.request && p.request.url.includes('cyp10_front'))
      reqs.push({ id: p.requestId, postData: p.request.postData ? decodeURIComponent(p.request.postData).slice(0,400) : null });
    if (ev.method === 'Network.responseReceived' && p.response && p.response.url.includes('cyp10_front'))
      resp[p.requestId] = { status: p.response.status };
    if (ev.method === 'Network.loadingFinished') fin.add(p.requestId);
  }
  for (const r of reqs) if (fin.has(r.id)) { r.respStatus = resp[r.id]?resp[r.id].status:null; try { const rb = await c.send('Network.getResponseBody', { requestId: r.id }); if (rb && rb.body) r.respBody = rb.body.replace(/\s+/g,' ').slice(0,700); } catch(e){} }
  cap.red = reqs.slice(0, 25);
  result.capturado[w.nombre] = cap;
  console.log('OK', w.nombre, '| grids:', cap.grids.length, '| cols:', cap.grids.map(g=>g.cols.length).join(','), '| filas:', cap.grids.map(g=>g.rows).join(','));
}
await restaurar();

// grupo Cerrar: inspeccionar componentes Ext de los 4 iconos
const cerrar = await run(`(() => {
  const ids = ['O150_id','O154_id','O158_id','O15C_id'];
  return ids.map(id => {
    let info = { id };
    try {
      const cmp = Ext.getCmp(id);
      if (cmp) {
        info.text = cmp.text || cmp.title || null;
        info.tooltip = cmp.tooltip || (cmp.initialConfig ? cmp.initialConfig.tooltip : null);
        info.qtip = cmp.getTipEl ? null : null;
        info.cls = cmp.iconCls || cmp.cls || null;
        info.handler = cmp.initialConfig && cmp.initialConfig.handler ? String(cmp.initialConfig.handler).slice(0,200) : null;
        info.listeners = cmp.events ? Object.keys(cmp.events).join(',') : null;
        const img = document.getElementById(id).querySelector('img');
        if (img) info.img = img.getAttribute('src').split('/').pop();
      }
    } catch (e) { info.err = String(e).slice(0,80); }
    return info;
  });
})()`);
result.grupoCerrarComponentes = cerrar;
console.log('Cerrar:', JSON.stringify(cerrar, null, 1));

fs.writeFileSync('.cdp/cap7.json', JSON.stringify(result, null, 1));
console.log('FIN cap7. capturados:', Object.keys(result.capturado).length, 'errores:', JSON.stringify(result.errores));
c.close();
