import { findOrCreateTab, connect } from './cdp.mjs';
import fs from 'fs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const run = async (e) => (await c.send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
const clickAt = async (x,y) => {
  await c.send('Input.dispatchMouseEvent', { type:'mouseMoved', x, y });
  await sleep(200);
  await c.send('Input.dispatchMouseEvent', { type:'mousePressed', x, y, button:'left', clickCount:1 });
  await c.send('Input.dispatchMouseEvent', { type:'mouseReleased', x, y, button:'left', clickCount:1 });
};
const logged = await run(`(() => (document.body.innerText||'').includes('Opciones') && !(document.body.innerText||'').includes('Inicio de Sesión'))()`);
console.log('LOGUEADO:', logged);
if (!logged) { console.log('ESPERANDO LOGIN'); c.close(); process.exit(3); }

const KEEP = new Set(['Opciones','Monitor de Cobradores']);
const clearWindows = async () => {
  for (let i=0;i<10;i++) {
    const res = await run(`(() => {
      const w = [...document.querySelectorAll('.x-window')].find(w => {
        const t = (w.querySelector('.x-window-header-text')?.innerText||'').trim();
        return t && !${JSON.stringify([...KEEP])}.includes(t) && getComputedStyle(w).display !== 'none';
      });
      if (!w) return null;
      const cmp = Ext.getCmp(w.id);
      if (!cmp) return null;
      try { cmp.minimize(); } catch(e) { try { cmp.hide(); } catch(e2) { return null; } }
      return { min: w.id };
    })()`);
    if (!res) break;
    await sleep(450);
  }
};
await clearWindows();
const capture = async () => await run(`(() => {
  const wins = [...document.querySelectorAll('.x-window')].filter(w => getComputedStyle(w).display !== 'none');
  const top = wins.map(w => ({ w, z: parseInt(w.style.zIndex||'0',10) }))
    .filter(o => { const t=(o.w.querySelector('.x-window-header-text')?.innerText||'').trim(); return t && !${JSON.stringify([...KEEP])}.includes(t); })
    .sort((a,b)=>b.z-a.z)[0];
  const w = top?.w;
  if (!w) return null;
  const out = {};
  out.title = (w.querySelector('.x-window-header-text')?.innerText||'').trim();
  out.z = top.z;
  out.texto = (w.innerText||'').replace(/\\n\\s*\\n/g,'\\n').slice(0,4000);
  out.grids = [...w.querySelectorAll('.x-grid3')].map(g=>({cols:[...g.querySelectorAll('.x-grid3-hd-inner')].map(h=>h.innerText.trim()).filter(Boolean), rows:g.querySelectorAll('.x-grid3-row').length, rowsTxt:[...g.querySelectorAll('.x-grid3-row')].slice(0,12).map(r=>[...r.querySelectorAll('.x-grid3-cell')].map(c=>c.innerText.trim()))}));
  out.forms = [...w.querySelectorAll('.x-form-field')].filter(f=>f.type!=='hidden').map(f=>({id:f.id, name:f.name||'', tipo:f.type||f.tagName, val:(f.value||'').slice(0,25)}));
  out.labels = [...w.querySelectorAll('label')].map(l=>({id:l.id, txt:(l.innerText||'').trim().slice(0,50)})).filter(x=>x.txt);
  out.btns = [...w.querySelectorAll('table.x-btn, .x-btn-text, .x-menu-item-text, button, a')].map(b=>({txt:(b.innerText||b.value||'').trim().slice(0,30), id:b.id})).filter(x=>x.txt);
  out.tabs = [...w.querySelectorAll('.x-tab-strip-text, .x-tab-inner')].map(e=>e.innerText.trim()).filter(Boolean);
  out.toolbars = [...w.querySelectorAll('.x-toolbar, .x-statusbar')].map(t=>({txt:(t.innerText||'').replace(/\\n\\s*\\n/g,'\\n').trim().slice(0,220)}));
  out.combos = [...w.querySelectorAll('select')].map(s=>({id:s.id, opts:[...s.options].map(o=>o.text).slice(0,10), sel:s.options[s.selectedIndex]?.text||''}));
  out.checks = [...w.querySelectorAll('input[type=checkbox]')].map(x=>({id:x.id, chk:x.checked}));
  return out;
})()`);

const ITEMS = [
  ['Clientes','O16C_id'], ['Admin.','O164_id'], ['Cargos','O174_id'], ['Cargos Rec.','O17C_id'],
  ['Cobros','O184_id'], ['Depositos','O18C_id'], ['Cerrar','O14C_id'],
  ['Descargos','O1C1_id'], ['Descargos Rec.','O1C9_id'], ['Pagos','O1D1_id'], ['Entregas','O1D9_id'],
  ['Monitor C','O20E_id'], ['Cuadres','O216_id'], ['Reportes','O21E_id'], ['Monitor Z','O226_id'],
];
const result = {};
for (const [nombre, id] of ITEMS) {
  await clearWindows();
  const L = await run(`(() => { const el=document.getElementById(${JSON.stringify(id)}); if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2, vis:getComputedStyle(el).display, txt:(el.innerText||'').trim(), w:Math.round(r.width)}; })()`);
  if (!L || L.vis==='none' || L.w < 15) { result[nombre] = { err:'no-loc', L }; continue; }
  await clickAt(L.x, L.y);
  await sleep(4500);
  result[nombre] = await capture();
}
await clearWindows();
fs.writeFileSync('.cdp/tour5.json', JSON.stringify(result, null, 1));
console.log('fin tour5 con', Object.keys(result).length, 'modulos');
c.close();
