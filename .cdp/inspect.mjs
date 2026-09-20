import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const cdp = await connect(tab.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
const ev = await cdp.send('Runtime.evaluate', { expression: `(() => {
  const txts = ['Opciones','Archivos','Admin.','Cobros','Pagos','Reportes','Clientes','Cobradores','Cargos','Cerrar','Descargos','Entregas','Cuadres'];
  const found = [];
  const all = [...document.querySelectorAll('*')];
  for (const t of txts) {
    const els = all.filter(e => (e.innerText||'').trim() === t && e.children.length === 0);
    found.push({ txt: t, matches: els.map(e => ({tag: e.tagName, cls: e.className, id: e.id, parentCls: e.parentElement?.className, offsetH: e.offsetHeight, vis: getComputedStyle(e).display})) });
  }
  // buscar el contenedor de la barra de menu
  const bar = document.querySelector('.ux-toolbar, .x-toolbar, .x-menu-bar, table.x-btn');
  out_bar = bar ? bar.className : 'no-bar';
  return { found, bar: out_bar, htmllen: document.body.innerHTML.length };
})()`, returnByValue: true });
const v = ev.result?.result?.value;
console.log(JSON.stringify(v, null, 1));
cdp.close();