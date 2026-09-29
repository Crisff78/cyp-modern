import { businessDate, type State } from "./domain.js";

const MARKER = "__demo_seed__:collector-v2";

/** Add work for the existing demo login without changing its cash or history. */
export function enrichCollectorDemo(state: State, now = new Date()) {
  if (state.idempotency.some((row) => row.id === MARKER)) return;
  const collector = state.collectors.find((row) => row.id === "col-1" && row.active !== false);
  const route = state.routes.find((row) => row.collectorId === collector?.id && row.active !== false);
  if (!collector || !route) return;
  const prefix = "demo-v2-collector-";
  if ([...state.clients, ...state.charges, ...state.payouts, ...state.recurringCharges]
    .some((row) => row.id.startsWith(prefix)))
    throw new Error("La carga de ejemplos del cobrador tiene una colisión; no se modificaron los registros.");
  const service = state.services.find((row) => row.id === "demo-v2-service-1");
  if (!service) throw new Error("Falta el catálogo de los ejemplos del cobrador.");
  const day = (offset: number) => businessDate(new Date(now.getTime() + offset * 86_400_000));
  for (let i = 1; i <= 12; i++) {
    const serial = String(i).padStart(2, "0"), clientId = `${prefix}client-${serial}`;
    const code = `DEMO-C-${serial}`;
    if (state.clients.some((row) => row.code.toLowerCase() === code.toLowerCase()))
      throw new Error("Un código de ejemplo del cobrador ya está en uso.");
    state.clients.push({
      id: clientId, name: `Comercio de práctica ${serial}`, code, active: true,
      phone: "", cellular: "", email: `practica-${serial}@example.invalid`,
      address: `Calle de ejemplo, local ${i}`, routeId: route.id, sector: route.sector,
      alias: `Práctica ${serial}`, identification: "",
      note: "Cliente ficticio para practicar cobros y pagos. Coordenadas de demostración, sin ubicación real de cliente.",
      lat: 18.467 + i * 0.0012, lng: -69.892 - i * 0.0008,
    });
    for (let j = 0; j < 2; j++) state.charges.push({
      id: `${prefix}charge-${serial}-${j}`, clientId, serviceId: service.id, service: service.service,
      concept: j === 0 ? "Cuota de práctica" : "Servicio de práctica", currency: "DOP",
      amount: 25_000 + i * 2_500 + j * 10_000, collected: 0, dueDate: day(j === 0 ? -i % 4 : 7),
      required: i % 3 === 0 && j === 0, status: "pending", note: "Ejemplo ficticio; listo para registrar un cobro.",
    });
    state.payouts.push({ id: `${prefix}payout-${serial}`, clientId, collectorId: collector.id,
      concept: "Autorización de pago de práctica", amount: 15_000 + i * 1_000, paid: 0, status: "pending" });
    state.recurringCharges.push({ id: `${prefix}recurring-${serial}`, clientId, routeId: route.id,
      serviceId: service.id, service: service.service, registeredAt: now.toISOString(),
      startDate: day(0), endDate: day(90), frequency: "Mensual", day1: "1", day2: "",
      currency: "DOP", concept: "Cuota mensual de práctica", useConceptAmount: true,
      amount: 25_000 + i * 2_500, active: true, note: "Plantilla ficticia de demostración." });
  }
  state.idempotency.push({ id: MARKER, fingerprint: "collector-v2-additive",
    response: { version: 2, baseDate: day(0), clients: 12, charges: 24, payouts: 12, recurringCharges: 12 },
    createdAt: now.toISOString() });
}
