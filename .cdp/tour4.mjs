import { findOrCreateTab, connect } from './cdp.mjs';
import fs from 'fs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const cdp = await connect(tab.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const run = async (expr) => (await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
const clickAt = async (x,y) => {
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseMoved', x, y });
  await sleep(200);
  await cdp.send('Input.dispatchMouseEvent', { type:'mousePressed', x, y, button:'left', clickCount:1 });
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseReleased', x, y, button:'left', clickCount:1 });
};
const logged = await run(`(() => (document.body.innerText||'').includes('Opciones') && !(document.body.innerText||'').includes('Inicio de Sesión'))()`);
console.log('LOGUEADO:', logged);
if (!logged) { console.log('ESPERANDO LOGIN DEL USUARIO'); cdp.close(); process.exit(3); }

// despejar: minimizar ventanas de modulo (NUNCA destroy/close)
const clearWindows = async () => {
  for (let i=0;i<8;i++) {
    const res = await run(`(() => {
      const keep = new Set(['Opciones','Confirm','Monitor de Cobradores']);
      const w = [...document.querySelectorAll('.x-window')].find(w => {
        const t = (w.querySelector('.x-window-header-text')?.innerText||'').trim();
        return t && !keep.has(t) && getComputedStyle(w).display !== 'none';
      });
      if (!w) return null;
      const cmp = Ext.getCmp(w.id);
      if (!cmp) return null;
      try { cmp.minimize(); } catch(e) { try { cmp.hide(); } catch(e2) { return null; } }
      return { min: w.id };
    })()`);
    if (!res) break;
    await sleep(500);
  }
};
await clearWindows();
const capture = async () => {
  return await run(`(() => {
    const keep = new Set(['Opciones','Confirm','Monitor de Cobradores']);
    const wins = [...document.querySelectorAll('.x-window')].filter(w => getComputedStyle(w).display !== 'none');
    const top = wins.map(w => ({ w, z: parseInt(w.style.zIndex||'0',10) }))
      .filter(o => { const t=(o.w.querySelector('.x-window-header-text')?.innerText||'').trim(); return t && !keep.has(t); })
      .sort((a,b)=>b.z-a.z)[0];
    const w = top?.w;
    if (!w) return null;
    const out = {};
    out.title = (w.querySelector('.x-window-header-text')?.innerText||'').trim();
    out.z = top.z;
    out.texto = (w.innerText||'').replace(/\\n\\s*\\n/g,'\\n').slice(0,2500);
    out.grids = [...w.querySelectorAll('.x-grid3')].map(g=>({cols:[...g.querySelectorAll('.x-grid3-hd-inner')].map(h=>h.innerText.trim()).filter(Boolean), rows:g.querySelectorAll('.x-grid3-row').length, rowsTxt:[...g.querySelectorAll('.x-grid3-row')].slice(0,10).map(r=>[...r.querySelectorAll('.x-grid3-cell')].map(c=>c.innerText.trim()))}));
    out.forms = [...w.querySelectorAll('.x-form-field')].filter(f=>f.type!=='hidden').map(f=>({id:f.id, name:f.name||'', tipo:f.type||f.tagName, val:(f.value||'').slice(0,20)}));
    out.labels = [...w.querySelectorAll('label')].map(l=>({id:l.id, txt:(l.innerText||'').trim().slice(0,50)})).filter(x=>x.txt);
    out.btns = [...w.querySelectorAll('table.x-btn, .x-btn-text, .x-menu-item-text, button')].map(b=>({txt:(b.innerText||'').trim(), id:b.id})).filter(x=>x.txt);
    out.tabs = [...w.querySelectorAll('.x-tab-strip-text, .x-tab-inner')].map(e=>e.innerText.trim()).filter(Boolean);
    out.toolbars = [...w.querySelectorAll('.x-toolbar, .x-statusbar')].map(t=>({txt:(t.innerText||'').replace(/\\n\\s*\\n/g,'\\n').trim().slice(0,200)}));
    return out;
  })()`);
};
const ITEMS = [
  ['Clientes','O16C_id'], ['Cargos','O174_id'], ['Cargos Rec.','O17C_id'],
  ['Cobros','O184_id'], ['Depositos','O18C_id'], ['Descargos','O1C1_id'],
  ['Descargos Rec.','O1C9_id'], ['Pagos','O1D1_id'], ['Entregas','O1D9_id'],
  ['Monitor C','O20E_id'], ['Cuadres','O216_id'], ['Reportes','O21E_id'],
  ['Monitor Z','O226_id'],
];
const result = {};
for (const [nombre, id] of ITEMS) {
  await clearWindows();
  const L = await run(`(() => { const el=document.getElementById(${JSON.stringify(id)}); if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2, vis:getComputedStyle(el).display, txt:(el.innerText||'').trim()}; })()`);
  if (!L) { result[nombre] = { err:'no-loc' }; continue; }
  await clickAt(L.x, L.y);
  await sleep(3200);
  result[nombre] = await capture();
}
await clearWindows();
fs.writeFileSync('.cdp/tour4.json', JSON.stringify(result, null, 1));
console.log('fin tour4 con', Object.keys(result).length, 'modulos');
cdp.close();