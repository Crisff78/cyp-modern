import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const run = async (e) => (await c.send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
const altura = async (id) => run(`(() => { const w=document.getElementById(${JSON.stringify(id)}); return w ? Math.round(w.getBoundingClientRect().height) : -1; })()`);

console.log('h O10C antes:', await altura('O10C_id'));

// intento 1: fireEvent del componente Ext
let r1 = await run(`(() => { try { const cmp = Ext.getCmp('O10C_id'); if (!cmp) return 'nocmp'; cmp.fireEvent('click', cmp); return 'ok-fire'; } catch(e) { return 'err:'+e.message; } })()`);
console.log('intento1 fireEvent:', r1);
await sleep(1500);
console.log('h O10C tras intento1:', await altura('O10C_id'));

// intento 2: dispatchEvent DOM del div
let r2 = await run(`(() => { try { const el = document.getElementById('O10C_id'); el.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window})); return 'ok-dom'; } catch(e) { return 'err:'+e.message; } })()`);
console.log('intento2 dom dispatch:', r2);
await sleep(1500);
console.log('h O10C tras intento2:', await altura('O10C_id'));

// intento 3: onclick directo
let r3 = await run(`(() => { try { const el = document.getElementById('O10C_id'); if (typeof el.onclick === 'function') { el.onclick(); return 'ok-onclick'; } return 'no-onclick-attr'; } catch(e) { return 'err:'+e.message; } })()`);
console.log('intento3 onclick:', r3);
await sleep(1200);
console.log('h O10C tras intento3:', await altura('O10C_id'));
c.close();
