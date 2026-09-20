import { findOrCreateTab, connect } from './cdp.mjs';
import fs from 'fs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
await c.send('Network.enable');
await c.send('Page.enable');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = async (e) => { const rr = await c.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return rr.result?.result?.value; };

// --- 0. comprobar sesion abierta (no login) ---
const login = await run(`(() => { return !!(document.getElementById('O93_id') || document.getElementById('O9B_id')); })()`);
if (login) { console.log('ABORT: sigue en login, no hay sesion'); c.close(); process.exit(2); }

// --- 1. limpieza segura (mascaras sueltas + confirm colgante) ---
await run(`(() => { try { if (Ext.MessageBox) Ext.MessageBox.hide(); } catch(e){} return 1; })()`);
await sleep(400);
await run(`(() => { for (const m of [...document.querySelectorAll('.ext-el-mask')]) m.remove(); const b=document.querySelector('body.x-body-masked'); if(b) b.classList.remove('x-body-masked'); return 1; })()`);

const visIds = async () => run(`(() => [...document.querySelectorAll('.x-window')].filter(w=>getComputedStyle(w).display!=='none').map(w=>w.id))()`);
const rectOf = async (id) => run(`(() => { const el=document.getElementById('${id}'); if(!el) return null; const r=el.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2), w:r.width, h:r.height, disp:getComputedStyle(el).display}; })()`);
const grupoH = async (id) => run(`(() => { const el=document.getElementById('${id}'); return el ? Math.round(el.getBoundingClientRect().height) : -1; })()`);

const clickReal = async (x, y) => {
  await c.send('Input.dispatchMouseEvent', { type:'mouseMoved', x, y });
  await sleep(180);
  await c.send('Input.dispatchMouseEvent', { type:'mousePressed', x, y, button:'left', clickCount:1 });
  await c.send('Input.dispatchMouseEvent', { type:'mouseReleased', x, y, button:'left', clickCount:1 });
};

// --- 2. menu al frente ---
await run(`(() => { try { Ext.getCmp('OBF_id').toFront(); } catch(e){} return 1; })()`);
await sleep(500);

const targets = [
  { item:'O164_id', cuerpo:'O11B_id', cab:'OEE_id', nombre:'Admin.' },
  { item:'O16C_id', cuerpo:'O11B_id', cab:'OEE_id', nombre:'Clientes' },
  { item:'O1C1_id', cuerpo:'O1AE_id', cab:'O19F_id', nombre:'Descargos' },
  { item:'O1C9_id', cuerpo:'O1AE_id', cab:'O19F_id', nombre:'Descargos Rec.' },
  { item:'O1D1_id', cuerpo:'O1AE_id', cab:'O19F_id', nombre:'Pagos' },
  { item:'O1D9_id', cuerpo:'O1AE_id', cab:'O19F_id', nombre:'Entregas' },
  { item:'O20E_id', cuerpo:'O1FB_id', cab:'O1EC_id', nombre:'Monitor C' },
];

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
  out.toolbars = [...w.querySelectorAll('.x-toolbar, .x-statusbar')].map(t=>(t.innerText||'').replace(/\\n\\s*\\n/g,'\\n').trim().slice(0,220));
  out.combos = [...w.querySelectorAll('select')].map(s=>({sel:s.options[s.selectedIndex]?.text||'', opts:[...s.options].map(o=>o.text).slice(0,15)}));
  return out;
})()`);

const result = { capturado: {}, errores: [] };
for (const t of targets) {
  // a. asegurar grupo expandido
  const h = await grupoH(t.cuerpo);
  if (h <= 2) {
    const cab = await rectOf(t.cab);
    if (!cab) { result.errores.push(`${t.nombre}: cabecera ${t.cab} no encontrada`); continue; }
    await clickReal(cab.x, cab.y);
    await sleep(2500);
  }
  // b. menu al frente
  await run(`(() => { try { Ext.getCmp('OBF_id').toFront(); } catch(e){} return 1; })()`);
  await sleep(350);
  // c/d. clic real en el item
  const antes = await visIds();
  const it = await rectOf(t.item);
  if (!it || it.disp === 'none') { result.errores.push(`${t.nombre}: item ${t.item} no visible`); continue; }
  await clickReal(it.x, it.y);
  await sleep(5500);
  // e. diff de ventanas
  const despues = await visIds();
  const nuevas = despues.filter(x => !antes.includes(x));
  if (!nuevas.length) { result.errores.push(`${t.nombre}: no se abrio ventana nueva (posible clic en ventana equívoca)`); continue; }
  // f. capturar la ultima ventana nueva (suele ser la de encima)
  const cap = await capturaUna(nuevas[nuevas.length - 1]);
  if (!cap) { result.errores.push(`${t.nombre}: ventana ${nuevas[nuevas.length-1]} sin contenido`); continue; }
  cap.winId = nuevas[nuevas.length - 1];
  cap.clicEn = { item: t.item, x: it.x, y: it.y };
  // g. red de la apertura
  const evs = c.drain();
  const reqs = []; const fin = new Set(); const resp = {};
  for (const ev of evs) {
    const p = ev.params;
    if (ev.method === 'Network.requestWillBeSent' && p.request && p.request.url.includes('cyp10_front'))
      reqs.push({ id: p.requestId, postData: p.request.postData ? decodeURIComponent(p.request.postData).slice(0,400) : null });
    if (ev.method === 'Network.responseReceived' && p.response && p.response.url.includes('cyp10_front'))
      resp[p.requestId] = { status: p.response.status, mime: p.response.mimeType };
    if (ev.method === 'Network.loadingFinished') fin.add(p.requestId);
  }
  for (const r of reqs) if (fin.has(r.id)) { r.respStatus = resp[r.id]?resp[r.id].status:null; try { const rb = await c.send('Network.getResponseBody', { requestId: r.id }); if (rb && rb.body) r.respBody = rb.body.replace(/\s+/g,' ').slice(0,700); } catch(e){} }
  cap.red = reqs.slice(0, 20);
  result.capturado[t.nombre] = cap;
  console.log('OK', t.nombre, '->', cap.title, '| win', cap.winId, '| red', cap.red.length, '| grids', cap.grids.length);
}

// --- 3. grupo Cerrar: solo lectura de sus 4 items (SIN clic, podrian mutar el dia) ---
const cerrarCab = await rectOf('O139_id');
if (cerrarCab) {
  const h0 = await grupoH('O139_id');
  // los items del grupo Cerrar: leer texto de las labels internas aunque este colapsado
  const itemsCerrar = await run(`(() => {
    const ids = ['O150_id','O154_id','O158_id','O15C_id'];
    return ids.map(id => { const el = document.getElementById(id); return { id, txt: el ? (el.innerText||'').trim().slice(0,40) : null, tag: el ? el.tagName : null }; });
  })()`);
  result.grupoCerrar = { cabecera:'O139_id', altura: h0, items: itemsCerrar };
  console.log('grupoCerrar:', JSON.stringify(itemsCerrar));
}

fs.writeFileSync('.cdp/cap5.json', JSON.stringify(result, null, 1));
console.log('FIN. capturados:', Object.keys(result.capturado).length, 'errores:', JSON.stringify(result.errores));
c.close();
