import fs from 'fs';
import os from 'os';
const p = os.homedir() + '/AppData/Roaming/Opera Software/Opera GX Stable/Default/Login Data';
const buf = fs.readFileSync(p);
// SQLite header: page size at offset 16 (2 bytes big endian)
const pageSize = buf.readUInt16BE(16);
const nPages = Math.floor(buf.length / pageSize);
console.log('page size:', pageSize, 'pages:', nPages);
// Recorrer cada pagina buscando la celda que contiene el realm 'gdemos'
function pageType(pg) { return buf[pg * pageSize]; }
let found = [];
for (let pg = 0; pg < nPages; pg++) {
  const base = pg * pageSize;
  const typ = buf[base];
  if (typ !== 0x0D) continue; // leaf table b-tree page
  const nCells = buf.readUInt16BE(base + 3);
  for (let c = 0; c < nCells; c++) {
    const ptr = buf.readUInt16BE(base + 8 + c * 2);
    if (ptr <= 0 || ptr >= pageSize) continue;
    // parsear record varint
    let off = base + ptr;
    const readVarint = (start) => {
      let v = 0, i = 0;
      while (i < 9) {
        const b = buf[start + i];
        if (i === 8) { v = (v << 8) | b; return { v, n: 9 }; }
        v = (v << 7) | (b & 0x7F);
        if ((b & 0x80) === 0) return { v, n: i + 1 };
        i++;
      }
      return { v, n: 9 };
    };
    const payloadLen = readVarint(off); off += payloadLen.n;
    const rowid = readVarint(off); off += rowid.n;
    const hdrStart = off;
    const hdrLen = readVarint(off); off += hdrLen.n;
    const serials = [];
    const hdrEnd = hdrStart + hdrLen.v;
    while (off < hdrEnd) { const s = readVarint(off); serials.push(s.v); off += s.n; }
    // leer valores
    const vals = [];
    for (const s of serials) {
      if (s === 0) { vals.push(null); continue; }
      if (s >= 1 && s <= 4) { const nb = s; let val = 0; for (let i=0;i<nb;i++) val = (val<<8)|buf[off++]; vals.push(val); continue; }
      if (s === 5) { const val = buf.readUInt32BE(off); off+=4; vals.push(val); off++; continue; }
      if (s === 6) { const val = Number(buf.readBigInt64BE(off)); off+=8; vals.push(val); continue; }
      if (s === 7) { vals.push(buf.readDoubleBE(off)); off+=8; continue; }
      if (s === 8) { vals.push(0); continue; }
      if (s === 9) { vals.push(1); continue; }
      if (s >= 12 && s % 2 === 0) { const len=(s-12)/2; vals.push(buf.slice(off, off+len)); off+=len; continue; }
      if (s >= 13 && s % 2 === 1) { const len=(s-13)/2; vals.push(buf.slice(off, off+len).toString('latin1')); off+=len; continue; }
    }
    // columnas de logins: origin_url, action_url, username_value, password_value(BLOB), ...
    const origin = String(vals[0]||'');
    if (origin.toLowerCase().includes('gdemos')) {
      found.push({ rowid: rowid.v, origin, action: String(vals[1]||''), username: String(vals[2]||''), pw_len: vals[3] ? vals[3].length : 0 });
    }
  }
}
console.log('ENTRADAS gdemos:', found.length);
for (const f of found) console.log(JSON.stringify(f, null, 1));
