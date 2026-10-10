import {
  acceptDeposit, businessDate, cancelDeposit, cancelMovement, closeDay, DomainError,
  emptyState, postMovement, preview, type Charge, type Movement, type Payout,
  type State, type User,
} from "./domain.js";
import { fillDemoCatalogs } from "./demo-catalog-scenarios.js";
import {
  cancelRemittance, cashBalance, closeRemittanceCash, createRemittance, getCommissionPolicy,
  openRemittanceCash, payRemittance, quoteRemittance, setDailyRate, type Currency,
} from "./remittances.js";

const version = "public-v2";
const markerId = "__demo_seed__:public-v2";
const prefix = "demo-v2-";
const admin: User = { id: "demo-admin", name: "Administración", role: "admin" };
const fictionalNote = "DATOS FICTICIOS DE DEMOSTRACIÓN V2. No corresponde a una operación real.";

type Omission = { date: string; reason: "existing_cash_session" | "existing_open_cash" | "incompatible_existing_rate" };
type Manifest = {
  version: typeof version;
  baseDate: string;
  counts: Record<string, number>;
  omittedRemittanceDates: Omission[];
};

function dateAt(baseDate: string, offset: number) {
  const date = new Date(`${baseDate}T16:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return businessDate(date);
}
// Explicit -04:00 keeps synthetic business days independent of the server timezone.
const instant = (date: string, hour: number, minute = 0) => new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000-04:00`);
const fixtureId = (name: string) => `${prefix}${name}`;

function createPeople(state: State, now: Date) {
  const labels = ["Norte", "Centro", "Sur"];
  for (let index = 0; index < 3; index++) {
    const number = index + 1;
    state.collectors.push({
      id: fixtureId(`col-${number}`), name: `DEMO V2 · Cobrador ${labels[index]}`,
      initials: `D${number}`, routeId: fixtureId(`route-${number}`),
      status: index === 1 ? "offline" : "active", active: true,
      collectionLimit: 2_500_000, payoutLimit: 1_000_000,
      lat: 18.47 + index * .014, lng: -69.95 + index * .017,
      lastSeen: new Date(now.getTime() - (index === 1 ? 7_200_000 : 0)).toISOString(),
      ident: `DV2-CO-${number}`, cellular: "", accountId: `DEMO-V2-${number}`,
    });
    state.routes.push({
      id: fixtureId(`route-${number}`), name: `DEMO V2 · Ruta ${labels[index]}`,
      sector: `DEMO V2 · Sector ${number}`, zoneId: fixtureId(`zone-${number}`),
      collectorId: fixtureId(`col-${number}`), number: `DV2-R${number}`,
      from: String(index * 8 + 1), to: String(number * 8), active: true,
    });
    for (let local = 0; local < 8; local++) {
      const serial = index * 8 + local + 1;
      const suffix = String(serial).padStart(2, "0");
      state.clients.push({
        id: fixtureId(`client-${suffix}`), code: `DV2-${String(serial).padStart(3, "0")}`,
        name: `DEMO V2 · Comercio ficticio ${suffix}`, alias: `Ejemplo ${suffix}`,
        phone: "", cellular: "", email: "", identification: `FICTICIO-V2-${suffix}`,
        address: `Calle ficticia ${number}, local de prueba ${local + 1}`,
        routeId: fixtureId(`route-${number}`), sector: `DEMO V2 · Sector ${number}`,
        active: true, note: `${fictionalNote} Ubicación simulada para el mapa.`,
        lat: 18.47 + index * .014 + local * .001, lng: -69.95 + index * .017 + local * .001,
      });
    }
  }
}

function addCharge(state: State, id: string, clientId: string, amount: number, dueDate: string, serviceIndex: number, currency = "DOP", cancelled = false) {
  const activeServices = state.services.filter((row) => row.active);
  const service = activeServices[serviceIndex % activeServices.length];
  if (!service) throw new Error("Faltan servicios para los escenarios ficticios.");
  const charge: Charge = {
    id: fixtureId(`charge-${id}`), clientId, serviceId: service.id, service: service.service,
    concept: `DEMO V2 · ${cancelled ? "Cargo anulado" : "Cargo de ejemplo"}`,
    currency, note: fictionalNote, amount, collected: 0, dueDate,
    required: serviceIndex % 2 === 0, status: cancelled ? "cancelled" : "pending",
    ...(cancelled ? { cancelReason: "Anulación ficticia antes de recibir pagos" } : {}),
  };
  state.charges.push(charge);
  return charge;
}

function addPayout(state: State, id: string, clientId: string, collectorId: string, amount: number, cancelled = false) {
  const row: Payout = {
    id: fixtureId(`payout-${id}`), clientId, collectorId, amount, paid: 0,
    concept: `DEMO V2 · ${cancelled ? "Autorización anulada" : "Pago autorizado de ejemplo"}`,
    status: cancelled ? "cancelled" : "pending",
  };
  state.payouts.push(row);
  return row;
}

function depositLifecycle(state: State, movement: Movement, action: "accepted" | "cancelled", now: Date) {
  if (action === "accepted") acceptDeposit(state, admin, movement.id, [{ denominacion: 100, cantidad: movement.amount / 100 }]);
  else cancelDeposit(state, admin, movement.id);
  // The public domain functions timestamp deposit events themselves. Only adjust
  // this newly constructed fixture event, before it has ever reached a store.
  const event = state.depositEvents.at(-1)!;
  event.createdAt = now.toISOString();
  if (action === "accepted") movement.acceptedAt = event.createdAt;
  else movement.cancelledAt = event.createdAt;
}

function fillCollections(state: State, baseDate: string, now: Date) {
  const at = (date: string, hour: number, minute = 0) => new Date(Math.min(instant(date, hour, minute).getTime(), now.getTime()));
  for (let offset = -6; offset < 0; offset++) {
    const date = dateAt(baseDate, offset);
    for (let index = 0; index < 3; index++) {
      const collectorId = fixtureId(`col-${index + 1}`);
      const client = state.clients[index * 8 + offset + 6];
      const charge = addCharge(state, `history-${index}-${date}`, client.id, 70_000 + index * 15_000 + (offset + 6) * 5_000, date, index);
      const payout = addPayout(state, `history-${index}-${date}`, client.id, collectorId, 30_000 + index * 10_000 + (offset + 6) * 2_000);
      postMovement(state, admin, "collection", { chargeId: charge.id, amount: charge.amount }, at(date, 9));
      const deposit = postMovement(state, admin, "deposit", { collectorId, amount: charge.amount }, at(date, 11));
      depositLifecycle(state, deposit, "accepted", at(date, 11, 15));
      postMovement(state, admin, "office_delivery", { collectorId, amount: payout.amount }, at(date, 12));
      postMovement(state, admin, "payout", { payoutId: payout.id, amount: payout.amount }, at(date, 13));
      closeDay(state, admin, collectorId, date, at(date, 17));
    }
  }
  for (let index = 0; index < 3; index++) {
    const multiplier = index + 1;
    const collectorId = fixtureId(`col-${multiplier}`);
    const clients = state.clients.slice(index * 8, index * 8 + 8);
    const paid = addCharge(state, `today-${index}-paid`, clients[0].id, 125_000 * multiplier, baseDate, index);
    const partial = addCharge(state, `today-${index}-partial`, clients[1].id, 180_000 * multiplier, baseDate, index + 1);
    addCharge(state, `today-${index}-overdue`, clients[2].id, 250_000 * multiplier, dateAt(baseDate, -3), index + 2);
    addCharge(state, `today-${index}-future`, clients[3].id, 90_000 * multiplier, dateAt(baseDate, 7), index);
    addCharge(state, `today-${index}-cancelled`, clients[4].id, 110_000 * multiplier, baseDate, index + 1, "DOP", true);
    const reversed = addCharge(state, `today-${index}-reversed`, clients[5].id, 70_000 * multiplier, baseDate, index + 2);
    addCharge(state, `today-${index}-usd`, clients[6].id, 50_000, baseDate, index, "USD");
    addCharge(state, `today-${index}-eur`, clients[7].id, 20_000, baseDate, index + 1, "EUR");

    postMovement(state, admin, "collection", { chargeId: paid.id, amount: paid.amount }, at(baseDate, 8));
    postMovement(state, admin, "collection", { chargeId: partial.id, amount: 60_000 * multiplier }, at(baseDate, 8, 10));
    const reversedCollection = postMovement(state, admin, "collection", { chargeId: reversed.id, amount: 30_000 * multiplier }, at(baseDate, 8, 20));
    cancelMovement(state, admin, reversedCollection.id, "collection", "DEMO V2 · Cobro anulado como ejemplo", at(baseDate, 8, 25));
    const accepted = postMovement(state, admin, "deposit", { collectorId, amount: 50_000 * multiplier }, at(baseDate, 9));
    depositLifecycle(state, accepted, "accepted", at(baseDate, 9, 5));
    postMovement(state, admin, "deposit", { collectorId, amount: 25_000 * multiplier }, at(baseDate, 9, 10));
    const cancelledDeposit = postMovement(state, admin, "deposit", { collectorId, amount: 10_000 * multiplier }, at(baseDate, 9, 20));
    depositLifecycle(state, cancelledDeposit, "cancelled", at(baseDate, 9, 25));

    const partialPayout = addPayout(state, `today-${index}-partial`, clients[1].id, collectorId, 100_000 * multiplier);
    const paidPayout = addPayout(state, `today-${index}-paid`, clients[2].id, collectorId, 40_000 * multiplier);
    const reversedPayout = addPayout(state, `today-${index}-reversed`, clients[3].id, collectorId, 50_000 * multiplier);
    addPayout(state, `today-${index}-cancelled`, clients[4].id, collectorId, 25_000 * multiplier, true);
    postMovement(state, admin, "office_delivery", { collectorId, amount: partialPayout.amount }, at(baseDate, 10));
    postMovement(state, admin, "payout", { payoutId: partialPayout.id, amount: 40_000 * multiplier }, at(baseDate, 10, 10));
    postMovement(state, admin, "office_delivery", { collectorId, amount: paidPayout.amount }, at(baseDate, 10, 20));
    postMovement(state, admin, "payout", { payoutId: paidPayout.id, amount: paidPayout.amount }, at(baseDate, 10, 30));
    const reversedDelivery = postMovement(state, admin, "office_delivery", { collectorId, amount: 20_000 * multiplier }, at(baseDate, 10, 40));
    const payment = postMovement(state, admin, "payout", { payoutId: reversedPayout.id, amount: reversedDelivery.amount }, at(baseDate, 10, 45));
    cancelMovement(state, admin, payment.id, "payout", "DEMO V2 · Pago anulado como ejemplo", at(baseDate, 10, 50));
    cancelMovement(state, admin, reversedDelivery.id, "office_delivery", "DEMO V2 · Entrega anulada como ejemplo", at(baseDate, 10, 55));
    // Include one closed day today and another open day ready to close at zero.
    if (index === 0 || index === 2) {
      const balance = preview(state, collectorId, baseDate);
      const finalDeposit = postMovement(state, admin, "deposit", { collectorId, amount: balance.collected - balance.deposited }, at(baseDate, 11));
      depositLifecycle(state, finalDeposit, "accepted", at(baseDate, 11, 5));
      postMovement(state, admin, "payout", { payoutId: partialPayout.id, amount: partialPayout.amount - partialPayout.paid }, at(baseDate, 11, 10));
      if (index === 0) closeDay(state, admin, collectorId, baseDate, at(baseDate, 11, 15));
    }
  }
}

function fillTransfers(fixture: State, existing: State, baseDate: string, now: Date): Omission[] {
  const omitted: Omission[] = [];
  const currencies: Currency[] = ["USD", "DOP", "EUR"];
  const at = (date: string, hour: number, minute = 0) => new Date(Math.min(instant(date, hour, minute).getTime(), now.getTime()));
  const collectorClients = existing.collectors.some((row) => row.id === "col-1" && row.active !== false)
    ? existing.clients.filter((client) => client.active !== false && existing.routes.some((route) => route.id === client.routeId && route.collectorId === "col-1" && route.active !== false))
    : [];
  for (let offset = -5; offset <= 0; offset++) {
    const date = dateAt(baseDate, offset);
    if (existing.remittances.cashSessions.some((cash) => cash.operatorId === admin.id && cash.date === date)) {
      omitted.push({ date, reason: "existing_cash_session" }); continue;
    }
    if (offset === 0 && existing.remittances.cashSessions.some((cash) => cash.operatorId === admin.id && cash.status === "open")) {
      omitted.push({ date, reason: "existing_open_cash" }); continue;
    }
    // Work on another private draft so incompatible user-entered rates can skip
    // only this date, without leaving partially constructed cash sessions.
    const draft = structuredClone(fixture);
    const borrowedRates = new Set<string>();
    for (const currency of ["USD", "EUR"] as const) {
      const saved = existing.remittances.rates.find((rate) => rate.currency === currency && rate.date === date);
      if (saved) { draft.remittances.rates.push(structuredClone(saved)); borrowedRates.add(saved.id); }
      else setDailyRate(draft, admin, { currency, rate: currency === "USD" ? "59.000000" : "64.000000", date }, at(date, 7));
    }
    try {
      for (const currency of currencies) openRemittanceCash(draft, admin, {
        operatorId: admin.id, currency, openingAmount: currency === "DOP" ? 2_000_000 : 200_000,
      }, [], at(date, 7, 15));
      for (let index = 0; index < 3; index++) {
        const sourceCurrency = currencies[(index + offset + 6) % 3];
        const destinationCurrency = currencies[(index + offset + 7) % 3];
        const quoteInput = { sourceCurrency, destinationCurrency, amount: sourceCurrency === "DOP" ? 180_000 : 12_000 };
        const createdAt = at(date, 9 + index);
        const quote = quoteRemittance(draft, quoteInput, createdAt).quote;
        // Supply existing transfers only as numbering context. The domain owns
        // sequence/reference generation; existing objects are never modified.
        const numbering = { ...draft, clients: [...draft.clients, ...collectorClients], remittances: { ...draft.remittances, transfers: [...existing.remittances.transfers, ...draft.remittances.transfers] } };
        const result = createRemittance(numbering, admin, {
          ...quoteInput, quote,
          senderClientId: index === 0 && collectorClients.length ? collectorClients[(offset + 5) % collectorClients.length].id : draft.clients[(offset + 5) * 3 + index].id,
          recipientClientId: index === 1 && collectorClients.length ? collectorClients[(offset + 5) % collectorClients.length].id : draft.clients[((offset + 5) * 3 + index + 8) % 24].id,
          note: fictionalNote,
        }, [], createdAt);
        draft.remittances.transfers.push(numbering.remittances.transfers.find((transfer) => transfer.id === result.id)!);
        if (index === 0) payRemittance(draft, admin, result.id, at(date, 12, 15));
        if (index === 2) cancelRemittance(draft, admin, result.id, "DEMO V2 · Cancelación ficticia solicitada", at(date, 13, 20));
      }
      if (offset < 0) for (const cash of draft.remittances.cashSessions.filter((row) => row.date === date))
        closeRemittanceCash(draft, admin, cash.id, cashBalance(draft, cash).expected, at(date, 17));
      draft.remittances.rates = draft.remittances.rates.filter((rate) => !borrowedRates.has(rate.id));
      fixture.remittances = draft.remittances;
    } catch (error) {
      if (error instanceof DomainError && ["MONEY_RANGE", "AMOUNT_TOO_SMALL", "INSUFFICIENT_CASH", "INVALID_RATE"].includes(error.code)) {
        omitted.push({ date, reason: "incompatible_existing_rate" }); continue;
      }
      throw error;
    }
  }
  return omitted;
}

type Identified = { id: string };
function noCollision<T>(label: string, current: readonly T[], incoming: readonly T[], key: (row: T) => string) {
  const seen = new Set(current.map(key).filter(Boolean));
  for (const row of incoming) {
    const identity = key(row);
    if (!identity) continue;
    if (seen.has(identity)) throw new Error(`No se añadió la demo V2: colisión en ${label}.`);
    seen.add(identity);
  }
}

function validateAndAppend(state: State, fixture: State) {
  const batches: Array<{ name: string; current: Identified[]; incoming: Identified[] }> = [
    ...(["collectors", "routes", "zones", "clients", "services", "delayReasons", "accounts", "charges", "payouts", "movements", "settlements", "depositEvents", "movementCancellations", "recurringCharges", "payoutRecurring", "clientMachines", "clientMachineLogs"] as const)
      .map((name) => ({ name, current: state[name], incoming: fixture[name] })),
    ...(["rates", "transfers", "cashSessions", "events"] as const)
      .map((name) => ({ name: `remittances.${name}`, current: state.remittances[name], incoming: fixture.remittances[name] })),
    ...(["stations", "pcpGroups", "pcps", "sessions", "authorizationRequests", "traces"] as const)
      .map((name) => ({ name: `adminTools.${name}`, current: state.adminTools[name], incoming: fixture.adminTools[name] })),
  ];
  for (const batch of batches) noCollision(batch.name, batch.current, batch.incoming, (row) => row.id);
  noCollision("códigos de clientes", state.clients, fixture.clients, (row) => row.code);
  noCollision("puntos de cobro", state.clients, fixture.clients, (row) => row.collectionPointId || `cp-${row.id}`);
  noCollision("zonas", state.zones, fixture.zones, (row) => row.name.toLowerCase());
  noCollision("servicios", state.services, fixture.services, (row) => row.service.toLowerCase());
  noCollision("motivos", state.delayReasons, fixture.delayReasons, (row) => row.reason.toLowerCase());
  noCollision("correos de cuentas", state.accounts, fixture.accounts, (row) => row.email.toLowerCase());
  noCollision("máquinas", state.clientMachines, fixture.clientMachines, (row) => JSON.stringify([row.clientId, row.number]));
  noCollision("cuadres", state.settlements, fixture.settlements, (row) => JSON.stringify([row.collectorId, row.date]));
  noCollision("recibos", state.movements, fixture.movements, (row) => row.receiptToken ?? "");
  noCollision("tasas", state.remittances.rates, fixture.remittances.rates, (row) => JSON.stringify([row.currency, row.date]));
  noCollision("cajas", state.remittances.cashSessions, fixture.remittances.cashSessions, (row) => JSON.stringify([row.operatorId, row.currency, row.date]));
  for (const field of ["sequence", "envioReference", "reciboReference", "operatingCode"] as const)
    noCollision(`envíos.${field}`, state.remittances.transfers, fixture.remittances.transfers, (row) => String(row[field]));
  noCollision("grupos PCP", state.adminTools.pcpGroups, fixture.adminTools.pcpGroups, (row) => row.name.toLowerCase());
  noCollision("números PCP", state.adminTools.pcps, fixture.adminTools.pcps, (row) => row.number.toLowerCase());
  for (const field of ["number", "name", "deviceId"] as const)
    noCollision(`estaciones.${field}`, state.adminTools.stations, fixture.adminTools.stations, (row) => row[field].toLowerCase());
  noCollision("asociaciones PCP", state.adminTools.pcpStations, fixture.adminTools.pcpStations, (row) => JSON.stringify([row.pcpId, row.stationId]));
  // All collision checks finish before the first append. Existing rows and array
  // entries retain their values, including any user-edited original demo data.
  for (const batch of batches) batch.current.push(...batch.incoming);
  state.adminTools.pcpStations.push(...fixture.adminTools.pcpStations);
}

/** Called only by the explicitly enabled public-demo startup, inside Store.transaction. */
export function enrichPublicDemo(state: State, now = new Date()) {
  if (state.idempotency.some((row) => row.id === markerId)) return;
  const baseDate = businessDate(now);
  const fixture = emptyState();
  // Quotes use the current policy on a private fixture; the saved policy is not appended or changed.
  fixture.remittances.commissionPolicy = getCommissionPolicy(state);
  createPeople(fixture, now);
  fillDemoCatalogs(fixture, now);
  fillCollections(fixture, baseDate, now);
  const omittedRemittanceDates = fillTransfers(fixture, state, baseDate, now);
  const counts: Record<string, number> = {};
  for (const [name, rows] of Object.entries(fixture)) if (Array.isArray(rows)) counts[name] = rows.length;
  for (const [name, rows] of Object.entries(fixture.remittances)) if (Array.isArray(rows)) counts[`remittances.${name}`] = rows.length;
  for (const [name, rows] of Object.entries(fixture.adminTools)) counts[`adminTools.${name}`] = rows.length;
  const manifest: Manifest = { version, baseDate, counts, omittedRemittanceDates };
  validateAndAppend(state, fixture);
  state.idempotency.push({ id: markerId, fingerprint: version, response: manifest, createdAt: now.toISOString() });
  return manifest;
}
