import type pg from "pg";
import type { State } from "./domain.js";

export const frequencyCodes: Record<string, string> = {
  "No Definida": "undefined", Diaria: "daily", Bidiaria: "every_other_day", Semanal: "weekly",
  Quincenal: "fortnightly", Mensual: "monthly", Trimestral: "quarterly", Cuatrimestral: "four_monthly",
  Semestal: "semiannual", Semestral: "semiannual", Anual: "yearly",
};
const frequencyLabels = Object.fromEntries(Object.entries(frequencyCodes).map(([label, code]) => [code, label]));
export async function readCatalogs(client: pg.PoolClient, state: State) {
  state.zones = (await client.query(`SELECT id,name,sector,number,range_from AS "from",range_to AS "to",active FROM zones ORDER BY name,id`)).rows;
  state.services = (await client.query(`SELECT id,name AS service,abbreviation AS abbr,caption,required_by_default AS obligated,
    fixed_amount AS "fixedAmount",status='active' AS active FROM services ORDER BY name,id`)).rows;
  state.delayReasons = (await client.query(`SELECT id,name AS reason,status='active' AS active FROM delay_reasons ORDER BY name,id`)).rows;
  state.recurringCharges = (await client.query(`SELECT rc.id,coalesce(rc.client_id,'') AS "clientId",rc.route_id AS "routeId",
    rc.service_id AS "serviceId",rc.created_at AS "registeredAt",coalesce(rc.start_date,rc.next_run_date)::text AS "startDate",
    coalesce(rc.end_date::text,'') AS "endDate",rc.frequency,rc.day1,rc.day2,rc.currency,s.name AS service,rc.concept,
    rc.fixed_amount AS "useConceptAmount",rc.amount,rc.note,rc.status='active' AS active
    FROM recurring_charges rc JOIN services s ON s.id=rc.service_id ORDER BY rc.created_at,rc.id`)).rows.map((r) => ({
      ...r, routeId: r.routeId ?? undefined, registeredAt: r.registeredAt instanceof Date ? r.registeredAt.toISOString() : r.registeredAt,
      frequency: frequencyLabels[r.frequency] ?? r.frequency,
    }));
}
export async function saveCatalogMasters(client: pg.PoolClient, state: State, before: State) {
  for (const zone of state.zones) {
    if (JSON.stringify(before.zones.find((z) => z.id === zone.id)) === JSON.stringify(zone)) continue;
    await client.query(`INSERT INTO zones(id,name,sector,number,range_from,range_to,active) VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,sector=EXCLUDED.sector,number=EXCLUDED.number,range_from=EXCLUDED.range_from,range_to=EXCLUDED.range_to,active=EXCLUDED.active`,
      [zone.id,zone.name,zone.sector,zone.number ?? "",zone.from ?? "",zone.to ?? "",zone.active !== false]);
  }
  for (const service of state.services) {
    if (JSON.stringify(before.services.find((s) => s.id === service.id)) === JSON.stringify(service)) continue;
    await client.query(`INSERT INTO services(id,name,abbreviation,caption,required_by_default,fixed_amount,status) VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,abbreviation=EXCLUDED.abbreviation,caption=EXCLUDED.caption,
      required_by_default=EXCLUDED.required_by_default,fixed_amount=EXCLUDED.fixed_amount,status=EXCLUDED.status`,
      [service.id,service.service,service.abbr,service.caption,service.obligated,service.fixedAmount,service.active ? "active" : "archived"]);
  }
  for (const reason of state.delayReasons) {
    if (JSON.stringify(before.delayReasons.find((r) => r.id === reason.id)) === JSON.stringify(reason)) continue;
    await client.query(`INSERT INTO delay_reasons(id,name,status) VALUES($1,$2,$3)
      ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,status=EXCLUDED.status`, [reason.id,reason.reason,reason.active ? "active" : "archived"]);
  }
}
export async function saveRecurringCharges(client: pg.PoolClient, state: State, before: State, resolveService: (name: string, preferredId?: string) => Promise<string>) {
  for (const row of state.recurringCharges) {
    if (JSON.stringify(before.recurringCharges.find((r) => r.id === row.id)) === JSON.stringify(row)) continue;
    const serviceId = await resolveService(row.service, row.serviceId);
    const routeId = state.clients.find((c) => c.id === row.clientId)?.routeId ?? row.routeId ?? null;
    await client.query(`INSERT INTO recurring_charges(id,service_id,route_id,client_id,amount,required,fixed_amount,frequency,
      next_run_date,status,created_at,start_date,end_date,day1,day2,currency,concept,note)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT(id) DO UPDATE SET service_id=EXCLUDED.service_id,route_id=EXCLUDED.route_id,client_id=EXCLUDED.client_id,
      amount=EXCLUDED.amount,fixed_amount=EXCLUDED.fixed_amount,frequency=EXCLUDED.frequency,next_run_date=EXCLUDED.next_run_date,
      status=EXCLUDED.status,start_date=EXCLUDED.start_date,end_date=EXCLUDED.end_date,day1=EXCLUDED.day1,day2=EXCLUDED.day2,
      currency=EXCLUDED.currency,concept=EXCLUDED.concept,note=EXCLUDED.note`,
      [row.id,serviceId,routeId,row.clientId || null,row.amount,false,row.useConceptAmount,
        frequencyCodes[row.frequency] ?? row.frequency,row.startDate,row.active ? "active" : "paused",row.registeredAt,
        row.startDate,row.endDate || null,row.day1,row.day2,row.currency,row.concept,row.note]);
  }
}
