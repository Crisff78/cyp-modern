import { findOrCreateTab, connect } from './cdp.mjs';

const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
await c.send('Page.enable');

const r = await c.send('Runtime.evaluate', {
  expression: `(() => {
    const ins = [...document.querySelectorAll('input')].map(i => ({
      id: i.id, name: i.name, type: i.type,
      visible: i.offsetParent !== null,
      w: i.clientWidth, h: i.clientHeight,
      x: Math.round(i.getBoundingClientRect().x),
      y: Math.round(i.getBoundingClientRect().y),
      val: (i.value||'').slice(0,20)
    }));
    const btns = [...document.querySelectorAll('button,input[type=button],input[type=submit],a')].slice(0,10).map(b => ({
      tag: b.tagName, id: b.id, txt: (b.textContent||b.value||'').trim().slice(0,20),
      x: Math.round(b.getBoundingClientRect().x), y: Math.round(b.getBoundingClientRect().y)
    }));
    return JSON.stringify({inputs: ins, btns, title: document.title}, null, 1);
  })()`,
  returnByValue: true
});
console.log(r.result?.value || JSON.stringify(r));
c.close();
