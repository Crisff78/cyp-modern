import { readFileSync } from "node:fs";
const raw = JSON.parse(readFileSync("./.cdp/tour7.json", "utf8"));
for (const [nombre, m] of Object.entries(raw)) {
  console.log(`\n======== ${nombre} ========`);
  if (!m) { console.log("  NULL"); continue; }
  if (m.err) { console.log("  ERR:", m.err, m.hay ? "(hay:" + m.hay + ")" : ""); continue; }
  console.log("  ventana:", m.title, "| z:", m.z, m.stale ? "| [STALE]" : "");
  if (m.grids) for (const g of m.grids) console.log("  grid cols:", g.cols.join(", "), "| filas:", g.rows);
  if (m.labels && m.labels.length) console.log("  labels:", m.labels.join(" | "));
  if (m.btns && m.btns.length) console.log("  botones:", [...new Set(m.btns)].join(", "));
  if (m.tabs && m.tabs.length) console.log("  tabs:", m.tabs.join(", "));
  if (m.toolbars && m.toolbars.length) console.log("  toolbars:", m.toolbars.join(" ;; "));
  if (m.combos && m.combos.length) for (const cm of m.combos) console.log("  combo:", cm.sel, "<-", cm.opts.join("/"));
  if (m.red && m.red.length) {
    console.log(`  red: ${m.red.length} peticiones`);
    for (const r of m.red.slice(0, 4)) {
      console.log("    REQ:", (r.postData || r.id || "").slice(0, 160));
      if (r.respStatus) console.log("    RESP", r.respStatus, ":", (r.respBody || "").replace(/\s+/g, " ").slice(0, 220));
    }
  }
}
