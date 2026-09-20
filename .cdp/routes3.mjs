import fs from 'fs';
const s = fs.readFileSync('app/server/src/app.ts','utf8');
const lines = s.split('\n');
// mostrar bloques de registro con su path y preHandler
for (let i=0;i<lines.length;i++) {
  const l = lines[i];
  if (/path\s*=/.test(l) || /\.(get|post|put|patch|delete)\(\s*$/.test(l) || /\.(get|post|put|patch|delete)\(\s*["'`]/.test(l) || /preHandler/.test(l) || /schema\s*:/.test(l)) {
    console.log(String(i+1).padStart(4)+': '+l.trim().slice(0,120));
  }
}