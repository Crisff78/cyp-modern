import { businessDate, emptyState, type State, type User } from "./domain.js";
import { getAdminTools, seedAdminTools } from "./admin-tools.js";
import {
  cancelRemittance, createRemittance, openRemittanceCash, payRemittance,
  quoteRemittance, setDailyRate, setCommissionPolicy,
} from "./remittances.js";

export function normalizeDemoCollectorLabel(state: State, demo: boolean) {
  if (!demo) return;
  // Compatibility labels from the original synthetic demo, never real account names.
  const previousNames = new Set(["Ana Martínez", "Ana Martinez"]);
  const collector = state.collectors.find((row) => row.id === "col-1");
  if (collector && previousNames.has(collector.name)) {
    collector.name = "Cobrador";
    collector.initials = "CO";
  }
  for (const session of getAdminTools(state).sessions) {
    if (session.userId === "demo-collector" && session.collectorId === "col-1" &&
        session.role === "collector" && previousNames.has(session.userName))
      session.userName = "Cobrador";
  }
}

export function seed(): State {
  const s = emptyState(),
    today = businessDate();
  s.collectors = [
    ["Cobrador", "CO"],
    ["Luis Pérez", "LP"],
    ["Marta Reyes", "MR"],
  ].map(([name, initials], i) => ({
    id: `col-${i + 1}`,
    name,
    initials,
    routeId: `route-${i + 1}`,
    status: i === 2 ? "offline" : "active",
    collectionLimit: 2500000,
    payoutLimit: 1000000,
    lat: 18.4861 + i * 0.018,
    lng: -69.9312 + i * 0.025,
    lastSeen: new Date(Date.now() - (i === 2 ? 7200000 : 0)).toISOString(),
  }));
  s.routes = ["Zona Colonial", "Gazcue · Centro", "Los Prados"].map(
    (name, i) => ({
      id: `route-${i + 1}`,
      name,
      sector: ["Distrito Nacional", "Santo Domingo", "Distrito Nacional"][i],
      collectorId: `col-${i + 1}`,
    }),
  );
  s.clients = [
    "Colmado La Esquina",
    "María Rodríguez",
    "Taller Don Pedro",
    "Farmacia Central",
    "Cafetería El Patio",
    "Juan Hernández",
    "Ferretería del Norte",
    "Mercado Las Flores",
  ].map((name, i) => ({
    id: `cli-${i + 1}`,
    name,
    code: `CL-${String(i + 1).padStart(4, "0")}`,
    phone: "8095550100",
    address: [
      "Calle El Conde 24",
      "Calle Las Damas 18",
      "Av. Independencia 102",
      "Calle Arzobispo Meriño 31",
    ][i % 4],
    routeId: `route-${i < 4 ? 1 : i < 6 ? 2 : 3}`,
  }));
  s.charges = s.clients.map((c, i) => ({
    id: `chg-${i + 1}`,
    clientId: c.id,
    service: [
      "Servicio semanal",
      "Cuota de mantenimiento",
      "Servicio de distribución",
    ][i % 3],
    amount: [450000, 280000, 650000, 320000, 850000, 220000, 390000, 180000][i],
    collected: 0,
    dueDate:
      i % 3 === 1 ? businessDate(new Date(Date.now() - 86400000 * 2)) : today,
    required: i === 0 || i === 2,
    status: "pending",
  }));
  s.payouts = [
    {
      id: "pay-1",
      clientId: "cli-2",
      collectorId: "col-1",
      concept: "Remesa autorizada",
      amount: 200000,
      paid: 0,
      status: "pending",
    },
    {
      id: "pay-2",
      clientId: "cli-5",
      collectorId: "col-2",
      concept: "Pago a cliente",
      amount: 150000,
      paid: 0,
      status: "pending",
    },
  ];
  s.movements = [
    {
      id: "seed-delivery-1",
      collectorId: "col-1",
      type: "office_delivery",
      amount: 200000,
      createdAt: new Date().toISOString(),
      actorId: "demo-admin",
    },
    {
      id: "seed-delivery-2",
      collectorId: "col-2",
      type: "office_delivery",
      amount: 150000,
      createdAt: new Date().toISOString(),
      actorId: "demo-admin",
    },
  ];
  return s;
}

export function seedPublicDemo(): State {
  const s = seed();
  s.clients.forEach((client, i) => {
    client.lat = 18.472 + i * 0.004;
    client.lng = -69.936 + i * 0.005;
    client.note = "DATOS DE PRUEBA: ubicación ficticia para revisar el mapa.";
  });
  const now = new Date();
  const date = businessDate(now);
  const admin: User = { id: "demo-admin", name: "Administración", role: "admin" };
  const collector: User = { id: "demo-collector", name: "Cobrador", role: "collector", collectorId: "col-1" };
  setDailyRate(s, admin, { currency: "USD", rate: "59.000000", date }, now);
  setDailyRate(s, admin, { currency: "EUR", rate: "64.000000", date }, now);
  openRemittanceCash(s, admin, { operatorId: collector.id, currency: "USD", openingAmount: 100_000 }, [collector], now);
  openRemittanceCash(s, admin, { operatorId: collector.id, currency: "DOP", openingAmount: 1_000_000 }, [collector], now);
  const examples = [
    { senderClientId: "cli-2", recipientClientId: "cli-3", sourceCurrency: "USD", destinationCurrency: "DOP", amount: 12_000, status: "paid" },
    { senderClientId: "cli-3", recipientClientId: "cli-2", sourceCurrency: "DOP", destinationCurrency: "USD", amount: 250_000, status: "pending" },
    { senderClientId: "cli-4", recipientClientId: "cli-1", sourceCurrency: "DOP", destinationCurrency: "USD", amount: 100_000, status: "cancelled" },
  ] as const;
  setCommissionPolicy(s, admin, { transactionCommissionBps: 100, managerCommissionBps: 0 }, now);
  for (const example of examples) {
    const { status, ...input } = example;
    const quote = quoteRemittance(s, { ...input, commissionBps: 100 }, now).quote;
    const transfer = createRemittance(s, collector, {
      ...input, commissionBps: 100, quote, note: "Operación ficticia de demostración",
    }, [], now);
    if (status === "paid") payRemittance(s, collector, transfer.id, now);
    if (status === "cancelled") cancelRemittance(s, collector, transfer.id, "Cancelación ficticia de demostración", now);
  }
  setCommissionPolicy(s, admin, { transactionCommissionBps: 0, managerCommissionBps: 0 }, now);
  seedAdminTools(s);
  return s;
}
