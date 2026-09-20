import { findOrCreateTab, connect } from './cdp.mjs';
import fs from 'fs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const run = async (e) => (await c.send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

const html = await run(`(() => { const w = document.getElementById('OBF_id'); return w ? w.innerHTML : 'NO-EXIST'; })()`);
fs.writeFileSync('.cdp/opciones.html', html);
console.log('bytes:', html.length);
// listado de ids y textos dentro de Opciones
const list = await run(`(() => {
  const w = document.getElementById('OBF_id');
  const out = [];
  for (const el of w.querySelectorAll('[id]')) {
    const r = el.getBoundingClientRect();
    out.push({ id: el.id, tag: el.tagName, txt:(el.innerText||'').trim().slice(0,40).replace(/\\n/g,' | '), h: Math.round(r.height), vis: getComputedStyle(el).display });
  }
  return JSON.stringify(out);
})()`);
fs.writeFileSync('.cdp/opciones_ids.json', list);
console.log('ids internos:', list.length);
c.close();
