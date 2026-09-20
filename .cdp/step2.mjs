import { findOrCreateTab, connect } from './cdp.mjs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const cdp = await connect(tab.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
const ev = await cdp.send('Runtime.evaluate', { expression: `(() => {
  const bodyTxt = document.body.innerText;
  // mapear labels: Ext usa labelFor o el label antes del campo
  const labels = [...document.querySelectorAll('label')].map(l => ({for: l.getAttribute('for')||l.getAttribute('htmlFor'), text: l.innerText.trim()}));
  const fields = ['O93_id','O9B_id','OA7_id'].map(id => {
    const el = document.getElementById(id);
    if (!el) return {id, gone:true};
    const lbl = document.querySelector('label[for="'+id+'"]');
    return {id, name: el.name, type: el.type, value: el.value ? '[SET len='+el.value.length+']' : '', label: lbl ? lbl.innerText.trim() : null};
  });
  const btns = [...document.querySelectorAll('button, input[type=button], input[type=submit]')].slice(0,8).map(b => ({id:b.id, text:(b.innerText||b.value||'').trim()}));
  return {bodyText: bodyTxt.slice(0,600), labels, fields, btns};
})()`, returnByValue: true });
console.log(JSON.stringify(ev.result?.result?.value ?? ev, null, 1));
cdp.close();
