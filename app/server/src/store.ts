import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import pg from "pg";
import { emptyState, type State } from "./domain.js";
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
const serviceId = (name: string) =>
  `svc-${createHash("sha256").update(name).digest("hex").slice(0, 16)}`;
const zoneId = (sector: string) =>
  `zone-${createHash("sha256").update(sector).digest("hex").slice(0, 16)}`;
const collectionPointId = (clientId: string) => `cp-${clientId}`;
const clean = <T extends Record<string, unknown>>(row: T) =>
  Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== null),
  ) as T;
async function ensureUser(client: pg.PoolClient, id: string) {
  await client.query(
    `INSERT INTO users(id,name,role) VALUES($1,$2,'admin') ON CONFLICT(id) DO NOTHING`,
    [id, id],
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
       payout_limit AS "payoutLimit",lat,lng,last_seen AS "lastSeen" FROM collectors ORDER BY id`,
    )
  ).rows.map(clean);
  state.routes = (
    await client.query(
      `SELECT r.id,r.name,z.sector,r.collector_id AS "collectorId"
       FROM routes r JOIN zones z ON z.id=r.zone_id ORDER BY r.id`,
    )
  ).rows.map(clean);
  state.clients = (
    await client.query(
      `SELECT c.id,c.name,c.code,c.phone,cp.address,c.route_id AS "routeId"
       FROM clients c JOIN collection_points cp ON cp.id=c.collection_point_id ORDER BY c.id`,
    )
  ).rows.map(clean);
  state.charges = (
    await client.query(
      `SELECT ch.id,ch.client_id AS "clientId",s.name AS service,ch.amount,ch.collected,
       ch.due_date AS "dueDate",ch.required,ch.status
       FROM charges ch JOIN services s ON s.id=ch.service_id ORDER BY ch.id`,
    )
  ).rows.map(clean);
  state.payouts = (
    await client.query(
      `SELECT id,client_id AS "clientId",collector_id AS "collectorId",concept,amount,paid,status
       FROM payouts ORDER BY id`,
    )
  ).rows.map(clean);
  state.movements = (
    await client.query(
      `SELECT id,collector_id AS "collectorId",client_id AS "clientId",charge_id AS "chargeId",
        NULL::text AS "payoutId",'collection' AS type,amount,collected_at AS "createdAt",
        receipt_token AS "receiptToken",receipt_revoked AS "receiptRevoked",actor_id AS "actorId",
        NULL::timestamptz AS "acceptedAt",NULL::text AS "acceptedBy",
        NULL::timestamptz AS "cancelledAt",NULL::text AS "cancelledBy"
       FROM collections
       UNION ALL
       SELECT id,collector_id AS "collectorId",client_id AS "clientId",NULL::text AS "chargeId",
        payout_id AS "payoutId",'payout' AS type,amount,paid_at AS "createdAt",
        receipt_token AS "receiptToken",receipt_revoked AS "receiptRevoked",actor_id AS "actorId",
        NULL::timestamptz AS "acceptedAt",NULL::text AS "acceptedBy",
        NULL::timestamptz AS "cancelledAt",NULL::text AS "cancelledBy"
       FROM payments
       UNION ALL
       SELECT id,collector_id AS "collectorId",NULL::text AS "clientId",NULL::text AS "chargeId",
        NULL::text AS "payoutId",type,amount,handed_over_at AS "createdAt",
        NULL::text AS "receiptToken",NULL::boolean AS "receiptRevoked",actor_id AS "actorId",
        accepted_at AS "acceptedAt",accepted_by AS "acceptedBy",
        cancelled_at AS "cancelledAt",cancelled_by AS "cancelledBy"
       FROM cash_handovers
       ORDER BY "createdAt", id`,
    )
  ).rows.map(clean);
  state.settlements = (
    await client.query(
      `SELECT id,collector_id AS "collectorId",date,collected,deposited,
       office_delivered AS "officeDelivered",paid_to_clients AS "paidToClients",
       difference,status,closed_at AS "closedAt",actor_id AS "actorId"
       FROM daily_settlements ORDER BY date,id`,
    )
  ).rows.map(clean);
  state.idempotency = (
    await client.query(
      `SELECT id,fingerprint,response,created_at AS "createdAt" FROM idempotency ORDER BY created_at,id`,
    )
  ).rows.map(clean);
  return state;
}
async function saveState(client: pg.PoolClient, state: State, before: State) {
  for (const userId of new Set([
    ...state.movements.map((m) => m.actorId),
    ...state.settlements.map((s) => s.actorId),
  ]))
    await ensureUser(client, userId);
  for (const account of state.accounts) {
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
  for (const route of state.routes)
    await client.query(
      `INSERT INTO zones(id,name,sector) VALUES($1,$2,$3)
       ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,sector=EXCLUDED.sector`,
      [zoneId(route.sector), route.sector, route.sector],
    );
  for (const collector of state.collectors)
    await client.query(
      `INSERT INTO collectors(id,name,initials,route_id,status,collection_limit,payout_limit,lat,lng,last_seen)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,initials=EXCLUDED.initials,route_id=EXCLUDED.route_id,
       status=EXCLUDED.status,collection_limit=EXCLUDED.collection_limit,payout_limit=EXCLUDED.payout_limit,
       lat=EXCLUDED.lat,lng=EXCLUDED.lng,last_seen=EXCLUDED.last_seen`,
      [
        collector.id,
        collector.name,
        collector.initials,
        collector.routeId,
        collector.status,
        collector.collectionLimit,
        collector.payoutLimit,
        collector.lat,
        collector.lng,
        collector.lastSeen,
      ],
    );
  for (const route of state.routes)
    await client.query(
      `INSERT INTO routes(id,name,zone_id,collector_id) VALUES($1,$2,$3,$4)
       ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,zone_id=EXCLUDED.zone_id,collector_id=EXCLUDED.collector_id`,
      [route.id, route.name, zoneId(route.sector), route.collectorId],
    );
  for (const clientRow of state.clients) {
    await client.query(
      `INSERT INTO collection_points(id,route_id,address) VALUES($1,$2,$3)
       ON CONFLICT(id) DO UPDATE SET route_id=EXCLUDED.route_id,address=EXCLUDED.address`,
      [collectionPointId(clientRow.id), clientRow.routeId, clientRow.address],
    );
    await client.query(
      `INSERT INTO clients(id,name,code,phone,route_id,collection_point_id) VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,code=EXCLUDED.code,phone=EXCLUDED.phone,
       route_id=EXCLUDED.route_id,collection_point_id=EXCLUDED.collection_point_id`,
      [
        clientRow.id,
        clientRow.name,
        clientRow.code,
        clientRow.phone,
        clientRow.routeId,
        collectionPointId(clientRow.id),
      ],
    );
  }
  for (const charge of state.charges) {
    const sid = serviceId(charge.service);
    await client.query(
      `INSERT INTO services(id,name) VALUES($1,$2)
       ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name`,
      [sid, charge.service],
    );
    await client.query(
      `INSERT INTO charges(id,client_id,service_id,amount,collected,due_date,required,status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(id) DO UPDATE SET client_id=EXCLUDED.client_id,service_id=EXCLUDED.service_id,
       amount=EXCLUDED.amount,collected=EXCLUDED.collected,due_date=EXCLUDED.due_date,
       required=EXCLUDED.required,status=EXCLUDED.status`,
      [
        charge.id,
        charge.clientId,
        sid,
        charge.amount,
        charge.collected,
        charge.dueDate,
        charge.required,
        charge.status,
      ],
    );
  }
  for (const payout of state.payouts)
    await client.query(
      `INSERT INTO payouts(id,client_id,collector_id,concept,amount,paid,status)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(id) DO UPDATE SET client_id=EXCLUDED.client_id,collector_id=EXCLUDED.collector_id,
       concept=EXCLUDED.concept,amount=EXCLUDED.amount,paid=EXCLUDED.paid,status=EXCLUDED.status`,
      [
        payout.id,
        payout.clientId,
        payout.collectorId,
        payout.concept,
        payout.amount,
        payout.paid,
        payout.status,
      ],
    );
  for (const movement of state.movements) {
    const prev = before.movements.find((m) => m.id === movement.id);
    if (prev && JSON.stringify(prev) === JSON.stringify(movement)) continue;
    if (movement.type === "collection")
      await client.query(
        `INSERT INTO collections(id,collector_id,client_id,charge_id,amount,collected_at,receipt_token,receipt_revoked,actor_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
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
        ],
      );
    else if (movement.type === "payout")
      await client.query(
        `INSERT INTO payments(id,collector_id,client_id,payout_id,amount,paid_at,receipt_token,receipt_revoked,actor_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
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
        ],
      );
    else
      await client.query(
        `INSERT INTO cash_handovers(id,collector_id,type,amount,handed_over_at,actor_id,
           accepted_at,accepted_by,cancelled_at,cancelled_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT(id) DO UPDATE SET accepted_at=EXCLUDED.accepted_at,
           accepted_by=EXCLUDED.accepted_by,cancelled_at=EXCLUDED.cancelled_at,
           cancelled_by=EXCLUDED.cancelled_by`,
        [
          movement.id,
          movement.collectorId,
          movement.type,
          movement.amount,
          movement.createdAt,
          movement.actorId,
          movement.acceptedAt ?? null,
          movement.acceptedBy ?? null,
          movement.cancelledAt ?? null,
          movement.cancelledBy ?? null,
        ],
      );
  }
  for (const settlement of state.settlements)
    await client.query(
      `INSERT INTO daily_settlements(id,collector_id,date,collected,deposited,office_delivered,paid_to_clients,status,closed_at,actor_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO NOTHING`,
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
      ],
    );
  for (const row of state.idempotency) {
    const prev = before.idempotency.find((r) => r.id === row.id);
    if (prev && JSON.stringify(prev) === JSON.stringify(row)) continue;
    await client.query(
      `INSERT INTO idempotency(id,fingerprint,response,created_at) VALUES($1,$2,$3,$4)
       ON CONFLICT(id) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,response=EXCLUDED.response,created_at=EXCLUDED.created_at`,
      [row.id, row.fingerprint, JSON.stringify(row.response), row.createdAt],
    );
  }
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
