import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
await c.send('Page.enable');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const run = async (e) => { const rr = await c.send('Runtime.evaluate', { expression: e, returnByValue: true }); return rr.result?.result?.value; };

await c.send('Page.reload', {}, 30000);
await sleep(4000);
const txt = await run(`(() => (document.body.innerText||'').slice(0,120))()`);
console.log('tras reload:', JSON.stringify(txt));

// comprobar si los campos tienen valores (autofill de Opera)
const f = await run(`(() => {
  const u = document.getElementById('O93_id');
  const p = document.getElementById('O9B_id');
  return JSON.stringify({ u: u ? (u.value.length>0) : 'no-field', p: p ? (p.value.length>0) : 'no-field' });
})()`);
console.log('campos rellenos:', f);

// clic en Ok (mismas coords aproximadas del boton Ok, relocalizar)
const L = await run(`(() => { const el=document.getElementById('O87_id'); if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`);
console.log('coord Ok:', JSON.stringify(L));
if (L) {
  await c.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:L.x, y:L.y });
  await sleep(250);
  await c.send('Input.dispatchMouseEvent', { type:'mousePressed', x:L.x, y:L.y, button:'left', clickCount:1 });
  await c.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:L.x, y:L.y, button:'left', clickCount:1 });
  await sleep(6000);
}
const final = await run(`(() => (document.body.innerText||'').slice(0,200))()`);
console.log('FINAL:', JSON.stringify(final));
c.close();
