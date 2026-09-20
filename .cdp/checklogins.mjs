import fs from 'fs';
import os from 'os';
const p = os.homedir() + '/AppData/Roaming/Opera Software/Opera GX Stable/Default/Login Data';
const data = fs.readFileSync(p);
const txt = data.toString('latin1');
console.log('tabla logins offset:', txt.indexOf('CREATE TABLE logins'));
for (const term of ['gdemos', 'cypdemo', 'cyp10', 'CYPServer', 'cyp']) {
  const idx = txt.toLowerCase().indexOf(term.toLowerCase());
  console.log(term, '->', idx >= 0 ? 'ENCONTRADO @' + idx : 'no');
}
