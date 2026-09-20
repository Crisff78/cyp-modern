import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const run = async (e) => (await c.send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

// minimizar Confirm y Listado de Clientes (nunca destroy)
const r1 = await run(`(() => {
  const out = [];
  for (const id of ['ext-comp-1042','O2D8_id']) {
    const cmp = Ext.getCmp(id);
    try { cmp.minimize(); out.push(id+':min'); } catch(e) { try { cmp.hide(); out.push(id+':hide'); } catch(e2) { out.push(id+':fail'); } }
  }
  return out.join(',');
})()`);
console.log('MINIMIZE:', r1);
await sleep(700);

// inventario real del menu Opciones
const inv = await run(`(() => {
  const w = document.getElementById('OBF_id');
  if (!w) return 'NO-WIN';
  const out = [];
  const cands = [...w.querySelectorAll('a, td, div, span, li')];
  for (const el of cands) {
    const txt = (el.innerText||el.textContent||'').trim();
    if (!txt || txt.length > 40) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 8) continue;
    const vis = getComputedStyle(el).display;
    if (vis === 'none') continue;
    // solo elementos hoja (sin hijos con mismo texto)
    out.push({ txt, id: el.id, tag: el.tagName, cls: el.className||'', x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), vis });
  }
  return JSON.stringify(out);
})()`);
console.log('MENU ITEMS:', inv);
c.close();
