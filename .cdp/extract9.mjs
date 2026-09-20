import { readFileSync, writeFileSync } from "node:fs";
const raw = JSON.parse(readFileSync("./.cdp/tour9.json", "utf8"));
let out = "";
for (const [nombre, m] of Object.entries(raw)) {
  out += `\n======== ${nombre} ========\n`;
  if (!m) { out += "  NULL\n"; continue; }
  if (m.err) { out += `  ERR: ${m.err} ${m.hay ? "(hay:" + m.hay + ")" : ""} expandio:${m.expandio}\n`; continue; }
  out += `  ventana: ${m.title}\n`;
  if (m.grids) for (const g of m.grids) {
    out += `  grid cols: ${g.cols.join(", ")} | filas: ${g.rows}\n`;
    for (const row of g.rowsTxt.slice(0, 3)) out += `     > ${row.join(" | ").slice(0,140)}\n`;
  }
  if (m.labels && m.labels.length) out += `  labels: ${m.labels.join(" | ")}\n`;
  if (m.btns && m.btns.length) out += `  botones: ${[...new Set(m.btns)].join(", ")}\n`;
  if (m.tabs && m.tabs.length) out += `  tabs: ${m.tabs.join(", ")}\n`;
  if (m.toolbars && m.toolbars.length) out += `  toolbars: ${m.toolbars.join(" ;; ")}\n`;
  if (m.combos && m.combos.length) for (const cm of m.combos) out += `  combo: ${cm.sel} <- ${cm.opts.join("/")}\n`;
  if (m.red && m.red.length) {
    out += `  red: ${m.red.length} peticiones\n`;
    for (const r of m.red.slice(0, 5)) {
      out += `    REQ: ${(r.postData || r.id || "").slice(0, 180)}\n`;
      if (r.respStatus) out += `    RESP ${r.respStatus}: ${(r.respBody || "").replace(/\s+/g," ").slice(0, 240)}\n`;
    }
  }
}
writeFileSync(".cdp/extract9.txt", out);
console.log(out);
