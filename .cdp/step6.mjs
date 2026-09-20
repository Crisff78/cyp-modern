import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const cdp = await connect(tab.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
const ev = await cdp.send('Runtime.evaluate', { expression: `(() => {
  const out = {};
  out.texto = document.body.innerText;
  // menus: Ext usa td con clase x-btn-text o items de menu
  out.botones = [...document.querySelectorAll('.x-btn-text, .x-btn-inner, td.x-btn-mc, a.x-menu-item, .x-menu-item-text')]
    .map(e => (e.innerText||e.textContent||'').trim()).filter(t => t.length>0 && t.length<40);
  out.menus = [...document.querySelectorAll('.x-menu-item-text, .x-menu-list-item')].map(e=>e.innerText.trim()).filter(Boolean);
  out.tabs = [...document.querySelectorAll('.x-tab-strip-text, .x-tab-inner')].map(e=>e.innerText.trim()).filter(Boolean);
  // estructura de tablas
  out.tablas = [...document.querySelectorAll('table')].slice(0,20).map(t=>({cls:t.className, rows:t.rows.length, txt:(t.innerText||'').slice(0,80)}));
  out.forms = [...document.querySelectorAll('form')].map(f=>({action:f.action, fields:[...f.querySelectorAll('input,select')].map(i=>i.id+'/'+i.name+'/'+i.type).slice(0,10)}));
  return out;
})()`, returnByValue: true });
const v = ev.result?.result?.value;
console.log('=== TEXTO ==='); console.log(v.texto.slice(0,2500));
console.log('=== BOTONES ==='); console.log(JSON.stringify(v.botones));
console.log('=== MENUS ==='); console.log(JSON.stringify(v.menus));
console.log('=== TABS ==='); console.log(JSON.stringify(v.tabs));
cdp.close();
