import { findOrCreateTab, connect } from './cdp.mjs';
import fs from 'fs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
await c.send('Network.enable');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = async (e) => { const rr = await c.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return rr.result?.result?.value; };
const clickReal = async (x, y) => {
  await c.send('Input.dispatchMouseEvent', { type:'mouseMoved', x, y });
  await sleep(180);
  await c.send('Input.dispatchMouseEvent', { type:'mousePressed', x, y, button:'left', clickCount:1 });
  await c.send('Input.dispatchMouseEvent', { type:'mouseReleased', x, y, button:'left', clickCount:1 });
};
const rectOf = async (id) => run(`(() => { const el=document.getElementById('${id}'); if(!el) return null; const r=el.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2), w:r.width, h:r.height, disp:getComputedStyle(el).display}; })()`);

// ---- PASO A: recargar stores de las 5 ventanas abiertas y re-capturar grids ----
const wins = {
  'Admin.': 'O2DD_id',
  'Clientes': 'O3C7_id',
  'Descargos': 'O4EE_id',
  'Pagos': 'O627_id',
  'Entregas': 'O76E_id',
};

const recargaGrids = async (winId) => run(`(() => {
  const w = document.getElementById('${winId}');
  if (!w) return { error: 'win no existe' };
  const gridIds = [...w.querySelectorAll('.x-grid3')].map(g => g.id).filter(Boolean);
  const recargados = [];
  for (const gid of gridIds) {
    try {
      const cmp = Ext.getCmp(gid);
      if (cmp && cmp.getStore) { const st = cmp.getStore(); if (st && st.reload) { st.reload(); recargados.push({ gid, ok: true }); continue; } }
      if (cmp && cmp.getView && cmp.getView().refresh) { cmp.getView().refresh(); recargados.push({ gid, ok: 'viewrefresh' }); continue; }
      recargados.push({ gid, ok: false });
    } catch (e) { recargados.push({ gid, err: String(e).slice(0,80) }); }
  }
  return { gridIds, recargados };
})()`);

const capturaGrids = async (winId) => run(`(() => {
  const w = document.getElementById('${winId}');
  if (!w) return null;
  const out = [];
  for (const g of [...w.querySelectorAll('.x-grid3')]) {
    const cmp = Ext.getCmp(g.id);
    const cols = [...g.querySelectorAll('.x-grid3-hd-inner')].map(h=>h.innerText.trim()).filter(Boolean);
    const rows = [...g.querySelectorAll('.x-grid3-row')].slice(0,12).map(r=>[...r.querySelectorAll('.x-grid3-cell')].map(c2=>c2.innerText.trim()));
    out.push({ gid: g.id, cols, rowCount: g.querySelectorAll('.x-grid3-row').length, rowsTxt: rows, store: cmp && cmp.getStore ? (cmp.getStore().getTotalCount ? cmp.getStore().getTotalCount() : null) : null });
  }
  return out;
})()`);

const capAnterior = JSON.parse(fs.readFileSync('.cdp/cap5.json','utf8'));
for (const [nombre, winId] of Object.entries(wins)) {
  const r = await recargaGrids(winId);
  await sleep(4200);
  const grids = await capturaGrids(winId);
  if (capAnterior.capturado[nombre]) {
    capAnterior.capturado[nombre].gridsData = grids;
    capAnterior.capturado[nombre].recarga = r;
  }
  console.log(nombre, '| grids:', r.gridIds ? r.gridIds.length : 0, '| recargados:', JSON.stringify(r.recargados ? r.recargados.map(x=>x.gid+':'+x.ok) : []), '| datos:', grids ? grids.map(g=>g.cols.length+'cols/'+g.rowCount+'filas') : 'null');
}

// ---- PASO C: reintento Monitor C ----
await run(`(() => { try { Ext.getCmp('OBF_id').toFront(); } catch(e){} return 1; })()`);
await sleep(400);
const antesMC = await run(`(() => [...document.querySelectorAll('.x-window')].filter(w=>getComputedStyle(w).display!=='none').map(w=>w.id))()`);
const cuerpoRep = await run(`(() => { const el=document.getElementById('O1FB_id'); return el ? Math.round(el.getBoundingClientRect().height) : -1; })()`);
console.log('altura cuerpo Reportes:', cuerpoRep);
if (cuerpoRep <= 2) {
  const cab = await rectOf('O1EC_id');
  if (cab) { await clickReal(cab.x, cab.y); await sleep(3000); }
}
await run(`(() => { try { Ext.getCmp('OBF_id').toFront(); } catch(e){} return 1; })()`);
await sleep(400);
const itemMC = await rectOf('O20E_id');
console.log('Monitor C item:', JSON.stringify(itemMC));
if (itemMC && itemMC.disp !== 'none') {
  await clickReal(itemMC.x, itemMC.y);
  await sleep(6500);
  const despuesMC = await run(`(() => [...document.querySelectorAll('.x-window')].filter(w=>getComputedStyle(w).display!=='none').map(w=>w.id))()`);
  const nuevasMC = despuesMC.filter(x => !antesMC.includes(x));
  console.log('Monitor C ventanas nuevas:', JSON.stringify(nuevasMC));
  if (nuevasMC.length) {
    const cap = await run(`(() => {
      const w = document.getElementById('${nuevasMC[nuevasMC.length-1]}');
      if (!w) return null;
      return { title: (w.querySelector('.x-window-header-text')?.innerText||'').trim(),
        texto: (w.innerText||'').replace(/\\n\\s*\\n/g,'\\n').slice(0,3000),
        labels: [...w.querySelectorAll('label')].map(l=>(l.innerText||'').trim().slice(0,40)).filter(Boolean),
        btns: [...w.querySelectorAll('table.x-btn, .x-btn-text, button')].map(b=>(b.innerText||b.value||'').trim().slice(0,30)).filter(Boolean),
        forms: [...w.querySelectorAll('.x-form-field')].filter(f=>f.type!=='hidden').map(f=>({id:f.id, tipo:f.type||f.tagName, val:(f.value||'').slice(0,25)})),
        toolbars: [...w.querySelectorAll('.x-toolbar, .x-statusbar')].map(t=>(t.innerText||'').replace(/\\n\\s*\\n/g,'\\n').trim().slice(0,220)) };
    })()`);
    if (cap) { cap.winId = nuevasMC[nuevasMC.length-1]; capAnterior.capturado['Monitor C'] = cap; console.log('Monitor C capturado:', cap.title, '| labels:', cap.labels.length); }
  }
}

// ---- PASO D: grupo Cerrar expandido, solo lectura ----
await run(`(() => { try { Ext.getCmp('OBF_id').toFront(); } catch(e){} return 1; })()`);
await sleep(400);
const hCerrar = await run(`(() => { const el=document.getElementById('O139_id'); return el ? Math.round(el.getBoundingClientRect().height) : -1; })()`);
console.log('altura Cerrar (colapsado=151):', hCerrar);
if (hCerrar <= 152) {
  const cab = await rectOf('O139_id');
  if (cab) { await clickReal(cab.x, cab.y); await sleep(2200); }
}
const itemsCerrar = await run(`(() => {
  const ids = ['O150_id','O154_id','O158_id','O15C_id'];
  return ids.map(id => {
    const el = document.getElementById(id);
    if (!el) return { id, txt: null };
    const lab = el.querySelector('label, .x-menu-item-text, span') || el;
    const onclick = el.getAttribute('onclick') || (el.querySelector('a') ? el.querySelector('a').getAttribute('onclick') : null);
    return { id, txt: (el.innerText||'').trim().slice(0,40), lab: lab ? lab.innerText.trim().slice(0,40) : null, onclick: onclick ? onclick.slice(0,120) : null, vis: getComputedStyle(el).display };
  });
})()`);
capAnterior.grupoCerrarExpandido = itemsCerrar;
console.log('items Cerrar:', JSON.stringify(itemsCerrar, null, 1));

fs.writeFileSync('.cdp/cap5.json', JSON.stringify(capAnterior, null, 1));
console.log('FIN cap6. capturado:', Object.keys(capAnterior.capturado).length);
c.close();
