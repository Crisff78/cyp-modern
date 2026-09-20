import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const run = async (e) => (await c.send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
const hCuerpo = async () => run(`(() => { const w=document.getElementById('O12A_id'); return w?Math.round(w.getBoundingClientRect().height):-1; })()`);

const info = await run(`(() => {
  const out = {};
  try {
    const cmp = Ext.getCmp('O10C_id');
    out.O10C = cmp ? { xtype: cmp.xtype, events: Object.keys(cmp.events||{}).slice(0,20), hasClick: !!(cmp.events&&cmp.events.click) } : 'nocmp';
  } catch(e) { out.O10C = 'err:'+e.message; }
  try {
    const cmp2 = Ext.getCmp('O12A_id');
    out.O12A = cmp2 ? { xtype: cmp2.xtype, collapsed: cmp2.collapsed, h: cmp2.height } : 'nocmp';
  } catch(e) { out.O12A = 'err:'+e.message; }
  return JSON.stringify(out);
})()`);
console.log('INFO EXT:', info);

// metodo A: fireEvent click en cabecera
await run(`(() => { try { Ext.getCmp('O10C_id').fireEvent('click', Ext.getCmp('O10C_id')); return 1; } catch(e) { return 0; } })()`);
await sleep(1200);
console.log('h O12A tras fireEvent cabecera:', await hCuerpo());

// metodo B: expand directo si el panel soporta
const rB = await run(`(() => { try { const cmp = Ext.getCmp('O12A_id'); if (cmp.expand) { cmp.expand(); return 'expanded'; } return 'no-expand-method'; } catch(e) { return 'err:'+e.message; } })()`);
console.log('metodo B:', rB);
await sleep(800);
console.log('h O12A tras expand:', await hCuerpo());
c.close();
