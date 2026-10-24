import type { Snapshot } from "./types";
import { currencyCode } from "./adminFinance";

export type MonitorMetrics = { collectionLimit: number; payoutLimit: number; collected: number; deposited: number; delivered: number; paid: number; difference: number };
export type MonitorLedgerRow = { entityId: string; entityType: "collector" | "route" | "zone"; name: string; metrics: MonitorMetrics; returned: number; cashOnly?: boolean };
const empty = (): MonitorMetrics => ({ collectionLimit: 0, payoutLimit: 0, collected: 0, deposited: 0, delivered: 0, paid: 0, difference: 0 });

// Each movement enters exactly one row. Cash without a client has no truthful
// route/zone attribution: keep it in a clearly labelled collector cash row.
export function monitorLedger(page: string, snapshot: Snapshot, currency = "DOP"): MonitorLedgerRow[] {
  const rows = new Map<string, MonitorLedgerRow>();
  const routeMap = new Map(snapshot.routes.map((route) => [route.id, route]));
  const clientRoutes = new Map(snapshot.clients.map((client) => [client.id, routeMap.get(client.routeId)]));
  const collectors = new Map(snapshot.collectors.map((collector) => [collector.id, collector]));
  const byCollector = page === "monitorCollectors";
  const byRoute = page === "monitorRoutes";
  const cashKey = (id: string) => `collector:${id}`;
  for (const collector of snapshot.collectors) {
    const specific = collector.currencyLimits?.[currency as "DOP" | "USD" | "EUR"];
    const row: MonitorLedgerRow = { entityId: collector.id, entityType: "collector", name: byCollector ? collector.name : `${collector.name} · Caja sin ${byRoute ? "ruta" : "zona"}`, metrics: empty(), returned: 0, cashOnly: !byCollector };
    row.metrics.collectionLimit = collector.currencyLimits ? specific?.collectionLimit ?? 0 : collector.collectionLimit;
    row.metrics.payoutLimit = collector.currencyLimits ? specific?.payoutLimit ?? 0 : collector.payoutLimit;
    rows.set(cashKey(collector.id), row);
  }
  if (!byCollector) for (const route of snapshot.routes) {
    const id = byRoute ? route.id : route.zoneId ?? route.sector;
    const name = byRoute ? route.name : snapshot.zones?.find((zone) => zone.id === route.zoneId)?.name ?? route.sector;
    const key = `${byRoute ? "route" : "zone"}:${id}`;
    if (!rows.has(key)) rows.set(key, { entityId: id, entityType: byRoute ? "route" : "zone", name: name || "Sin zona", metrics: empty(), returned: 0 });
  }
  for (const movement of snapshot.movements) {
    if (movement.cancelledAt || currencyCode(movement.currency) !== currency || !collectors.has(movement.collectorId)) continue;
    const route = movement.clientId ? clientRoutes.get(movement.clientId) : undefined;
    const clientMovement = movement.type === "collection" || movement.type === "payout";
    const key = !byCollector && route && clientMovement ? `${byRoute ? "route" : "zone"}:${byRoute ? route.id : route.zoneId ?? route.sector}` : cashKey(movement.collectorId);
    const row = rows.get(key)!;
    const field = ({ collection: "collected", payout: "paid", deposit: "deposited", office_delivery: "delivered" } as const)[movement.type];
    row.metrics[field] += movement.amount;
  }
  for (const returned of snapshot.cashReconciliations ?? []) {
    if (returned.currency !== currency) continue;
    const row = rows.get(cashKey(returned.collectorId));
    if (row) row.returned += returned.returnedCollection + returned.returnedPayout;
  }
  for (const row of rows.values()) row.metrics.difference = row.metrics.collected - row.metrics.deposited + row.metrics.delivered - row.metrics.paid - row.returned;
  return [...rows.values()].sort((a, b) => Number(Boolean(a.cashOnly)) - Number(Boolean(b.cashOnly)) || a.name.localeCompare(b.name, "es"));
}
