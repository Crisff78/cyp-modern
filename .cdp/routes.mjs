import fs from 'fs';
const s = fs.readFileSync('app/server/src/app.ts','utf8');
const re = /\.(get|post|put|patch|delete)\(\s*[`'""]([^`'""]+)/g;
const m = [...s.matchAll(re)];
console.log('RUTAS ('+m.length+'):');
for (const x of m) console.log('  '+x[1].toUpperCase().padEnd(6)+' '+x[2]);