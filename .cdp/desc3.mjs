import fs from 'fs';
const s = fs.readFileSync('app/server/src/app.ts','utf8');
const lines = s.split('\n');
for (const i of [621,634]) {
  const ctx = lines.slice(i-1, i+12).map((l,idx)=>String(i+idx).padStart(4)+': '+l.trim().slice(0,100)).join('\n');
  console.log('---- linea '+i); console.log(ctx);
}