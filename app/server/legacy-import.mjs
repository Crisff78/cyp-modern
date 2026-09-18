import pg from "pg";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const dry = !process.argv.includes("--write");
if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL");
const data = JSON.parse(
  readFileSync(new URL("../../legacy/database/clients_extract.json", import.meta.url), "utf-8"),
);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const clean = (v) => (v ?? "").toString().trim();
const slug = (s) =>
  clean(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const ZONE = "legacy-import-zone";
const ROUTE = "legacy-import-route";
const COLLECTOR = "legacy-import-collector";

const plan = [];
const taken = new Set();
let sinCodigo = 0;
for (const c of data.clients) {
  const legacyId = clean(c.legacy_id);
  const name = clean(c.name) || `Cliente ${legacyId}`;
  let code = clean(c.legacy_code);
  if (!code) code = "LEG-" + (slug(legacyId) || `sincodigo${++sinCodigo}`);
  const base = code;
  let n = 2;
  while (taken.has(code)) code = `${base}-${n++}`;
  taken.add(code);
  plan.push({
    id: "cl-" + slug(code),
    pointId: "cp-" + slug(code),
    code,
    name,
    phone: clean(c.phone) || clean(c.cell),
    address: clean(c.address) || "Sin direccion (importado legacy)",
    sector: clean(c.sector),
    alias: clean(c.alias),
    note: clean(c.note),
    email: clean(c.email),
    legacyId,
    legacyCode: clean(c.legacy_code),
  });
}

const stats = {
  total: plan.length,
  conCodigoLegacy: plan.filter((p) => p.legacyCode).length,
  sinCodigoLegacy: plan.filter((p) => !p.legacyCode).length,
  conTelefono: plan.filter((p) => p.phone).length,
  conDireccion: plan.filter((p) => clean(p.address) !== "Sin direccion (importado legacy)").length,
  conEmail: plan.filter((p) => p.email).length,
  codigoAjustadoPorDuplicado: plan.filter((p) => /-\d+$/.test(p.code) && p.legacyCode).length,
};

if (dry) {
  console.log("=== DRY RUN (no se escribe nada; --write para aplicar) ===");
  console.log(`origen: ${data.source}`);
  console.log(`extracto: ${data.count} clientes -> plan: ${plan.length}`);
  console.log("stats:", JSON.stringify(stats, null, 1));
  for (const p of plan)
    console.log(
      `  ${p.code.padEnd(14)} ${p.name.padEnd(28)} tel=${(p.phone || "-").padEnd(16)} dir=${p.address.slice(0, 46)}`,
    );
  await pool.end();
  process.exit(0);
}

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(
    `INSERT INTO zones(id,name,sector) VALUES($1,$2,$3)
     ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name, sector=EXCLUDED.sector`,
    [ZONE, "Zona importacion legacy", "Legacy"],
  );
  await client.query(
    `INSERT INTO collectors(id,name,initials,route_id,status,collection_limit,payout_limit,lat,lng,last_seen)
     VALUES($1,$2,$3,$4,'active',1000000000,1000000000,0,0,now())
     ON CONFLICT(id) DO NOTHING`,
    [COLLECTOR, "Cobrador importacion legacy", "IL", ROUTE],
  );
  await client.query(
    `INSERT INTO routes(id,name,zone_id,collector_id) VALUES($1,$2,$3,$4)
     ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name, zone_id=EXCLUDED.zone_id, collector_id=EXCLUDED.collector_id`,
    [ROUTE, "Ruta importacion legacy", ZONE, COLLECTOR],
  );
  let insertados = 0,
    actualizados = 0;
  for (const p of plan) {
    await client.query(
      `INSERT INTO collection_points(id,route_id,address,notes) VALUES($1,$2,$3,$4)
       ON CONFLICT(id) DO UPDATE SET route_id=EXCLUDED.route_id, address=EXCLUDED.address`,
      [p.pointId, ROUTE, p.address, `Importado de ${basename(data.source)}`],
    );
    const r = await client.query(
      `INSERT INTO clients(id,name,code,phone,route_id,collection_point_id)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name, code=EXCLUDED.code, phone=EXCLUDED.phone,
         route_id=EXCLUDED.route_id, collection_point_id=EXCLUDED.collection_point_id
       RETURNING (xmax = 0) AS inserted`,
      [p.id, p.name, p.code, p.phone || "", ROUTE, p.pointId],
    );
    if (r.rows[0].inserted) insertados++;
    else actualizados++;
  }
  await client.query("COMMIT");
  console.log(
    `IMPORT OK: ${insertados} insertados, ${actualizados} actualizados de ${plan.length} (zona/ruta/cobrador semilla idempotentes)`,
  );
} catch (e) {
  await client.query("ROLLBACK");
  console.error("IMPORT FALLIDO:", e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
