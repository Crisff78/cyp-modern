import fs from 'fs';
const s = fs.readFileSync('app/server/src/store.ts','utf8');
const m = [...s.matchAll(/(?:async\s+)?(\w+)\s*\(\s*[^)]*\)\s*[:{]/g)].map(x=>x[1]);
const uniq = [...new Set(m)].filter(n=>!['if','for','while','switch','catch','return','function','typeof'].includes(n));
console.log('IDENTIFICADORES ('+uniq.length+'):');
console.log(uniq.slice(0,80).join(', '));