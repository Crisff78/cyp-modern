import { readFileSync } from "node:fs";
const raw = JSON.parse(readFileSync("./.cdp/tour6.json", "utf8"));
const arr = Array.isArray(raw) ? raw : [];
console.log("items totales:", arr.length, "| validos:", arr.filter(Boolean).length);
arr.forEach((m, i) => {
  if (!m) { console.log(`\n=== [${i}] NULL`); return; }
  console.log(`\n=== [${i}] ${m.title || m.name || "(sin titulo)"}`);
  for (const k of Object.keys(m)) {
    if (k === "title" || k === "name") continue;
    const v = m[k];
    const s = typeof v === "string" ? v : JSON.stringify(v);
    console.log(`  ${k}: ${String(s).slice(0, 300)}`);
  }
});
