import fs from 'fs';
const s = fs.readFileSync('app/server/src/app.ts','utf8');
const lines = s.split('\n');
for (let i=0;i<lines.length;i++) {
  if (/\.(get|post|put|patch|delete)\(/.test(lines[i])) {
    console.log(String(i+1).padStart(4)+': '+lines[i].trim().slice(0,110));
  }
}