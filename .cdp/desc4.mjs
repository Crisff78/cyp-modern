import fs from 'fs';
const s = fs.readFileSync('app/server/src/app.ts','utf8');
const lines = s.split('\n');
for (const i of [389,442,466,657,683,718,770,907]) {
  const ctx = lines.slice(i-1, i+4).map((l,idx)=>String(i+idx).padStart(4)+': '+l.trim().slice(0,95)).join('\n');
  console.log('----'); console.log(ctx);
}