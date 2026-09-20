import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const run = async (e) => (await c.send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

// limpiar TODO incluido Confirm (minimizar, nunca destroy)
for (let i=0;i<12;i++) {
  const res = await run(`(() => {
    const w = [...document.querySelectorAll('.x-window')].find(w => {
      const t = (w.querySelector('.x-window-header-text')?.innerText||'').trim();
      return t && t !== 'Opciones' && getComputedStyle(w).display !== 'none';
    });
    if (!w) return null;
    const cmp = Ext.getCmp(w.id);
    if (!cmp) { try { w.style.display='none'; } catch(e){} return {force:w.id}; }
    try { cmp.minimize(); } catch(e) { try { cmp.hide(); } catch(e2) { return null; } }
    return { min: w.id };
  })()`);
  if (!res) break;
  await sleep(350);
}
await sleep(400);

// re-mapear menu Opciones: arbol por anidamiento de coordenadas
const tree = await run(`(() => {
  const root = document.getElementById('OBF_id');
  if (!root) return 'NO-ROOT';
  const nodes = [...root.querySelectorAll('.x-window')].map(w => {
    const r = w.getBoundingClientRect();
    const own = (w.querySelector('.x-window-header-text')?.innerText||'').trim();
    // texto propio = texto de la primera fila de su body directo (sin subventanas)
    let txt = own;
    if (!txt) {
      const body = w.querySelector('.x-window-body');
      if (body) {
        const clone = body.cloneNode(true);
        [...clone.querySelectorAll('.x-window')].forEach(x=>x.remove());
        txt = (clone.innerText||'').trim().split('\\n')[0];
      }
    }
    return { id: w.id, txt, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), vis: getComputedStyle(w).display };
  }).filter(n => n.txt && n.vis !== 'none' && n.w >= 20 && n.h >= 10);
  return JSON.stringify(nodes);
})()`);
console.log('TREE:', tree);
c.close();
