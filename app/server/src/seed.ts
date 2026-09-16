import { businessDate, emptyState, type State } from "./domain.js";
export function seed(): State {
  const s = emptyState(),
    today = businessDate();
  s.collectors = [
    ["Ana Martínez", "AM"],
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
