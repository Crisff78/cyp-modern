import fs from 'fs';
const s = fs.readFileSync('app/server/src/app.ts','utf8');
const lines = s.split('\n');
for (const i of [187,571,592,616,628,638,751,776,807,838,876]) {
  const ctx = lines.slice(i-1, i+6).map((l,idx)=>String(i+idx).padStart(4)+': '+l.trim().slice(0,100)).join('\n');
  console.log('----'); console.log(ctx);
}