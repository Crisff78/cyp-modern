import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import pg from "pg";
import { DomainError, emptyState, type State } from "./domain.js";
import { readRemittances, saveRemittances } from "./remittance-store.js";
import { readAdminTools, saveAdminTools } from "./admin-tools-store.js";
import { readCatalogs, saveCatalogMasters, saveRecurringCharges } from "./catalog-store.js";
pg.types.setTypeParser(20, Number);
export interface Store {
  read(): Promise<State>;
  transaction<T>(fn: (s: State) => T | Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export class MemoryStore implements Store {
  protected state: State;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(initial: State = emptyState()) {
    this.state = structuredClone(initial);
  }
  async read() {
    await this.tail;
    return structuredClone(this.state);
  }
  protected async persist(_state: State) {}
  transaction<T>(fn: (s: State) => T | Promise<T>): Promise<T> {
    const work = this.tail.then(async () => {
      const draft = structuredClone(this.state);
      const result = await fn(draft);
      await this.persist(draft);
      this.state = draft;
      return result;
    });
    this.tail = work.catch(() => {});
    return work;
  }
  async close() {
    await this.tail;
  }
}
export class FileStore extends MemoryStore {
  private constructor(
    private path: string,
    initial: State,
  ) {
    super(initial);
  }
  static async open(path: string, initial: State) {
    let data = initial;
    try {
      // Fields added after the first release are absent in older files;
      // emptyState() keeps the missing collections defined.
      data = { ...emptyState(), ...JSON.parse(await readFile(path, "utf8")) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const store = new FileStore(path, data);
    await store.persist(data);
    return store;
  }
  protected async persist(state: State) {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(`${this.path}.tmp`, JSON.stringify(state), { mode: 0o600 });
    await rename(`${this.path}.tmp`, this.path);
  }
}
const collectionPointId = (clientId: string) => `cp-${clientId}`;
const clean = <T extends Record<string, unknown>>(row: T) =>
  Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== null)
      .map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
  ) as T;
const unchanged = (before: { id: string }[], row: { id: string }) =>
  JSON.stringify(before.find((old) => old.id === row.id)) === JSON.stringify(row);
async function ensureUser(client: pg.PoolClient, id: string, state: State) {
  // Provisioned users are saved with their actual role below. Audit-only IDs
  // must never silently become administrative accounts.
  if (state.accounts.some((account) => account.id === id)) return;
  const role = id === "configured-admin" || id === "demo-admin" ? "admin" : id === "demo-collector" ? "collector" : undefined;
  if (!role) {
    if ((await client.query("SELECT 1 FROM users WHERE id=$1", [id])).rowCount) return;
    throw new DomainError("AUDIT_ACTOR_MISSING", "El usuario de auditoría debe existir antes de registrar movimientos.", 409);
  }
  await client.query(
    `INSERT INTO users(id,name,role,collector_id) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING`,
    [id, id, role, role === "collector" ? "col-1" : null],
  );
}
async function readState(client: pg.PoolClient): Promise<State> {
  const state = emptyState();
  state.accounts = (
    await client.query(
      `SELECT id,name,email,role,collector_id AS "collectorId",salt,password_hash AS "passwordHash",
       credential_version AS "credentialVersion",status,created_at AS "createdAt",updated_at AS "updatedAt"
       FROM users WHERE email IS NOT NULL ORDER BY created_at,id`,
    )
  ).rows.map(clean);
  state.collectors = (
    await client.query(
      `SELECT id,name,initials,route_id AS "routeId",status,collection_limit AS "collectionLimit",
       payout_limit AS "payoutLimit",lat,lng,last_seen AS "lastSeen",active,ident,cellular,account_code AS "accountId" FROM collectors ORDER BY id`,
    )
  ).rows.map((row) => ({ ...clean(row), lat: row.lat ?? null, lng: row.lng ?? null }));
  state.routes = (
    await client.query(
      `SELECT r.id,r.name,z.sector,r.zone_id AS "zoneId",r.collector_id AS "collectorId",r.number,r.range_from AS "from",r.range_to AS "to",r.active
       FROM routes r JOIN zones z ON z.id=r.zone_id ORDER BY r.id`,
    )
  ).rows.map(clean);
  state.clients = (
    await client.query(
      `SELECT c.id,c.name,c.code,c.phone,cp.address,c.route_id AS "routeId",c.collection_point_id AS "collectionPointId",
       c.alias,c.sector,c.cellular,c.email,c.note,c.identification,c.lat,c.lng,c.active
       FROM clients c JOIN collection_points cp ON cp.id=c.collection_point_id ORDER BY c.id`,
    )
  ).rows.map(clean);
  state.clientMachines = (
    await client.query(
      `SELECT id,client_id AS "clientId",number,entry,exit,
       currency_value AS value,percentage,registered_at AS "registeredAt",updated_at AS "updatedAt"
       FROM client_machines ORDER BY client_id,number`,
    )
  ).rows.map((row) => ({ ...clean(row), value: Number(row.value), percentage: Number(row.percentage) }));
  state.clientMachineLogs = (
    await client.query(
      `SELECT id,client_id AS "clientId",machine_id AS "machineId",
       registered_at AS "registeredAt",previous_entry AS "previousEntry",entry,
       entry_difference AS "entryDifference",previous_exit AS "previousExit",exit,
       exit_difference AS "exitDifference",difference,currency,amount,percentage,charge,
       modified_at AS "modifiedAt",cancelled_at AS "cancelledAt"
       FROM client_machine_logs ORDER BY registered_at DESC,id`,
    )
  ).rows.map((row) => ({ ...clean(row), amount: Number(row.amount), percentage: Number(row.percentage), charge: Number(row.charge) }));
  state.charges = (
    await client.query(
      `SELECT ch.id,ch.client_id AS "clientId",ch.service_id AS "serviceId",s.name AS service,ch.concept,ch.currency,ch.note,ch.amount,ch.collected,ch.cancel_reason AS "cancelReason",
       ch.due_date::text AS "dueDate",ch.required,ch.status
       FROM charges ch JOIN services s ON s.id=ch.service_id ORDER BY ch.id`,
    )
  ).rows.map(clean);
  state.payouts = (
    await client.query(
      `SELECT id,client_id AS "clientId",collector_id AS "collectorId",concept,amount,paid,status,currency,due_date::text AS "dueDate"
       FROM payouts ORDER BY id`,
    )
  ).rows.map(clean);
  state.movements = (
    await client.query(
      `SELECT id,collector_id AS "collectorId",client_id AS "clientId",charge_id AS "chargeId",
        NULL::text AS "payoutId",'collection' AS type,amount,currency,NULL::text AS note,collected_at AS "createdAt",
        receipt_token AS "receiptToken",receipt_revoked AS "receiptRevoked",actor_id AS "actorId",
        registered_centrally AS "registeredCentrally",
        NULL::timestamptz AS "acceptedAt",NULL::text AS "acceptedBy",
        NULL::timestamptz AS "cancelledAt",NULL::text AS "cancelledBy",
        NULL::jsonb AS "denominations"
       FROM collections
       UNION ALL
       SELECT id,collector_id AS "collectorId",client_id AS "clientId",NULL::text AS "chargeId",
        payout_id AS "payoutId",'payout' AS type,amount,currency,NULL::text AS note,paid_at AS "createdAt",
        receipt_token AS "receiptToken",receipt_revoked AS "receiptRevoked",actor_id AS "actorId",
        registered_centrally AS "registeredCentrally",
        NULL::timestamptz AS "acceptedAt",NULL::text AS "acceptedBy",
        NULL::timestamptz AS "cancelledAt",NULL::text AS "cancelledBy",
        NULL::jsonb AS "denominations"
       FROM payments
       UNION ALL
       SELECT id,collector_id AS "collectorId",NULL::text AS "clientId",NULL::text AS "chargeId",
        NULL::text AS "payoutId",type,amount,currency,note,handed_over_at AS "createdAt",
        NULL::text AS "receiptToken",NULL::boolean AS "receiptRevoked",actor_id AS "actorId",
        NULL::boolean AS "registeredCentrally",
        accepted_at AS "acceptedAt",accepted_by AS "acceptedBy",
        cancelled_at AS "cancelledAt",cancelled_by AS "cancelledBy",
        denominations AS "denominations"
       FROM cash_handovers
       ORDER BY "createdAt", id`,
    )
  ).rows.map(clean);
  state.settlements = (
    await client.query(
      `SELECT id,collector_id AS "collectorId",date::text,collected,deposited,
       office_delivered AS "officeDelivered",paid_to_clients AS "paidToClients",
       difference,status,closed_at AS "closedAt",actor_id AS "actorId",totals_by_currency AS "totalsByCurrency"
       FROM daily_settlements ORDER BY date,id`,
    )
  ).rows.map(clean);
  state.payoutRecurring = (
    await client.query(
      `SELECT id,client_id AS "clientId",concept,amount,currency,frequency,
       next_run_date::text AS "nextRunDate",status,created_at AS "createdAt"
       FROM recurring_payouts ORDER BY created_at, id`,
    )
  ).rows.map(clean);
  const configRow = (
    await client.query(`SELECT data FROM system_config WHERE id = 'default'`)
  ).rows[0];
  state.systemConfig = configRow
    ? (configRow.data as Record<string, unknown>)
    : undefined;
  state.depositEvents = (
    await client.query(
      `SELECT id,movement_id AS "movementId",action,actor_id AS "actorId",
       denominations,created_at AS "createdAt"
       FROM deposit_lifecycle ORDER BY created_at, id`,
    )
  ).rows.map(clean);
  for (const ev of state.depositEvents) {
    const m = state.movements.find((x) => x.id === ev.movementId);
    if (!m) continue;
    if (ev.action === "accepted") {
      m.acceptedAt = ev.createdAt;
      m.acceptedBy = ev.actorId;
      if (ev.denominations) m.denominations = ev.denominations;
    } else {
      m.cancelledAt = ev.createdAt;
      m.cancelledBy = ev.actorId;
    }
  }
  state.movementCancellations = (
    await client.query(
      `SELECT id,movement_id AS "movementId",movement_type AS "movementType",reason,
       actor_id AS "actorId",created_at AS "createdAt" FROM movement_cancellations ORDER BY created_at,id`,
    )
  ).rows.map(clean);
  for (const event of state.movementCancellations) {
    const movement = state.movements.find((item) => item.id === event.movementId && item.type === event.movementType);
    if (!movement) throw new DomainError("MOVEMENT_CANCELLATION_ORPHAN", "La anulación no tiene un movimiento válido.", 409);
    movement.cancelledAt = event.createdAt;
    movement.cancelledBy = event.actorId;
    movement.cancellationNote = event.reason;
  }
  state.idempotency = (
    await client.query(
      `SELECT id,fingerprint,response,created_at AS "createdAt" FROM idempotency ORDER BY created_at,id`,
    )
  ).rows.map(clean);
  state.remittances = await readRemittances(client);
  await readCatalogs(client, state);
  state.adminTools = await readAdminTools(client);
  return state;
}
async function saveState(client: pg.PoolClient, state: State, before: State) {
  for (const userId of new Set([
    ...state.movements.map((m) => m.actorId),
    ...state.depositEvents.map((event) => event.actorId),
    ...state.movementCancellations.map((event) => event.actorId),
    ...state.settlements.map((s) => s.actorId),
    ...state.remittances.transfers.flatMap((t) => [t.sendingUserId, t.registeredBy]),
    ...state.remittances.cashSessions.flatMap((c) => [c.operatorId, c.openedBy]),
    ...state.remittances.events.map((event) => event.actorId),
  ]))
    await ensureUser(client, userId, state);
  for (const account of state.accounts) {
    if (unchanged(before.accounts, account)) continue;
    const updatedAt = account.updatedAt || account.createdAt;
    await client.query(
      `INSERT INTO users(id,name,email,role,collector_id,salt,password_hash,credential_version,status,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,role=EXCLUDED.role,
       collector_id=EXCLUDED.collector_id,salt=EXCLUDED.salt,password_hash=EXCLUDED.password_hash,
       credential_version=EXCLUDED.credential_version,status=EXCLUDED.status,updated_at=EXCLUDED.updated_at`,
      [
        account.id,
        account.name,
        account.email,
        account.role,
        account.collectorId ?? null,
        account.salt,
        account.passwordHash,
        account.credentialVersion,
        account.status,
        account.createdAt,
        updatedAt,
      ],
    );
  }
  await saveCatalogMasters(client, state, before);
  const routeZones = new Map<string, string>();
  for (const route of state.routes) {
    if (unchanged(before.routes, route)) continue;
    if (route.zoneId) { routeZones.set(route.id, route.zoneId); continue; }
    const matching = (await client.query("SELECT id FROM zones WHERE name=$1 OR sector=$1 ORDER BY (name=$1) DESC,id LIMIT 1", [route.sector])).rows[0];
    if (matching) routeZones.set(route.id, matching.id);
    else {
      const inserted = await client.query(`INSERT INTO zones(id,name,sector) VALUES($1,$2,$2) RETURNING id`, [randomUUID(),route.sector]);
      routeZones.set(route.id, inserted.rows[0].id);
    }
  }
  for (const collector of state.collectors) {
    if (unchanged(before.collectors, collector)) continue;
    await client.query(
      `INSERT INTO collectors(id,name,initials,route_id,status,collection_limit,payout_limit,lat,lng,last_seen,active,ident,cellular,account_code)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,initials=EXCLUDED.initials,route_id=EXCLUDED.route_id,
       status=EXCLUDED.status,collection_limit=EXCLUDED.collection_limit,payout_limit=EXCLUDED.payout_limit,
       lat=EXCLUDED.lat,lng=EXCLUDED.lng,last_seen=EXCLUDED.last_seen,active=EXCLUDED.active,
       ident=EXCLUDED.ident,cellular=EXCLUDED.cellular,account_code=EXCLUDED.account_code`,
      [
        collector.id,
        collector.name,
        collector.initials,
        collector.routeId,
        collector.status,
        collector.collectionLimit,
        collector.payoutLimit,
        collector.lat ?? null,
        collector.lng ?? null,
        collector.lastSeen,
        collector.active !== false,
        collector.ident ?? "",
        collector.cellular ?? "",
        collector.accountId ?? "",
      ],
    );
  }
  for (const route of state.routes) {
    if (unchanged(before.routes, route)) continue;
    await client.query(
      `INSERT INTO routes(id,name,zone_id,collector_id,number,range_from,range_to,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,zone_id=EXCLUDED.zone_id,collector_id=EXCLUDED.collector_id,
       number=EXCLUDED.number,range_from=EXCLUDED.range_from,range_to=EXCLUDED.range_to,active=EXCLUDED.active`,
      [route.id, route.name, routeZones.get(route.id), route.collectorId,route.number ?? "",route.from ?? "",route.to ?? "",route.active !== false],
    );
  }
  for (const clientRow of state.clients) {
    if (unchanged(before.clients, clientRow)) continue;
    const pointId = clientRow.collectionPointId ?? before.clients.find((c) => c.id === clientRow.id)?.collectionPointId ?? collectionPointId(clientRow.id);
    await client.query(
      `INSERT INTO collection_points(id,route_id,address) VALUES($1,$2,$3)
       ON CONFLICT(id) DO UPDATE SET route_id=EXCLUDED.route_id,address=EXCLUDED.address`,
      [pointId, clientRow.routeId, clientRow.address],
    );
    await client.query(
      `INSERT INTO clients(id,name,code,phone,route_id,collection_point_id,alias,sector,cellular,email,note,identification,lat,lng,active)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,code=EXCLUDED.code,phone=EXCLUDED.phone,
       route_id=EXCLUDED.route_id,collection_point_id=EXCLUDED.collection_point_id,
       alias=EXCLUDED.alias,sector=EXCLUDED.sector,cellular=EXCLUDED.cellular,
       email=EXCLUDED.email,note=EXCLUDED.note,identification=EXCLUDED.identification,
       lat=EXCLUDED.lat,lng=EXCLUDED.lng,active=EXCLUDED.active`,
      [
        clientRow.id,
        clientRow.name,
        clientRow.code,
        clientRow.phone,
        clientRow.routeId,
        pointId,
        clientRow.alias ?? "",
        clientRow.sector ?? "",
        clientRow.cellular ?? "",
        clientRow.email ?? "",
        clientRow.note ?? "",
        clientRow.identification ?? "",
        clientRow.lat ?? null,
        clientRow.lng ?? null,
        clientRow.active !== false,
      ],
    );
  }
  for (const machine of state.clientMachines) {
    const previous = before.clientMachines.find((item) => item.id === machine.id);
    if (previous && JSON.stringify(previous) === JSON.stringify(machine)) continue;
    await client.query(
      `INSERT INTO client_machines(id,client_id,number,entry,exit,currency_value,percentage,registered_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(id) DO UPDATE SET number=EXCLUDED.number,entry=EXCLUDED.entry,exit=EXCLUDED.exit,
       currency_value=EXCLUDED.currency_value,percentage=EXCLUDED.percentage,updated_at=EXCLUDED.updated_at`,
      [machine.id,machine.clientId,machine.number,machine.entry,machine.exit,machine.value,machine.percentage,machine.registeredAt,machine.updatedAt],
    );
  }
  for (const log of state.clientMachineLogs) {
    const previous = before.clientMachineLogs.find((item) => item.id === log.id);
    if (previous && JSON.stringify(previous) === JSON.stringify(log)) continue;
    await client.query(
      `INSERT INTO client_machine_logs(id,client_id,machine_id,registered_at,previous_entry,entry,entry_difference,
       previous_exit,exit,exit_difference,difference,currency,amount,percentage,charge,modified_at,cancelled_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT(id) DO NOTHING`,
      [log.id,log.clientId,log.machineId,log.registeredAt,log.previousEntry,log.entry,log.entryDifference,
       log.previousExit,log.exit,log.exitDifference,log.difference,log.currency,log.amount,log.percentage,
       log.charge,log.modifiedAt ?? null,log.cancelledAt ?? null],
    );
  }
  const resolveService = async (name: string, preferredId?: string) => {
    if (preferredId) {
      const existing = await client.query("SELECT id FROM services WHERE id=$1 AND name=$2", [preferredId,name]);
      if (existing.rowCount) return existing.rows[0].id as string;
    }
    const existingByName = await client.query("SELECT id FROM services WHERE name=$1", [name]);
    if (existingByName.rowCount) return existingByName.rows[0].id as string;
    const result = await client.query(
      `INSERT INTO services(id,name) VALUES($1,$2) RETURNING id`,
      [randomUUID(), name],
    );
    return result.rows[0].id as string;
  };
  for (const charge of state.charges) {
    if (unchanged(before.charges, charge)) continue;
    const sid = await resolveService(charge.service, charge.serviceId);
    await client.query(
      `INSERT INTO charges(id,client_id,service_id,concept,currency,note,amount,collected,due_date,required,status,cancel_reason)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT(id) DO UPDATE SET client_id=EXCLUDED.client_id,service_id=EXCLUDED.service_id,
       concept=EXCLUDED.concept,currency=EXCLUDED.currency,note=EXCLUDED.note,
       amount=EXCLUDED.amount,collected=EXCLUDED.collected,due_date=EXCLUDED.due_date,
       required=EXCLUDED.required,status=EXCLUDED.status,cancel_reason=EXCLUDED.cancel_reason`,
      [
        charge.id,
        charge.clientId,
        sid,
        charge.concept ?? "",
        charge.currency ?? "Peso Dominicano",
        charge.note ?? "",
        charge.amount,
        charge.collected,
        charge.dueDate,
        charge.required,
        charge.status,
        charge.cancelReason ?? "",
      ],
    );
  }
  for (const payout of state.payouts) {
    if (unchanged(before.payouts, payout)) continue;
    await client.query(
      `INSERT INTO payouts(id,client_id,collector_id,concept,amount,paid,status,currency,due_date)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(id) DO UPDATE SET client_id=EXCLUDED.client_id,collector_id=EXCLUDED.collector_id,
       concept=EXCLUDED.concept,amount=EXCLUDED.amount,paid=EXCLUDED.paid,status=EXCLUDED.status,currency=EXCLUDED.currency,due_date=EXCLUDED.due_date`,
      [
        payout.id,
        payout.clientId,
        payout.collectorId,
        payout.concept,
        payout.amount,
        payout.paid,
        payout.status,
        payout.currency ?? "DOP",
        payout.dueDate ?? null,
      ],
    );
  }
  for (const movement of state.movements) {
    const prev = before.movements.find((m) => m.id === movement.id);
    if (prev) {
      // Lifecycle fields are projections of append-only events. Only explicit
      // receipt revocation may update the original receipted ledger rows.
      if (prev.receiptRevoked !== movement.receiptRevoked && (movement.type === "collection" || movement.type === "payout")) {
        const table = movement.type === "collection" ? "collections" : "payments";
        await client.query(`UPDATE ${table} SET receipt_revoked=$2 WHERE id=$1`, [movement.id, movement.receiptRevoked ?? false]);
      }
      continue;
    }
    if (movement.type === "collection")
      await client.query(
        `INSERT INTO collections(id,collector_id,client_id,charge_id,amount,collected_at,receipt_token,receipt_revoked,actor_id,registered_centrally,currency)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT(id) DO UPDATE SET receipt_revoked=EXCLUDED.receipt_revoked`,
        [
          movement.id,
          movement.collectorId,
          movement.clientId,
          movement.chargeId,
          movement.amount,
          movement.createdAt,
          movement.receiptToken,
          movement.receiptRevoked ?? false,
          movement.actorId,
          movement.registeredCentrally ?? null,
          movement.currency ?? "DOP",
        ],
      );
    else if (movement.type === "payout")
      await client.query(
        `INSERT INTO payments(id,collector_id,client_id,payout_id,amount,paid_at,receipt_token,receipt_revoked,actor_id,registered_centrally,currency)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT(id) DO UPDATE SET receipt_revoked=EXCLUDED.receipt_revoked`,
        [
          movement.id,
          movement.collectorId,
          movement.clientId,
          movement.payoutId,
          movement.amount,
          movement.createdAt,
          movement.receiptToken,
          movement.receiptRevoked ?? false,
          movement.actorId,
          movement.registeredCentrally ?? null,
          movement.currency ?? "DOP",
        ],
      );
    else
      await client.query(
        `INSERT INTO cash_handovers(id,collector_id,type,amount,handed_over_at,actor_id,currency,note,denominations)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING`,
        [
          movement.id,
          movement.collectorId,
          movement.type,
          movement.amount,
          movement.createdAt,
          movement.actorId,
          movement.currency ?? "DOP",
          movement.note ?? null,
          movement.denominations ? JSON.stringify(movement.denominations) : null,
        ],
      );
  }
  for (const settlement of state.settlements) {
    if (unchanged(before.settlements, settlement)) continue;
    await client.query(
      `INSERT INTO daily_settlements(id,collector_id,date,collected,deposited,office_delivered,paid_to_clients,status,closed_at,actor_id,totals_by_currency)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO NOTHING`,
      [
        settlement.id,
        settlement.collectorId,
        settlement.date,
        settlement.collected,
        settlement.deposited,
        settlement.officeDelivered,
        settlement.paidToClients,
        settlement.status,
        settlement.closedAt,
        settlement.actorId,
        settlement.totalsByCurrency ? JSON.stringify(settlement.totalsByCurrency) : null,
      ],
    );
  }
  await saveRecurringCharges(client, state, before, resolveService);
  for (const template of state.payoutRecurring) {
    const prev = before.payoutRecurring.find((r) => r.id === template.id);
    if (prev && JSON.stringify(prev) === JSON.stringify(template)) continue;
    await client.query(
      `INSERT INTO recurring_payouts(id,client_id,concept,amount,frequency,next_run_date,status,created_at,currency)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(id) DO UPDATE SET concept=EXCLUDED.concept,amount=EXCLUDED.amount,
         frequency=EXCLUDED.frequency,next_run_date=EXCLUDED.next_run_date,status=EXCLUDED.status,currency=EXCLUDED.currency`,
      [
        template.id,
        template.clientId,
        template.concept,
        template.amount,
        template.frequency,
        template.nextRunDate,
        template.status,
        template.createdAt,
        template.currency ?? "DOP",
      ],
    );
  }
  if (state.systemConfig) {
    const prevConfig = before.systemConfig;
    if (JSON.stringify(prevConfig) !== JSON.stringify(state.systemConfig))
      await client.query(
        `INSERT INTO system_config(id, data, updated_at) VALUES('default', $1, now())
         ON CONFLICT(id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [JSON.stringify(state.systemConfig)],
      );
  }
  for (const ev of state.depositEvents) {
    const prev = before.depositEvents.find((r) => r.id === ev.id);
    if (prev && JSON.stringify(prev) === JSON.stringify(ev)) continue;
    await client.query(
      `INSERT INTO deposit_lifecycle(id,movement_id,action,actor_id,denominations,created_at)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING`,
      [
        ev.id,
        ev.movementId,
        ev.action,
        ev.actorId,
        ev.denominations ? JSON.stringify(ev.denominations) : null,
        ev.createdAt,
      ],
    );
  }
  await saveRemittances(client, state.remittances, before.remittances);
  for (const event of state.movementCancellations) {
    if (before.movementCancellations.some((item) => item.id === event.id)) continue;
    await client.query(
      `INSERT INTO movement_cancellations(id,movement_id,movement_type,reason,actor_id,created_at)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [event.id, event.movementId, event.movementType, event.reason, event.actorId, event.createdAt],
    );
  }
  for (const row of state.idempotency) {
    const prev = before.idempotency.find((r) => r.id === row.id);
    if (prev && JSON.stringify(prev) === JSON.stringify(row)) continue;
    await client.query(
      `INSERT INTO idempotency(id,fingerprint,response,created_at) VALUES($1,$2,$3,$4)
       ON CONFLICT(id) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,response=EXCLUDED.response,created_at=EXCLUDED.created_at`,
      [row.id, row.fingerprint, JSON.stringify(row.response), row.createdAt],
    );
  }
  await saveAdminTools(client, state, before);
}
export class PostgresStore implements Store {
  private pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 8 });
  }
  async read() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const state = await readState(client);
      await client.query("COMMIT");
      return state;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async transaction<T>(fn: (s: State) => T | Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(7341920)");
      await client.query("SET CONSTRAINTS ALL DEFERRED");
      const before = await readState(client),
        draft = structuredClone(before);
      const result = await fn(draft);
      await saveState(client, draft, before);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}
