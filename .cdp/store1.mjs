import fs from 'fs';
const s = fs.readFileSync('app/server/src/store.ts','utf8');
// buscar nombres de entidades y operaciones
const ents = [...s.matchAll(/export (?:async )?function (\w+)/g)].map(x=>x[1]);
console.log('FUNCIONES STORE ('+ents.length+'):');
console.log(ents.join(', '));