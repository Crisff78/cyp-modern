import { findOrCreateTab, connect } from './cdp.mjs';
import fs from 'fs';

const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
await c.send('Network.enable', {}, 30000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = async (e) => { const rr = await c.send('Runtime.evaluate', { expression: e, returnByValue: true }); return rr.result?.result?.value; };
const clickAt = async (x, y) => {
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(220);
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const loc = async (id) => run(`(() => { const el=document.getElementById(${JSON.stringify(id)}); if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2, w:Math.round(r.width), h:Math.round(r.height), vis:getComputedStyle(el).display}; })()`);
const hCuerpo = async (id) => run(`(() => { const w=document.getElementById(${JSON.stringify(id)}); return w?Math.round(w.getBoundingClientRect().height):-1; })()`);
const enPunto = async (x, y) => run(`(() => { const el=document.elementFromPoint(${x},${y}); if(!el) return null; let p = el; for(let i=0;i<4 && p;i++){ if(p.id) return p.id; p=p.parentElement; } return el.tagName; })()`);

const GRUPOS = {
  'Cobros':   { cab: 'O10C_id', cue: 'O12A_id' },
  'Pagos':    { cab: 'O19F_id', cue: 'O1AE_id' },
  'Reportes': { cab: 'O1EC_id', cue: 'O1FB_id' },
};
const ITEMS = [
  ['Admin.', 'Archivos', 'O164_id'], ['Clientes', 'Archivos', 'O16C_id'],
  ['Cargos', 'Cobros', 'O174_id'], ['Cargos Rec.', 'Cobros', 'O17C_id'],
  ['Cobros', 'Cobros', 'O184_id'], ['Depositos', 'Cobros', 'O18C_id'],
  ['Descargos', 'Pagos', 'O1C1_id'], ['Descargos Rec.', 'Pagos', 'O1C9_id'],
  ['Pagos', 'Pagos', 'O1D1_id'], ['Entregas', 'Pagos', 'O1D9_id'],
  ['Monitor C', 'Reportes', 'O20E_id'], ['Cuadres', 'Reportes', 'O216_id'],
  ['Reportes', 'Reportes', 'O21E_id'], ['Monitor Z', 'Reportes', 'O226_id'],
];
const KEEP_CLICK = ['Opciones'];

const limpiarMascara = async () => run(`(() => {
  let n = 0;
  for (const m of [...document.querySelectorAll('.ext-el-mask, .ext-masked')]) { m.remove(); n++; }
  const b = document.querySelector('body.x-body-masked'); if (b) { b.classList.remove('x-body-masked'); n++; }
  return n;
})()`);
const ocultarVentanas = async () => {
  await limpiarMascara();
  return run(`(() => {
    const hidden = [];
    for (const w of [...document.querySelectorAll('.x-window')]) {
      const t = (w.querySelector('.x-window-header-text')?.innerText || '').trim();
      if (!t) continue;
      if (${JSON.stringify(KEEP_CLICK)}.includes(t)) continue;
      if (getComputedStyle(w).display === 'none') continue;
      w.style.display = 'none';
      hidden.push(w.id);
    }
    return hidden;
  })()`);
};
const restaurar = async (ids) => { if (ids && ids.length) await run(`(() => { for (const id of ${JSON.stringify(ids)}) { const el=document.getElementById(id); if(el) el.style.display=''; } return 1; })()`); };
const tituloTop = async () => run(`(() => {
  const o = [...document.querySelectorAll('.x-window')].filter(w => getComputedStyle(w).display !== 'none')
    .map(w => ({ t: (w.querySelector('.x-window-header-text')?.innerText||'').trim(), z: parseInt(w.style.zIndex||'0',10) }))
    .filter(o => o.t).sort((a,b)=>b.z-a.z)[0];
  return o ? o.t : null;
})()`);

const desplegar = async (grupo) => {
  const g = GRUPOS[grupo]; if (!g) return;
  if (await hCuerpo(g.cue) > 40) return;
  const L = await loc(g.cab); if (!L) return;
  await clickAt(L.x, L.y);
  await sleep(1600);
  await limpiarMascara();
};

const capturar = async () => run(`(() => {
  const wins = [...document.querySelectorAll('.x-window')].filter(w => getComputedStyle(w).display !== 'none');
  const top = wins.map(w => ({ w, z: parseInt(w.style.zIndex||'0',10) }))
    .filter(o => { const t=(o.w.querySelector('.x-window-header-text')?.innerText||'').trim(); return t && t !== 'Opciones' && t !== 'Monitor de Cobradores'; })
    .sort((a,b)=>b.z-a.z)[0];
  const w = top?.w;
  if (!w) return null;
  const out = { title: (w.querySelector('.x-window-header-text')?.innerText||'').trim(), z: top.z };
  out.texto = (w.innerText||'').replace(/\\n\\s*\\n/g,'\\n').slice(0,3000);
  out.grids = [...w.querySelectorAll('.x-grid3')].map(g=>({cols:[...g.querySelectorAll('.x-grid3-hd-inner')].map(h=>h.innerText.trim()).filter(Boolean), rows:g.querySelectorAll('.x-grid3-row').length, rowsTxt:[...g.querySelectorAll('.x-grid3-row')].slice(0,8).map(r=>[...r.querySelectorAll('.x-grid3-cell')].map(c2=>c2.innerText.trim()))}));
  out.forms = [...w.querySelectorAll('.x-form-field')].filter(f=>f.type!=='hidden').map(f=>({id:f.id, tipo:f.type||f.tagName, val:(f.value||'').slice(0,25)}));
  out.labels = [...w.querySelectorAll('label')].map(l=>(l.innerText||'').trim().slice(0,40)).filter(Boolean);
  out.btns = [...w.querySelectorAll('table.x-btn, .x-btn-text, button')].map(b=>(b.innerText||b.value||'').trim().slice(0,30)).filter(Boolean);
  out.tabs = [...w.querySelectorAll('.x-tab-strip-text, .x-tab-inner')].map(e=>e.innerText.trim()).filter(Boolean);
  out.toolbars = [...w.querySelectorAll('.x-toolbar, .x-statusbar')].map(t=>(t.innerText||'').replace(/\\n\\s*\\n/g,'\\n').trim().slice(0,180));
  out.combos = [...w.querySelectorAll('select')].map(s=>({sel:s.options[s.selectedIndex]?.text||'', opts:[...s.options].map(o=>o.text).slice(0,12)}));
  return out;
})()`);

const getBody = async (requestId) => {
  try { const r = await c.send('Network.getResponseBody', { requestId }); if (r && r.body) return r.body.slice(0, 600); } catch (e) {}
  return null;
};

const result = {};
for (const [nombre, grupo, id] of ITEMS) {
  const hidden = await ocultarVentanas();
  await desplegar(grupo);
  const L = await loc(id);
  if (!L || L.w < 8 || L.vis === 'none') { result[nombre] = { err: 'no-loc' }; await restaurar(hidden); continue; }
  const punto = await enPunto(L.x, L.y);
  if (punto !== id) { result[nombre] = { err: 'click-blocked', hay: punto }; await restaurar(hidden); continue; }
  const antes = await tituloTop();
  c.drain();
  await clickAt(L.x, L.y);
  await sleep(5500);
  await limpiarMascara();
  const cap = await capturar();
  const evs = c.drain();
  const reqs = []; const fin = new Set(); const resp = {};
  for (const ev of evs) {
    const p = ev.params;
    if (ev.method === 'Network.requestWillBeSent' && p.request && p.request.url.includes('cyp10_front')) {
      reqs.push({ id: p.requestId, postData: p.request.postData ? decodeURIComponent(p.request.postData).slice(0,300) : null });
    }
    if (ev.method === 'Network.responseReceived' && p.response && p.response.url.includes('cyp10_front')) {
      resp[p.requestId] = { status: p.response.status, mime: p.response.mimeType };
    }
    if (ev.method === 'Network.loadingFinished') fin.add(p.requestId);
  }
  for (const r of reqs) {
    if (fin.has(r.id)) {
      r.respStatus = resp[r.id] ? resp[r.id].status : null;
      r.respBody = await getBody(r.id);
    }
  }
  if (cap) { cap.red = reqs.slice(0, 20); cap.stale = (cap.title === antes); }
  result[nombre] = cap || { err: 'no-window' };
  await restaurar(hidden);
}
fs.writeFileSync('.cdp/tour8.json', JSON.stringify(result, null, 1));
console.log('fin tour8 con', Object.keys(result).length, 'modulos');
c.close();
