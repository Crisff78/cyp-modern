import { createHash } from "node:crypto";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seed } from "../app/server/src/seed.js";
import { buildReviewSeed } from "../app/server/scripts/seed-review.js";
import type { User } from "../app/server/src/domain.js";
import { createRemittance, openRemittanceCash, quoteRemittance } from "../app/server/src/remittances.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = resolve(root, ".local");
if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== "--candidate"))
  throw new Error("Only --candidate is supported");
const destination = resolve(directory, process.argv[2] ? "review-state-synthetic-candidate.json" : "review-state-synthetic.json");

async function main() {
await mkdir(directory, { recursive: true });
if ((await lstat(directory)).isSymbolicLink()) throw new Error("Review state directory must be local");

const now = new Date();
const state = seed();
state.collectors.forEach((collector, index) => {
  collector.name = `Prueba CyP Cobrador base ${index + 1}`;
  collector.lat = 18.47 + index * 0.01;
  collector.lng = -69.94 + index * 0.01;
});
state.routes.forEach((route, index) => {
  route.name = `Prueba CyP Ruta base ${index + 1}`;
  route.sector = "Zona sintética de revisión";
});
state.clients.forEach((client, index) => {
  client.name = `Prueba CyP Cliente base ${index + 1}`;
  client.code = `DEMO-${String(index + 1).padStart(2, "0")}`;
  client.phone = "";
  client.address = `Dirección sintética ${index + 1} · GPS de muestra`;
  client.alias = `Muestra base ${index + 1}`;
  client.sector = "GPS de muestra";
  client.cellular = "";
  client.email = "";
  client.identification = "";
  client.note = "DATOS SINTÉTICOS PRUEBA CYP. GPS de muestra.";
  client.lat = Number((18.475 + index * 0.004).toFixed(6));
  client.lng = Number((-69.945 + index * 0.003).toFixed(6));
});
state.charges.forEach((charge) => {
  charge.service = "Prueba CyP servicio base";
  charge.concept = "Cobro sintético de revisión";
  charge.note = "DATOS SINTÉTICOS PRUEBA CYP.";
});
state.payouts.forEach((payout) => {
  payout.concept = "Prueba CyP pago base sintético";
});

const { summary } = buildReviewSeed(state, {
  apply: false,
  adminId: "configured-admin",
  withReviewAdmin: false,
  expectedDatabase: "cyp",
}, now);
if (summary.status !== "DRY_RUN" || state.clients.some((client) =>
  client.identification || client.phone || client.cellular || client.email ||
  !client.name.startsWith("Prueba CyP") || !client.note?.includes("SINTÉTICOS") ||
  !Number.isFinite(client.lat) || !Number.isFinite(client.lng)
)) throw new Error("Review state is not fully synthetic");

// A pending transfer visible to the built-in collector, generated from fixed
// synthetic inputs through the same domain rules as the application.
const admin: User = { id: "demo-admin", name: "Prueba CyP Administración", role: "admin" };
const collector: User = { id: "demo-collector", name: "Prueba CyP Cobrador", role: "collector", collectorId: "col-1" };
const sample = { sourceCurrency: "DOP", destinationCurrency: "DOP", amount: 50000, commissionBps: 200 } as const;
const note = "DATOS SINTÉTICOS PRUEBA CYP. Envío pendiente para el cobrador de muestra.";
const quote = quoteRemittance(state, sample, now);
openRemittanceCash(state, admin, { operatorId: collector.id, currency: "DOP", openingAmount: 0 }, [collector], now);
createRemittance(state, admin, {
  ...sample, senderClientId: "cli-1", recipientClientId: "cli-2",
  sendingUserId: collector.id, quote: quote.quote, note,
}, [collector], now);

const contents = JSON.stringify(state);
await writeFile(destination, contents, { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({
  status: "CREATED",
  file: destination,
  sha256: createHash("sha256").update(contents).digest("hex"),
  counts: {
    clients: state.clients.length,
    collectors: state.collectors.length,
    routes: state.routes.length,
    charges: state.charges.length,
    remittances: state.remittances.transfers.length,
  },
}));
}

main().catch(() => {
  console.error(JSON.stringify({ status: "FAILED", code: "REVIEW_STATE_NOT_CREATED" }));
  process.exitCode = 1;
});
