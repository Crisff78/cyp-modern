import { readFileSync } from "node:fs";
const raw = JSON.parse(readFileSync("./.cdp/tour10.json", "utf8"));
for (const [k, v] of Object.entries(raw)) console.log(k, "->", JSON.stringify(v).slice(0, 300));
