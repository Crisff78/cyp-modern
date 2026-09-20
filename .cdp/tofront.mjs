import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const run = async (e) => { const rr = await c.send('Runtime.evaluate', { expression: e, returnByValue: true }); return rr.result?.result?.value; };

const z = await run(`(() => {
  const m = document.getElementById('OBF_id'); const mon = document.getElementById('O22A_id');
  return JSON.stringify({ menu: m?.style.zIndex, mon: mon?.style.zIndex });
})()`);
console.log('z antes:', z);
await run(`(() => { try { Ext.getCmp('OBF_id').toFront(); return 'tofront-ok'; } catch(e) { return 'err:'+e.message; } })()`);
await sleep(600);
const z2 = await run(`(() => {
  const m = document.getElementById('OBF_id'); const mon = document.getElementById('O22A_id');
  return JSON.stringify({ menu: m?.style.zIndex, mon: mon?.style.zIndex });
})()`);
console.log('z despues:', z2);

// ahora intentar desplegar Cobros
const hC = await run(`(() => { const w=document.getElementById('O12A_id'); return w?Math.round(w.getBoundingClientRect().height):-1; })()`);
console.log('h cuerpo Cobros antes:', hC);
const L = await run(`(() => { const el=document.getElementById('O10C_id_td'); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`);
console.log('coord cabecera Cobros:', JSON.stringify(L));
await c.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:L.x, y:L.y });
await sleep(300);
await c.send('Input.dispatchMouseEvent', { type:'mousePressed', x:L.x, y:L.y, button:'left', clickCount:1 });
await c.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:L.x, y:L.y, button:'left', clickCount:1 });
await sleep(2000);
const hC2 = await run(`(() => { const w=document.getElementById('O12A_id'); return w?Math.round(w.getBoundingClientRect().height):-1; })()`);
console.log('h cuerpo Cobros despues de clic:', hC2);
c.close();
