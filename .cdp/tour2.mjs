import { findOrCreateTab, connect } from './cdp.mjs';
import fs from 'fs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const cdp = await connect(tab.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
const sleep = ms => new Promise(r=>setTimeout(r,ms));

const key = async (k, code, vk) => {
  await cdp.send('Input.dispatchKeyEvent', { type:'rawKeyDown', key:k, code, windowsVirtualKeyCode:vk });
  await cdp.send('Input.dispatchKeyEvent', { type:'keyUp', key:k, code, windowsVirtualKeyCode:vk });
};
const ESC = () => key('Escape','Escape',27);

const locEl = async (expr) => {
  const ev = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return ev.result?.result?.value;
};
const clickAt = async (x, y) => {
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseMoved', x, y });
  await sleep(200);
  await cdp.send('Input.dispatchMouseEvent', { type:'mousePressed', x, y, button:'left', clickCount:1 });
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseReleased', x, y, button:'left', clickCount:1 });
};

// 1) cerrar Confirm "Desea salir?" respondiendo No
const noBtn = await locEl(`(() => {
  const w = [...document.querySelectorAll('.x-window')].find(w => (w.querySelector('.x-window-header-text')?.innerText||'').trim()==='Confirm');
  if (!w) return null;
  const b = [...w.querySelectorAll('table.x-btn, .x-btn-text, button, .x-btn')].find(x => (x.innerText||'').trim()==='No');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: r.x+r.width/2, y: r.y+r.height/2 };
})()`);
console.log('CONFIRM No btn:', JSON.stringify(noBtn));
if (noBtn) { await clickAt(noBtn.x, noBtn.y); await sleep(1200); }

// 2) cerrar ventanas de modulo abiertas con Escape (hasta 3 veces)
for (let i=0;i<3;i++) { await ESC(); await sleep(700); }

const capture = async () => {
  const ev = await cdp.send('Runtime.evaluate', { expression: `(() => {
    const wins = [...document.querySelectorAll('.x-window')].filter(w => getComputedStyle(w).display !== 'none');
    const top = wins.map(w => ({ w, z: parseInt(w.style.zIndex||'0',10) }))
      .filter(o => { const t=(o.w.querySelector('.x-window-header-text')?.innerText||'').trim(); return t && t!=='Opciones' && t!=='Confirm'; })
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
    return out;
  })()`, returnByValue: true });
  return ev.result?.result?.value;
};

const ITEMS = [
  ['Clientes','O16C_id'], ['Cobradores','O164buscar'], ['Cargos','O174_id'],
  ['Cargos Rec.','O17C_id'], ['Cobros','O184_id'], ['Depositos','O18C_id'],
  ['Descargos','O1C1_id'], ['Descargos Rec.','O1C9_id'], ['Pagos','O1D1_id'],
  ['Entregas','O1D9_id'], ['Monitor C','O20E_id'], ['Cuadres','O216_id'],
  ['Reportes','O21E_id'], ['Monitor Z','O226_id'],
];
const result = {};
for (const [nombre, id] of ITEMS) {
  if (id.endsWith('buscar')) { result[nombre] = { skip: 'ubicar id' }; continue; }
  for (let i=0;i<2;i++) { await ESC(); await sleep(500); }
  const L = await locEl(`(() => {
    const el = document.getElementById(${JSON.stringify(id)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x+r.width/2, y: r.y+r.height/2, vis: getComputedStyle(el).display, txt:(el.innerText||'').trim() };
  })()`);
  if (!L) { result[nombre] = { err:'no-loc' }; continue; }
  await clickAt(L.x, L.y);
  await sleep(3200);
  result[nombre] = await capture();
}
fs.writeFileSync('.cdp/tour2.json', JSON.stringify(result, null, 1));
console.log('fin tour2 con', Object.keys(result).length, 'modulos');
cdp.close();