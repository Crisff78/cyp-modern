import fs from 'fs';
const s = fs.readFileSync('app/server/src/app.ts','utf8');
const lines = s.split('\n');
for (let i=0;i<lines.length;i++) {
  const l = lines[i];
  if (/^(\s*)describe\(/.test(l) || /MAP_|const (paths|operations)/.test(l)) {
    // tomar la linea y la siguiente para capturar el path
    const ctx = (l.trim() + ' ' + (lines[i+1]||'').trim()).slice(0,140);
    console.log(String(i+1).padStart(4)+': '+ctx);
  }
}