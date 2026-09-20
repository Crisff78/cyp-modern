import { findOrCreateTab, connect } from './cdp.mjs';
import fs from 'fs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
await c.send('Network.enable', {}, 30000);
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const run = async (e) => { const rr = await c.send('Runtime.evaluate', { expression: e, returnByValue: true }); return rr.result?.result?.value; };
const clickAt = async (x,y) => {
  await c.send('Input.dispatchMouseEvent', { type:'mouseMoved', x, y });
  await sleep(220);
  await c.send('Input.dispatchMouseEvent', { type:'mousePressed', x, y, button:'left', clickCount:1 });
  await c.send('Input.dispatchMouseEvent', { type:'mouseReleased', x, y, button:'left', clickCount:1 });
};
const loc = async (id) => run(`(() => { const el=document.getElementById(${JSON.stringify(id)}); if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2, w:Math.round(r.width), h:Math.round(r.height), vis:getComputedStyle(el).display}; })()`);
const hCuerpo = async (id) => run(`(() => { const w=document.getElementById(${JSON.stringify(id)}); return w?Math.round(w.getBoundingClientRect().height):-1; })()`);

const GRUPOS = { // grupo -> {cabecera, cuerpo}
  'Cobros':  {cab:'O10C_id', cue:'O12A_id'},
  'Pagos':   {cab:'O19F_id', cue:'O1AE_id'},
  'Reportes':{cab:'O1EC_id', cue:'O1FB_id'},
};
const ITEMS = [
  ['Admin.','Archivos','O164_id'], ['Clientes','Archivos','O16C_id'],
  ['Cargos','Cobros','O174_id'], ['Cargos Rec.','Cobros','O17C_id'],
  ['Cobros','Cobros','O184_id'], ['Depositos','Cobros','O18C_id'],
  ['Descargos','Pagos','O1C1_id'], ['Descargos Rec.','Pagos','O1C9_id'],
  ['Pagos','Pagos','O1D1_id'], ['Entregas','Pagos','O1D9_id'],
  ['Monitor C','Reportes','O20E_id'], ['Cuadres','Reportes','O216_id'],
  ['Reportes','Reportes','O21E_id'], ['Monitor Z','Reportes','O226_id'],
];
const KEEP = new Set(['Opciones','Monitor de Cobradores']);

const desplegar = async (grupo) => {
  const g = GRUPOS[grupo]; if (!g) return;
  await run(`(() => { try { Ext.getCmp('OBF_id').toFront(); } catch(e){} return 1; })()`);
  await sleep(400);
  if (await hCuerpo(g.cue) > 40) return;
  const L = await loc(g.cab);
  if (!L) return;
  await clickAt(L.x, L.y);
  await sleep(1600);
};
const minimizarModulo = async () => {
  for (let i=0;i<6;i++) {
    const res = await run(`(() => {
      const w = [...document.querySelectorAll('.x-window')].find(w => {
        const t = (w.querySelector('.x-window-header-text')?.innerText||'').trim();
        return t && !${JSON.stringify([...KEEP])}.includes(t) && getComputedStyle(w).display !== 'none';
      });
      if (!w) return null;
      try { Ext.getCmp(w.id).minimize(); } catch(e) { try { Ext.getCmp(w.id).hide(); } catch(e2){ return null; } }
      return w.id;
    })()`);
    if (!res) break;
    await sleep(400);
  }
};
const capturar = async () => run(`(() => {
  const wins = [...document.querySelectorAll('.x-window')].filter(w => getComputedStyle(w).display !== 'none');
  const top = wins.map(w => ({ w, z: parseInt(w.style.zIndex||'0',10) }))
    .filter(o => { const t=(o.w.querySelector('.x-window-header-text')?.innerText||'').trim(); return t && !${JSON.stringify([...KEEP])}.includes(t); })
    .sort((a,b)=>b.z-a.z)[0];
  const w = top?.w;
  if (!w) return null;
  const out = { title:(w.querySelector('.x-window-header-text')?.innerText||'').trim(), z: top.z };
  out.texto = (w.innerText||'').replace(/\\n\\s*\\n/g,'\\n').slice(0,3000);
  out.grids = [...w.querySelectorAll('.x-grid3')].map(g=>({cols:[...g.querySelectorAll('.x-grid3-hd-inner')].map(h=>h.innerText.trim()).filter(Boolean), rows:g.querySelectorAll('.x-grid3-row').length, rowsTxt:[...g.querySelectorAll('.x-grid3-row')].slice(0,8).map(r=>[...r.querySelectorAll('.x-grid3-cell')].map(c=>c.innerText.trim()))}));
  out.forms = [...w.querySelectorAll('.x-form-field')].filter(f=>f.type!=='hidden').map(f=>({id:f.id, tipo:f.type||f.tagName, val:(f.value||'').slice(0,25)}));
  out.labels = [...w.querySelectorAll('label')].map(l=>(l.innerText||'').trim().slice(0,40)).filter(Boolean);
  out.btns = [...w.querySelectorAll('table.x-btn, .x-btn-text, button')].map(b=>(b.innerText||b.value||'').trim().slice(0,30)).filter(Boolean);
  out.tabs = [...w.querySelectorAll('.x-tab-strip-text, .x-tab-inner')].map(e=>e.innerText.trim()).filter(Boolean);
  out.toolbars = [...w.querySelectorAll('.x-toolbar, .x-statusbar')].map(t=>(t.innerText||'').replace(/\\n\\s*\\n/g,'\\n').trim().slice(0,180));
  out.combos = [...w.querySelectorAll('select')].map(s=>({sel:s.options[s.selectedIndex]?.text||'', opts:[...s.options].map(o=>o.text).slice(0,12)}));
  return out;
})()`);

const result = {};
for (const [nombre, grupo, id] of ITEMS) {
  await minimizarModulo();
  await desplegar(grupo);
  const L = await loc(id);
  if (!L || L.w < 8 || L.vis === 'none') { result[nombre] = { err:'no-loc' }; continue; }
  c.drain();
  await run(`(() => { try { Ext.getCmp('OBF_id').toFront(); } catch(e){} return 1; })()`);
  await sleep(300);
  await clickAt(L.x, L.y);
  await sleep(5500);
  result[nombre] = await capturar();
  // trafico de red generado por este modulo
  const evs = c.drain();
  const reqs = [];
  for (const ev of evs) {
    if (ev.method === 'Network.requestWillBeSent' && ev.params.request.url.includes('cyp10_front')) {
      const pd = ev.params.request.postData;
      reqs.push(pd ? decodeURIComponent(pd).slice(0,400) : (ev.params.request.url.slice(0,120)));
    }
  }
  if (result[nombre]) result[nombre].red = reqs.slice(0,25);
}
await minimizarModulo();
fs.writeFileSync('.cdp/tour6.json', JSON.stringify(result, null, 1));
console.log('fin tour6 con', Object.keys(result).length, 'modulos');
c.close();
