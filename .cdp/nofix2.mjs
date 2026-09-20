import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const run = async (e) => (await c.send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

const step1 = await run(`(() => {
  try {
    const cmp = Ext.getCmp('ext-comp-1039');
    if (!cmp) return 'no-cmp-1039';
    cmp.fireEvent('click', cmp);
    return 'fired-1039';
  } catch(e) { return 'err:'+e.message; }
})()`);
console.log('STEP1 fireEvent No:', step1);
await sleep(1500);
let vis = await run(`(() => { const w=document.getElementById('ext-comp-1042'); return w ? getComputedStyle(w).display : 'gone'; })()`);
console.log('visible tras fireEvent:', vis);

if (vis !== 'none' && vis !== 'gone') {
  const step2 = await run(`(() => { try { Ext.MessageBox.hide(); return 'mb-hidden'; } catch(e) { return 'err:'+e.message; } })()`);
  console.log('STEP2 MessageBox.hide:', step2);
  await sleep(800);
  vis = await run(`(() => { const w=document.getElementById('ext-comp-1042'); return w ? getComputedStyle(w).display : 'gone'; })()`);
  console.log('visible tras hide:', vis);
}

const final = await run(`(() => {
  const wins = [...document.querySelectorAll('.x-window')].filter(w=>getComputedStyle(w).display!=='none')
    .map(w=>({t:(w.querySelector('.x-window-header-text')?.innerText||'').trim(), z:w.style.zIndex, id:w.id}))
    .filter(x=>x.t);
  return JSON.stringify({logueado:(document.body.innerText||'').includes('Usuario: Administrador'), wins});
})()`);
console.log('FINAL:', final);
c.close();
