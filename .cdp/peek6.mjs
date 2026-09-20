import { readFileSync, writeFileSync } from "node:fs";
const raw = JSON.parse(readFileSync("./.cdp/tour6.json", "utf8"));
console.log("Clientes:", JSON.stringify(raw["Clientes"], null, 1).slice(0, 2500));
