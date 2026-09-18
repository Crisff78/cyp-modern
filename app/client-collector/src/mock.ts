import {
  enrichUserRole,
  type Receipt,
  type Snapshot,
  type User,
} from "./types";

const MOCK_USER_KEY = "cyp-collector-mock-user";
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const uid = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

type ReceiptRow = Receipt & { token: string };

const users: Record<string, User & { password: string }> = {
  "collector.demo": {
    id: "UUID-111",
    name: "Ana Martínez",
    role: "COLLECTOR",
    collectorId: "col-1",
    password: "Demo-CyP-2026!",
    isActive: true,
    hasWorkPermission: true,
  },
  "collector@cyp.local": {
    id: "UUID-111",
    name: "Ana Martínez",
    role: "COLLECTOR",
    collectorId: "col-1",
    password: "Demo-CyP-2026!",
    isActive: true,
    hasWorkPermission: true,
  },
  "superadmin@cyp.local": {
    id: "UUID-FFF",
    name: "Super Admin",
    role: "SUPERADMIN",
    collectorId: "col-1",
    password: "Demo-CyP-2026!",
    isActive: true,
    hasWorkPermission: true,
  },
  "admin@cyp.local": {
    id: "UUID-AAA",
    name: "Administración",
    role: "ADMIN",
    password: "Demo-CyP-2026!",
    isActive: true,
    hasWorkPermission: true,
  },
  "suspendido@cyp.local": {
    id: "UUID-SUSP",
    name: "Cobrador Suspendido",
    role: "COLLECTOR",
    collectorId: "col-1",
    password: "Demo-CyP-2026!",
    isActive: false,
    hasWorkPermission: false,
  },
};

const initialSnapshot = (): Snapshot => ({
  businessDate: today(),
  clients: [
    {
      id: "cli-1",
      name: "Colmado La Esquina",
      code: "C-001",
      phone: "8095550100",
      address: "Calle Duarte #12",
      routeId: "rt-1",
    },
    {
      id: "cli-2",
      name: "María Rodríguez",
      code: "C-002",
      phone: "8095550102",
      address: "Av. Circunvalación #45",
      routeId: "rt-1",
    },
    {
      id: "cli-3",
      name: "Taller Don Pedro",
      code: "C-003",
      phone: "8095550111",
      address: "Zona Industrial",
      routeId: "rt-1",
    },
    {
      id: "cli-4",
      name: "Farmacia Central",
      code: "C-004",
      phone: "8095550120",
      address: "Parque Central",
      routeId: "rt-1",
    },
  ],
  routes: [
    {
      id: "rt-1",
      name: "Ruta Centro",
      sector: "Distrito Nacional",
      collectorId: "col-1",
    },
  ],
  collectors: [
    {
      id: "col-1",
      name: "Ana Martínez",
      initials: "AM",
      routeId: "rt-1",
      status: "active",
      cashInHand: 200000,
      collectionLimit: 2500000,
      payoutLimit: 1000000,
      lat: 19.4517,
      lng: -70.697,
      lastSeen: now(),
    },
  ],
  charges: [
    {
      id: "chg-1",
      clientId: "cli-1",
      service: "Tarifa eléctrica",
      amount: 450000,
      collected: 0,
      dueDate: today(),
      required: true,
      status: "pending",
    },
    {
      id: "chg-2",
      clientId: "cli-2",
      service: "Recarga móvil",
      amount: 280000,
      collected: 0,
      dueDate: today(),
      required: false,
      status: "pending",
    },
    {
      id: "chg-3",
      clientId: "cli-3",
      service: "Cuota semanal",
      amount: 650000,
      collected: 0,
      dueDate: today(),
      required: true,
      status: "pending",
    },
    {
      id: "chg-4",
      clientId: "cli-4",
      service: "Servicio fijo",
      amount: 320000,
      collected: 0,
      dueDate: today(),
      required: false,
      status: "pending",
    },
  ],
  payouts: [
    {
      id: "pay-1",
      clientId: "cli-2",
      collectorId: "col-1",
      concept: "Remesa autorizada",
      amount: 300000,
      paid: 0,
      status: "pending",
    },
    {
      id: "pay-2",
      clientId: "cli-4",
      collectorId: "col-1",
      concept: "Pago a beneficiario",
      amount: 150000,
      paid: 0,
      status: "pending",
    },
  ],
  movements: [
    {
      id: "mov-1",
      collectorId: "col-1",
      type: "office_delivery",
      amount: 400000,
      createdAt: now(),
    },
    {
      id: "mov-2",
      collectorId: "col-1",
      type: "deposit",
      amount: 50000,
      createdAt: now(),
    },
  ],
  settlements: [],
  totals: {
    collected: 0,
    paid: 0,
    deposited: 0,
    officeDelivered: 0,
    difference: 0,
    activeCollectors: 1,
  },
  history: [],
});

let state = derive(initialSnapshot());
const receipts: ReceiptRow[] = [];

function derive(snapshot: Snapshot): Snapshot {
  const collected = sum(snapshot.movements, "collection"),
    paid = sum(snapshot.movements, "payout"),
    deposited = sum(snapshot.movements, "deposit"),
    officeDelivered = sum(snapshot.movements, "office_delivery");
  return {
    ...snapshot,
    totals: {
      collected,
      paid,
      deposited,
      officeDelivered,
      difference: collected - deposited + (officeDelivered - paid),
      activeCollectors: snapshot.collectors.filter(
        (collector) => collector.status === "active",
      ).length,
    },
    history: ["Lun", "Mar", "Mié", "Jue", "Vie"].map((label, index) => ({
      label,
      collected: Math.max(0, collected - (4 - index) * 50000),
      paid: Math.max(0, paid - (4 - index) * 30000),
    })),
  };
}

function sum(
  movements: Snapshot["movements"],
  type: Snapshot["movements"][number]["type"],
) {
  return movements
    .filter((movement) => movement.type === type)
    .reduce((total, movement) => total + movement.amount, 0);
}

function currentUser() {
  const stored = sessionStorage.getItem(MOCK_USER_KEY);
  if (!stored) throw new MockApiError("Inicia sesión para continuar.", 401);
  return enrichUserRole(JSON.parse(stored) as User);
}

function setCurrentUser(user: User) {
  sessionStorage.setItem(MOCK_USER_KEY, JSON.stringify(enrichUserRole(user)));
}

function jsonBody(options: RequestInit) {
  return options.body ? JSON.parse(String(options.body)) : {};
}

export class MockApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function isMockToken(token: string | null) {
  return Boolean(token?.startsWith("mock-token:"));
}

export async function mockApi<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 80));
  const method = (options.method ?? "GET").toUpperCase();

  if (path === "/auth/login" && method === "POST") {
    const body = jsonBody(options),
      key = String(body.email ?? "")
        .trim()
        .toLowerCase(),
      record = users[key];
    if (!record || body.password !== record.password)
      throw new MockApiError("Correo o contraseña incorrectos.", 401);
    const { password: _password, ...user } = record;
    const enriched = enrichUserRole(user);
    setCurrentUser(enriched);
    return {
      token: `mock-token:${enriched.id}:${Date.now()}`,
      user: enriched,
    } as T;
  }
  if (path === "/auth/me") return currentUser() as T;
  if (path === "/snapshot") return structuredClone(derive(state)) as T;
  if (path === "/tracking" && method === "POST") {
    const body = jsonBody(options),
      collector = state.collectors.find(
        (item) => item.id === currentUser().collectorId,
      );
    if (collector) {
      collector.lat = Number(body.lat ?? collector.lat);
      collector.lng = Number(body.lng ?? collector.lng);
      collector.lastSeen = now();
    }
    state = derive(state);
    return { ok: true } as T;
  }
  if ((path === "/cobros" || path === "/pagos") && method === "POST") {
    const body = jsonBody(options),
      collecting = path === "/cobros",
      user = currentUser(),
      token = uid("receipt");
    if (collecting) {
      const charge = state.charges.find((item) => item.id === body.chargeId);
      if (!charge) throw new MockApiError("Cargo no encontrado.", 404);
      const amount = Math.min(
        Number(body.amount),
        charge.amount - charge.collected,
      );
      charge.collected += amount;
      charge.status = charge.collected >= charge.amount ? "paid" : "partial";
      const client = state.clients.find((item) => item.id === charge.clientId);
      state.movements.push({
        id: uid("mov"),
        collectorId: user.collectorId ?? "col-1",
        clientId: charge.clientId,
        chargeId: charge.id,
        type: "collection",
        amount,
        createdAt: now(),
        receiptToken: token,
      });
      receipts.push({
        token,
        id: token,
        clientName: client?.name ?? "Cliente",
        collectorName: user.name,
        concept: charge.service,
        amount,
        createdAt: now(),
        type: "collection",
      });
    } else {
      const payout = state.payouts.find((item) => item.id === body.payoutId);
      if (!payout) throw new MockApiError("Pago no encontrado.", 404);
      const amount = Math.min(Number(body.amount), payout.amount - payout.paid);
      payout.paid += amount;
      payout.status = payout.paid >= payout.amount ? "paid" : "partial";
      const client = state.clients.find((item) => item.id === payout.clientId);
      state.movements.push({
        id: uid("mov"),
        collectorId: user.collectorId ?? "col-1",
        clientId: payout.clientId,
        payoutId: payout.id,
        type: "payout",
        amount,
        createdAt: now(),
        receiptToken: token,
      });
      receipts.push({
        token,
        id: token,
        clientName: client?.name ?? "Cliente",
        collectorName: user.name,
        concept: payout.concept,
        amount,
        createdAt: now(),
        type: "payout",
      });
    }
    state = derive(state);
    return { receipt: { token } } as T;
  }
  if (path.startsWith("/recibos/")) {
    const token = decodeURIComponent(path.split("/")[2] ?? "");
    const receipt =
      receipts.find((item) => item.token === token) ?? receipts[0];
    if (!receipt) throw new MockApiError("Recibo no encontrado.", 404);
    return receipt as T;
  }
  throw new MockApiError("Ruta mock no implementada para esta vista.", 404);
}
