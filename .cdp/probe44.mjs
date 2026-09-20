import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const run = async (e) => { const rr = await c.send('Runtime.evaluate', { expression: e, returnByValue: true }); return rr.result?.result?.value; };
const info = await run(`(() => {
  const el = document.getElementById('ext-gen44');
  if (!el) return 'NO EXISTE ext-gen44';
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return { tag: el.tagName, cls: el.className.toString(), id: el.id, x: r.x, y: r.y, w: r.width, h: r.height, z: cs.zIndex, display: cs.display, vis: cs.visibility, op: cs.opacity, html: el.innerHTML.slice(0,200) };
})()`);
console.log(JSON.stringify(info, null, 1));
// donde esta el label Cargos y que hay encima
const probe = await run(`(() => {
  const el = document.getElementById('O174_id');
  if (!el) return 'no label';
  const r = el.getBoundingClientRect();
  const x = r.x + r.width/2, y = r.y + r.height/2;
  const stack = [];
  let e2 = document.elementFromPoint(x, y);
  let guard = 0;
  while (e2 && guard < 6) {
    const cs = getComputedStyle(e2);
    stack.push({ id: e2.id || '', tag: e2.tagName, cls: (e2.className||'').toString().slice(0,50), z: cs.zIndex });
    e2 = e2.parentElement; guard++;
  }
  return { x: Math.round(x), y: Math.round(y), labelRect: {x: r.x, y: r.y, w: r.width, h: r.height}, stack };
})()`);
console.log(JSON.stringify(probe, null, 1));
c.close();
