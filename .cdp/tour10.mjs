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

// 1) restaurar todo lo oculto por tours anteriores
await run(`(() => { for (const w of [...document.querySelectorAll('.x-window')]) { w.style.display=''; } return 1; })()`);
await sleep(400);
// 2) limpiar confirmaciones y mascaras
await run(`(() => { try { if (Ext.MessageBox) Ext.MessageBox.hide(); } catch(e){} for (const m of [...document.querySelectorAll('.ext-el-mask')]) m.remove(); const b=document.querySelector('body.x-body-masked'); if(b) b.classList.remove('x-body-masked'); return 1; })()`);
await sleep(300);
// 3) poner Opciones al frente y verificar z
const zinfo = await run(`(() => { try { Ext.getCmp('OBF_id').toFront(); } catch(e){ return 'tofront-err'; } const w=document.getElementById('OBF_id'); const zs=[...document.querySelectorAll('.x-window')].map(x=>parseInt(x.style.zIndex||'0',10)); return { zopc: w?w.style.zIndex:null, maxotro: Math.max(...zs.filter(z=>z!=w.style.zIndex)) }; })()`);
console.log("toFront Opciones:", JSON.stringify(zinfo));

const GRUPOS = {
  'Cobros':   { cab: 'O10C_id', cue: 'O12A_id' },
  'Pagos':    { cab: 'O19F_id', cue: 'O1AE_id' },
  'Reportes': { cab: 'O1EC_id', cue: 'O1FB_id' },
};
const ITEMS = [
  ['Admin.', 'Archivos', 'O164_id'],
  ['Descargos', 'Pagos', 'O1C1_id'],
  ['Descargos Rec.', 'Pagos', 'O1C9_id'],
  ['Pagos', 'Pagos', 'O1D1_id'],
  ['Entregas', 'Pagos', 'O1D9_id'],
  ['Monitor C', 'Reportes', 'O20E_id'],
];

const desplegar = async (grupo) => {
  const g = GRUPOS[grupo]; if (!g) return true;
  for (let i = 0; i < 3; i++) {
    if (await hCuerpo(g.cue) > 40) return true;
    await run(`(() => { try { Ext.getCmp('OBF_id').toFront(); } catch(e){} return 1; })()`);
    await sleep(250);
    const L = await loc(g.cab); if (!L) continue;
    const p = await enPunto(L.x, L.y);
    if (p !== g.cab) { await sleep(300); continue; }
    await clickAt(L.x, L.y);
    await sleep(1600);
    await run(`(() => { for (const m of [...document.querySelectorAll('.ext-el-mask')]) m.remove(); return 1; })()`);
  }
  return (await hCuerpo(g.cue) > 40);
};

const capturaUna = async (id) => run(`(() => {
  const w = document.getElementById(${JSON.stringify(id)});
  if (!w) return null;
  const out = { title: (w.querySelector('.x-window-header-text')?.innerText||'').trim() };
  out.texto = (w.innerText||'').replace(/\\n\\s*\\n/g,'\\n').slice(0,4000);
  out.grids = [...w.querySelectorAll('.x-grid3')].map(g=>({cols:[...g.querySelectorAll('.x-grid3-hd-inner')].map(h=>h.innerText.trim()).filter(Boolean), rows:g.querySelectorAll('.x-grid3-row').length, rowsTxt:[...g.querySelectorAll('.x-grid3-row')].slice(0,10).map(r=>[...r.querySelectorAll('.x-grid3-cell')].map(c2=>c2.innerText.trim()))}));
  out.forms = [...w.querySelectorAll('.x-form-field')].filter(f=>f.type!=='hidden').map(f=>({id:f.id, tipo:f.type||f.tagName, val:(f.value||'').slice(0,25)}));
  out.labels = [...w.querySelectorAll('label')].map(l=>(l.innerText||'').trim().slice(0,40)).filter(Boolean);
  out.btns = [...w.querySelectorAll('table.x-btn, .x-btn-text, button')].map(b=>(b.innerText||b.value||'').trim().slice(0,30)).filter(Boolean);
  out.tabs = [...w.querySelectorAll('.x-tab-strip-text, .x-tab-inner')].map(e=>e.innerText.trim()).filter(Boolean);
  out.toolbars = [...w.querySelectorAll('.x-toolbar, .x-statusbar')].map(t=>(t.innerText||'').replace(/\\n\\s*\\n/g,'\\n').trim().slice(0,200));
  out.combos = [...w.querySelectorAll('select')].map(s=>({sel:s.options[s.selectedIndex]?.text||'', opts:[...s.options].map(o=>o.text).slice(0,15)}));
  return out;
})()`);

const visTit = async () => run(`(() => [...document.querySelectorAll('.x-window')].filter(w=>getComputedStyle(w).display!=='none').map(w=>w.id))()`);

const result = {};
for (const [nombre, grupo, id] of ITEMS) {
  await run(`(() => { try { Ext.getCmp('OBF_id').toFront(); } catch(e){} for (const m of [...document.querySelectorAll('.ext-el-mask')]) m.remove(); const b=document.querySelector('body.x-body-masked'); if(b) b.classList.remove('x-body-masked'); return 1; })()`);
  await sleep(300);
  const expandio = await desplegar(grupo);
  const L = await loc(id);
  if (!L || L.w < 8 || L.vis === 'none') { result[nombre] = { err: 'no-loc', expandio }; continue; }
  await run(`(() => { try { Ext.getCmp('OBF_id').toFront(); } catch(e){} return 1; })()`);
  await sleep(250);
  const punto = await enPunto(L.x, L.y);
  if (punto !== id) { result[nombre] = { err: 'click-blocked', hay: punto, expandio }; continue; }
  const antes = await visTit();
  c.drain();
  await clickAt(L.x, L.y);
  await sleep(5500);
  await run(`(() => { for (const m of [...document.querySelectorAll('.ext-el-mask')]) m.remove(); const b=document.querySelector('body.x-body-masked'); if(b) b.classList.remove('x-body-masked'); return 1; })()`);
  const despues = await visTit();
  const nuevos = despues.filter(x => !antes.includes(x));
  let cap = null;
  if (nuevos.length) cap = await capturaUna(nuevos[nuevos.length - 1]);
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
  for (const r of reqs) if (fin.has(r.id)) {
    r.respStatus = resp[r.id] ? resp[r.id].status : null;
    try { const rb = await c.send('Network.getResponseBody', { requestId: r.id }); if (rb && rb.body) r.respBody = rb.body.slice(0, 700); } catch (e) {}
  }
  if (cap) cap.red = reqs.slice(0, 25);
  result[nombre] = cap || { err: 'no-window', expandio, nuevos };
}
fs.writeFileSync('.cdp/tour10.json', JSON.stringify(result, null, 1));
console.log('fin tour10:', JSON.stringify(Object.fromEntries(Object.entries(result).map(([k,v])=>[k, v?.title || v?.err || 'ok']))));
c.close();
