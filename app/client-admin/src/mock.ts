import {
  enrichUserRole,
  type ClientMachine,
  type ClientMachineLog,
  type Balance,
  type Snapshot,
  type User,
} from "./types";

const MOCK_USER_KEY = "cyp-admin-mock-user";
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const uid = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const users: Record<string, User & { password: string }> = {
  "admin@cyp.local": {
    id: "UUID-AAA",
    name: "Administración",
    role: "ADMIN",
    password: "Demo-CyP-2026!",
    isActive: true,
    hasWorkPermission: true,
  },
  admin: {
    id: "UUID-AAA",
    name: "Administración",
    role: "ADMIN",
    password: "Demo-CyP-2026!",
    isActive: true,
    hasWorkPermission: true,
  },
  "superadmin@cyp.local": {
    id: "UUID-FFF",
    name: "Super Admin",
    role: "SUPERADMIN",
    password: "Demo-CyP-2026!",
    isActive: true,
    hasWorkPermission: true,
  },
  "supervisor@cyp.local": {
    id: "UUID-333",
    name: "Supervisor de Operaciones",
    role: "SUPERVISOR",
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
  "collector.demo": {
    id: "UUID-111",
    name: "Ana Martínez",
    role: "COLLECTOR",
    collectorId: "col-1",
    password: "Demo-CyP-2026!",
    isActive: true,
    hasWorkPermission: true,
  },
  "suspendido@cyp.local": {
    id: "UUID-SUSP",
    name: "Empresa Suspendida",
    role: "ADMIN",
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
      routeId: "rt-2",
    },
    {
      id: "cli-4",
      name: "Farmacia Central",
      code: "C-004",
      phone: "8095550120",
      address: "Parque Central",
      routeId: "rt-2",
    },
    {
      id: "cli-5",
      name: "Mini Market Norte",
      code: "C-005",
      phone: "8095550130",
      address: "Ensanche Norte",
      routeId: "rt-3",
    },
    {
      id: "cli-6",
      name: "Ferretería El Tornillo",
      code: "C-006",
      phone: "8095550140",
      address: "Los Jardines",
      routeId: "rt-3",
    },
  ],
  accounts: [
    {
      id: "acct-admin",
      name: "Administracion",
      email: "admin@cyp.local",
      role: "admin",
      credentialVersion: 1,
      status: "active",
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: "acct-collector",
      name: "Ana Martinez",
      email: "collector@cyp.local",
      role: "collector",
      collectorId: "col-1",
      credentialVersion: 1,
      status: "active",
      createdAt: now(),
      updatedAt: now(),
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
      ident: "001-0000015-0",
      cellular: "8095550101",
      accountId: "cob",
      zones: [{ id: "zn-1", name: "Distrito Nacional", from: "001", to: "050" }],
      limits: [{ currency: "Peso Dominicano", abbr: "DOP", collectionLimit: 2500000, payoutLimit: 1000000 }],
      assignedRoutes: ["rt-1"],
    },
    {
      id: "col-2",
      name: "Luis Núñez",
      initials: "LN",
      routeId: "rt-2",
      status: "limit",
      cashInHand: 760000,
      collectionLimit: 1800000,
      payoutLimit: 800000,
      lat: 19.4551,
      lng: -70.7042,
      lastSeen: now(),
      ident: "001-0000022-0",
      cellular: "8095550102",
      accountId: "franyi",
      zones: [{ id: "zn-2", name: "Mercado", from: "051", to: "099" }],
      limits: [{ currency: "Peso Dominicano", abbr: "DOP", collectionLimit: 1800000, payoutLimit: 800000 }],
      assignedRoutes: ["rt-2"],
    },
    {
      id: "col-3",
      name: "Rosa Jiménez",
      initials: "RJ",
      routeId: "rt-3",
      status: "offline",
      cashInHand: 0,
      collectionLimit: 2200000,
      payoutLimit: 900000,
      lat: 19.462,
      lng: -70.6855,
      lastSeen: new Date(Date.now() - 45 * 60000).toISOString(),
      ident: "001-0000033-0",
      cellular: "8095550103",
      accountId: "cob",
      zones: [],
      limits: [{ currency: "Peso Dominicano", abbr: "DOP", collectionLimit: 2200000, payoutLimit: 900000 }],
      assignedRoutes: ["rt-3"],
    },
  ],
  routes: [
    {
      id: "rt-1",
      name: "Ruta Centro",
      sector: "Distrito Nacional",
      collectorId: "col-1",
    },
    {
      id: "rt-2",
      name: "Ruta Mercado",
      sector: "Distrito Nacional",
      collectorId: "col-2",
    },
    {
      id: "rt-3",
      name: "Ruta Norte",
      sector: "Santiago Norte",
      collectorId: "col-3",
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
    {
      id: "chg-5",
      clientId: "cli-5",
      service: "Remesa familiar",
      amount: 510000,
      collected: 210000,
      dueDate: today(),
      required: true,
      status: "partial",
    },
    {
      id: "chg-6",
      clientId: "cli-6",
      service: "Plan mensual",
      amount: 190000,
      collected: 190000,
      dueDate: today(),
      required: false,
      status: "paid",
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
      clientId: "cli-3",
      collectorId: "col-2",
      concept: "Pago a beneficiario",
      amount: 450000,
      paid: 100000,
      status: "partial",
    },
  ],
  movements: [
    {
      id: "mov-1",
      collectorId: "col-1",
      clientId: "cli-1",
      chargeId: "chg-1",
      type: "collection",
      amount: 250000,
      createdAt: now(),
      receiptToken: "mock-rec-1",
    },
    {
      id: "mov-2",
      collectorId: "col-1",
      type: "deposit",
      amount: 50000,
      createdAt: now(),
    },
    {
      id: "mov-3",
      collectorId: "col-1",
      type: "office_delivery",
      amount: 400000,
      createdAt: now(),
    },
    {
      id: "mov-4",
      collectorId: "col-1",
      clientId: "cli-2",
      payoutId: "pay-1",
      type: "payout",
      amount: 300000,
      createdAt: now(),
      receiptToken: "mock-rec-2",
    },
    {
      id: "mov-5",
      collectorId: "col-2",
      clientId: "cli-3",
      chargeId: "chg-3",
      type: "collection",
      amount: 650000,
      createdAt: now(),
      receiptToken: "mock-rec-3",
    },
  ],
  payoutRecurring: [
    {
      id: "rpo-1",
      clientId: "cli-1",
      concept: "Reembolso mensual",
      amount: 150000,
      frequency: "monthly",
      nextRunDate: "2026-10-01",
      status: "active",
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
    activeCollectors: 0,
  },
  history: [],
});

let mockSystemConfig: Record<string, string | number | boolean> = {};
let state = derive(initialSnapshot());
let clientMachines: ClientMachine[] = [];
let clientMachineLogs: ClientMachineLog[] = [];

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
      collected: Math.max(0, collected - (4 - index) * 85000),
      paid: Math.max(0, paid - (4 - index) * 45000),
    })),
  };
}

function sum(
  movements: Snapshot["movements"],
  type: Snapshot["movements"][number]["type"],
) {
  return movements
    .filter((movement) => movement.type === type && !movement.cancelledAt)
    .reduce((total, movement) => total + movement.amount, 0);
}

function balance(collectorId: string): Balance {
  const movements = state.movements.filter(
    (movement) => movement.collectorId === collectorId,
  );
  const collected = sum(movements, "collection"),
    deposited = sum(movements, "deposit"),
    officeDelivered = sum(movements, "office_delivery"),
    paidToClients = sum(movements, "payout");
  return {
    collected,
    deposited,
    officeDelivered,
    paidToClients,
    difference: collected - deposited + (officeDelivered - paidToClients),
  };
}

function currentUser() {
  const stored = localStorage.getItem(MOCK_USER_KEY);
  if (!stored) {
    const fallback = enrichUserRole({
      id: "UUID-AAA",
      name: "Administración",
      role: "ADMIN",
      isActive: true,
      hasWorkPermission: true,
    });
    localStorage.setItem(MOCK_USER_KEY, JSON.stringify(fallback));
    return fallback;
  }
  return enrichUserRole(JSON.parse(stored) as User);
}

function setCurrentUser(user: User) {
  localStorage.setItem(MOCK_USER_KEY, JSON.stringify(enrichUserRole(user)));
}

function jsonBody(options: RequestInit) {
  return options.body ? JSON.parse(String(options.body)) : {};
}

function routeMapData(kind: "collector" | "route" | "zone", id: string) {
  const routes =
    kind === "collector"
      ? state.routes.filter((route) => route.collectorId === id)
      : kind === "route"
        ? state.routes.filter((route) => route.id === id)
        : state.routes.filter((route) => route.sector === id);
  const collectorIds = new Set(routes.map((route) => route.collectorId));
  const collectors = state.collectors.filter((collector) =>
    collectorIds.has(collector.id),
  );
  const primary = collectors[0] ?? state.collectors[0];
  const clients = state.clients.filter((client) =>
    routes.some((route) => route.id === client.routeId),
  );
  return {
    collector: {
      id: primary.id,
      name: primary.name,
      phone: "809-555-0101",
      lat: primary.lat,
      lng: primary.lng,
      cash_in_hand: balance(primary.id).difference / 100,
      collection_limit: primary.collectionLimit / 100,
      payout_limit: primary.payoutLimit / 100,
      last_ping: primary.lastSeen,
    },
    stops: clients.map((client, index) => {
      const charge = state.charges.find((item) => item.clientId === client.id);
      return {
        id: `pcp-${client.id}`,
        order: index + 1,
        client_name: client.name,
        lat: Number((primary.lat + 0.003 + index * 0.0017).toFixed(6)),
        lng: Number((primary.lng + 0.002 - index * 0.0013).toFixed(6)),
        amount_due: ((charge?.amount ?? 0) - (charge?.collected ?? 0)) / 100,
        status: charge?.status ?? "pending",
        obligated: Boolean(charge?.required),
      };
    }),
    route_geometry: null,
  };
}

function upsertAdminRecord(entity: string, body: Record<string, unknown>) {
  const id = String(body.id ?? uid(entity));
  if (entity === "collectors") {
    const name = String(body.name ?? "Nuevo cobrador");
    const initials = name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
    const existing = state.collectors.find((item) => item.id === id);
    const record = {
      ...(existing ?? {}),
      id,
      name,
      initials: initials || "NC",
      routeId: String(body.routeId ?? existing?.routeId ?? state.routes[0]?.id ?? "rt-1"),
      status: (body.active === false ? "offline" : "active") as Snapshot["collectors"][number]["status"],
      cashInHand: Number(existing?.cashInHand ?? 0),
      collectionLimit: Number(body.collectionLimit ?? existing?.collectionLimit ?? 1000000),
      payoutLimit: Number(body.payoutLimit ?? existing?.payoutLimit ?? 500000),
      lat: Number(existing?.lat ?? 19.4517),
      lng: Number(existing?.lng ?? -70.697),
      lastSeen: now(),
      ident: String(body.ident ?? existing?.ident ?? ""),
      cellular: String(body.cellular ?? existing?.cellular ?? ""),
      accountId: String(body.accountId ?? existing?.accountId ?? "cob"),
      zones: existing?.zones ?? [],
      limits: existing?.limits ?? [],
      assignedRoutes: existing?.assignedRoutes ?? [String(body.routeId ?? state.routes[0]?.id ?? "rt-1")],
    };
    const index = state.collectors.findIndex((item) => item.id === id);
    if (index >= 0) state.collectors[index] = record;
    else state.collectors.push(record);
  }
  if (entity === "clients") {
    const record = {
      id,
      name: String(body.name ?? "Nuevo cliente"),
      code: String(body.code ?? `C-${state.clients.length + 1}`),
      phone: String(body.phone ?? "8095550000"),
      address: String(body.address ?? "Dirección pendiente"),
      routeId: String(body.routeId ?? state.routes[0]?.id ?? "rt-1"),
      alias: String(body.alias ?? ""),
      sector: String(body.sector ?? ""),
      cellular: String(body.cellular ?? ""),
      email: String(body.email ?? ""),
      note: String(body.note ?? ""),
      identification: String(body.identification ?? ""),
      ...(Number.isFinite(Number(body.lat)) ? { lat: Number(body.lat), lng: Number(body.lng) } : {}),
    };
    const index = state.clients.findIndex((item) => item.id === id);
    if (index >= 0) state.clients[index] = record;
    else state.clients.push(record);
  }
  if (entity === "charges" || entity === "recurringCharges") {
    const record = {
      id,
      clientId: String(body.clientId ?? state.clients[0]?.id),
      service: String(body.service ?? "Servicio editable"),
      amount: Number(body.amount ?? 10000),
      collected: Number(body.collected ?? 0),
      dueDate: String(body.dueDate ?? state.businessDate),
      required: Boolean(body.required),
      status:
        (body.status as Snapshot["charges"][number]["status"]) ?? "pending",
    };
    const index = state.charges.findIndex((item) => item.id === id);
    if (index >= 0) state.charges[index] = record;
    else state.charges.push(record);
  }
  if (entity === "payouts") {
    const record = {
      id,
      clientId: String(body.clientId ?? state.clients[0]?.id),
      collectorId: String(body.collectorId ?? state.collectors[0]?.id),
      concept: String(body.concept ?? "Descargo editable"),
      amount: Number(body.amount ?? 10000),
      paid: Number(body.paid ?? 0),
      status:
        (body.status as Snapshot["payouts"][number]["status"]) ?? "pending",
    };
    const index = state.payouts.findIndex((item) => item.id === id);
    if (index >= 0) state.payouts[index] = record;
    else state.payouts.push(record);
  }
  if (
    ["collections", "deposits", "payments", "cashDeliveries"].includes(entity)
  ) {
    const type =
      entity === "collections"
        ? "collection"
        : entity === "deposits"
          ? "deposit"
          : entity === "payments"
            ? "payout"
            : "office_delivery";
    const record = {
      id,
      collectorId: String(body.collectorId ?? state.collectors[0]?.id),
      clientId: body.clientId ? String(body.clientId) : undefined,
      chargeId: body.chargeId ? String(body.chargeId) : undefined,
      payoutId: body.payoutId ? String(body.payoutId) : undefined,
      type: type as Snapshot["movements"][number]["type"],
      amount: Number(body.amount ?? 10000),
      createdAt: String(body.createdAt ?? now()),
      receiptToken: String(body.receiptToken ?? uid("receipt")),
    };
    const index = state.movements.findIndex((item) => item.id === id);
    if (index >= 0) state.movements[index] = record;
    else state.movements.push(record);
  }
  state = derive(state);
  return { ok: true, id };
}

function deleteAdminRecord(entity: string, id: string, body: Record<string, unknown> = {}) {
  if (entity === "collectors")
    state.collectors = state.collectors.filter((item) => item.id !== id);
  if (entity === "clients")
    state.clients = state.clients.filter((item) => item.id !== id);
  if (entity === "charges" || entity === "recurringCharges")
    state.charges = state.charges.filter((item) => item.id !== id);
  if (entity === "payouts")
    state.payouts = state.payouts.filter((item) => item.id !== id);
  if (entity === "collections") {
    const movement = state.movements.find((item) => item.id === id && item.type === "collection");
    if (movement) {
      movement.cancelledAt ??= now();
      movement.cancellationNote = String(body.note ?? "").trim();
    }
  }
  if (entity === "payments") {
    const movement = state.movements.find((item) => item.id === id && item.type === "payout");
    if (movement && !movement.cancelledAt) {
      movement.cancelledAt = now();
      movement.cancellationNote = String(body.note ?? "").trim();
      const payout = state.payouts.find((item) => item.id === movement.payoutId);
      if (payout) {
        payout.paid = Math.max(0, payout.paid - movement.amount);
        payout.status = payout.paid === 0 ? "pending" : payout.paid >= payout.amount ? "paid" : "partial";
      }
    }
  }
  if (entity === "deposits")
    state.movements = state.movements.filter((item) => item.id !== id);
  if (entity === "cashDeliveries") {
    const movement = state.movements.find((item) => item.id === id && item.type === "office_delivery");
    if (movement && !movement.cancelledAt) {
      movement.cancelledAt = now();
      movement.cancellationNote = String(body.note ?? "").trim();
    }
  }
  state = derive(state);
  return { ok: true };
}

function updateCollectorSubflow(entity: string, collectorId: string, body: Record<string, unknown>) {
  const collector = state.collectors.find((item) => item.id === collectorId);
  if (!collector) throw new MockApiError("Cobrador no encontrado.", 404);
  const action = String(body.action ?? "add");
  if (entity === "collector-zones") {
    collector.zones ??= [];
    if (action === "delete") collector.zones = collector.zones.filter((item) => item.id !== body.zoneId);
    else {
      const zoneName = String(body.zone ?? body.name ?? "Zona disponible");
      collector.zones.push({ id: uid("zone"), name: zoneName, from: String(body.from ?? "001"), to: String(body.to ?? "999") });
    }
  }
  if (entity === "collector-limits") {
    collector.limits ??= [];
    if (action === "delete") collector.limits = collector.limits.filter((item) => item.abbr !== body.abbr);
    else {
      const abbr = String(body.abbr ?? "DOP");
      const next = {
        currency: String(body.currency ?? "Peso Dominicano"),
        abbr,
        collectionLimit: Number(body.collectionLimit ?? collector.collectionLimit),
        payoutLimit: Number(body.payoutLimit ?? collector.payoutLimit),
      };
      collector.limits = [...collector.limits.filter((item) => item.abbr !== abbr), next];
      if (abbr === "DOP") {
        collector.collectionLimit = next.collectionLimit;
        collector.payoutLimit = next.payoutLimit;
      }
    }
  }
  if (entity === "collector-routes") {
    collector.assignedRoutes ??= [];
    if (action === "delete") collector.assignedRoutes = collector.assignedRoutes.filter((item) => item !== body.routeId);
    else {
      const routeId = String(body.routeId ?? state.routes[0]?.id ?? "rt-1");
      if (!collector.assignedRoutes.includes(routeId)) collector.assignedRoutes.push(routeId);
      const route = state.routes.find((item) => item.id === routeId);
      if (route) route.collectorId = collector.id;
      collector.routeId = routeId;
    }
  }
  state = derive(state);
  return { ok: true, collector };
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
  if (path === "/clientes" && method === "GET") {
    currentUser();
    return structuredClone(state.clients) as T;
  }
  if (path === "/clientes" && method === "POST") {
    currentUser();
    const body = jsonBody(options);
    const id = String(body.id ?? uid("client"));
    upsertAdminRecord("clients", { ...body, id });
    return state.clients.find((client) => client.id === id) as T;
  }
  const clientUpdateMatch = path.match(/^\/clientes\/([^/]+)$/);
  if (clientUpdateMatch && method === "POST") {
    currentUser();
    const clientId = decodeURIComponent(clientUpdateMatch[1]);
    upsertAdminRecord("clients", { ...jsonBody(options), id: clientId });
    const client = state.clients.find((item) => item.id === clientId);
    if (!client) throw new MockApiError("Cliente no encontrado.", 404);
    return client as T;
  }
  const clientMachinesMatch = path.match(/^\/clientes\/([^/]+)\/tragamonedas(?:\/([^/]+))?$/);
  if (clientMachinesMatch && clientMachinesMatch[2] !== "registros") {
    currentUser();
    const clientId = decodeURIComponent(clientMachinesMatch[1]);
    const machineId = clientMachinesMatch[2] ? decodeURIComponent(clientMachinesMatch[2]) : "";
    if (!state.clients.some((client) => client.id === clientId)) throw new MockApiError("Cliente no encontrado.", 404);
    if (method === "GET") return clientMachines.filter((machine) => machine.clientId === clientId) as T;
    if (method === "POST") {
      const body = jsonBody(options);
      const existing = machineId ? clientMachines.find((machine) => machine.id === machineId && machine.clientId === clientId) : undefined;
      if (machineId && !existing) throw new MockApiError("Máquina tragamonedas no encontrada.", 404);
      if (clientMachines.some((machine) => machine.clientId === clientId && machine.number === Number(body.number) && machine.id !== existing?.id))
        throw new MockApiError("El número de máquina ya existe.", 409);
      const timestamp = now();
      const record: ClientMachine = {
        id: existing?.id ?? uid("machine"), clientId, number: Number(body.number),
        entry: String(body.entry ?? ""), exit: String(body.exit ?? ""),
        value: Number(body.value ?? 0), percentage: Number(body.percentage ?? 0),
        registeredAt: existing?.registeredAt ?? timestamp, updatedAt: timestamp,
      };
      clientMachines = existing ? clientMachines.map((item) => item.id === existing.id ? record : item) : [...clientMachines, record];
      clientMachineLogs.unshift({
        id: uid("machine-log"), clientId, machineId: record.id, registeredAt: timestamp,
        previousEntry: existing?.entry ?? "", entry: record.entry,
        entryDifference: String(Number(record.entry) - Number(existing?.entry ?? 0)),
        previousExit: existing?.exit ?? "", exit: record.exit,
        exitDifference: String(Number(record.exit) - Number(existing?.exit ?? 0)),
        difference: String((Number(record.entry) - Number(existing?.entry ?? 0)) - (Number(record.exit) - Number(existing?.exit ?? 0))),
        currency: "DOP", amount: record.value, percentage: record.percentage,
        charge: record.value * record.percentage / 100,
        ...(existing ? { modifiedAt: timestamp } : {}),
      });
      return record as T;
    }
  }
  const machineLogMatch = path.match(/^\/clientes\/([^/]+)\/tragamonedas\/registros$/);
  if (machineLogMatch && method === "GET") {
    currentUser();
    const clientId = decodeURIComponent(machineLogMatch[1]);
    if (!state.clients.some((client) => client.id === clientId)) throw new MockApiError("Cliente no encontrado.", 404);
    return clientMachineLogs.filter((log) => log.clientId === clientId) as T;
  }
  if (path.startsWith("/mock/admin/")) {
    currentUser();
    const [, , , entity, id] = path.split("/");
    if (["collector-zones", "collector-limits", "collector-routes"].includes(entity) && (method === "POST" || method === "PATCH"))
      return updateCollectorSubflow(entity, decodeURIComponent(id ?? ""), jsonBody(options)) as T;
    if (method === "DELETE")
      return deleteAdminRecord(entity, decodeURIComponent(id ?? ""), jsonBody(options)) as T;
    if (method === "POST" || method === "PATCH")
      return upsertAdminRecord(entity, jsonBody(options)) as T;
  }
  if (path.startsWith("/monitoring/")) {
    const match = path.match(
      /^\/monitoring\/(collector|route|zone)\/([^/]+)\/map-data$/,
    );
    if (match)
      return routeMapData(
        match[1] as "collector" | "route" | "zone",
        decodeURIComponent(match[2]),
      ) as T;
  }
  if (path.startsWith("/cuadres/preview")) {
    const url = new URL(path, "http://mock.local");
    return balance(url.searchParams.get("collectorId") ?? "col-1") as T;
  }
  if (path === "/pagos" && method === "POST") {
    currentUser();
    const body = jsonBody(options);
    const payout = state.payouts.find((item) => item.id === String(body.payoutId ?? ""));
    const amount = Number(body.amount);
    if (!payout) throw new MockApiError("Descargo no encontrado.", 404);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new MockApiError("El importe del pago debe ser mayor a cero.", 422);
    if (payout.status === "cancelled" || payout.paid + amount > payout.amount) throw new MockApiError("El pago supera el saldo autorizado.", 422);
    if (state.settlements.some((item) => item.collectorId === payout.collectorId && item.date >= state.businessDate)) throw new MockApiError("La jornada ya está cerrada.", 409);
    const available = balance(payout.collectorId).officeDelivered - balance(payout.collectorId).paidToClients;
    if (amount > available) throw new MockApiError("No hay fondos de oficina suficientes para este pago.", 409);
    const movement: Snapshot["movements"][number] = {
      id: uid("mov"), collectorId: payout.collectorId, clientId: payout.clientId, payoutId: payout.id,
      type: "payout", amount, createdAt: now(), receiptToken: uid("receipt"),
    };
    payout.paid += amount;
    payout.status = payout.paid >= payout.amount ? "paid" : "partial";
    state.movements.push(movement);
    state = derive(state);
    return { movement: structuredClone(movement) } as T;
  }
  if (path === "/cuadres" && method === "POST") {
    const body = jsonBody(options),
      result = balance(body.collectorId);
    state.settlements.push({
      id: uid("settlement"),
      collectorId: body.collectorId,
      date: body.date,
      status: "closed",
      closedAt: now(),
      ...result,
    });
    state = derive(state);
    return { ok: true } as T;
  }
  if (
    [
      "/cargos",
      "/cargos/recurrentes",
      "/descargos",
      "/depositos",
      "/entregas",
    ].includes(path) &&
    method === "POST"
  ) {
    const body = jsonBody(options);
    let createdCharge: Snapshot["charges"][number] | undefined;
    let createdPayout: Snapshot["payouts"][number] | undefined;
    let createdDeposit: Snapshot["movements"][number] | undefined;
    let createdDelivery: Snapshot["movements"][number] | undefined;
    if (path === "/cargos") {
      createdCharge = {
        id: uid("chg"),
        clientId: body.clientId,
        service: body.service,
        concept: String(body.concept ?? ""),
        currency: String(body.currency ?? "Peso Dominicano"),
        note: String(body.note ?? ""),
        amount: body.amount,
        collected: 0,
        dueDate: body.dueDate,
        required: Boolean(body.required),
        status: "pending",
      };
      state.charges.push(createdCharge);
    }
    if (path === "/cargos/recurrentes")
      for (const clientId of body.clientIds ?? [])
        state.charges.push({
          id: uid("chg"),
          clientId,
          service: body.service,
          amount: body.amount,
          collected: 0,
          dueDate: body.dueDate,
          required: Boolean(body.required),
          status: "pending",
        });
    if (path === "/descargos") {
      createdPayout = {
        id: uid("pay"),
        clientId: body.clientId,
        collectorId: body.collectorId,
        concept: body.concept,
        amount: body.amount,
        paid: 0,
        status: "pending",
      };
      state.payouts.push(createdPayout);
    }
    if (path === "/depositos") {
      createdDeposit = {
        id: uid("mov"),
        collectorId: body.collectorId,
        type: "deposit",
        amount: body.amount,
        createdAt: now(),
      };
      state.movements.push(createdDeposit);
    }
    if (path === "/entregas") {
      createdDelivery = {
        id: uid("mov"),
        collectorId: body.collectorId,
        type: "office_delivery",
        amount: body.amount,
        createdAt: now(),
      };
      state.movements.push(createdDelivery);
    }
    state = derive(state);
    return (path === "/cargos"
      ? structuredClone(createdCharge)
      : path === "/descargos"
        ? structuredClone(createdPayout)
      : path === "/depositos"
        ? { movement: structuredClone(createdDeposit) }
        : path === "/entregas"
          ? { movement: structuredClone(createdDelivery) }
        : { ok: true }) as T;
  }
  if (path === "/descargos-recurrentes" && method === "POST") {
    const body = jsonBody(options);
    state.payoutRecurring.push({
      id: uid("rpo"),
      clientId: String(body.clientId ?? state.clients[0]?.id ?? "cli-1"),
      concept: String(body.concept ?? ""),
      amount: Number(body.amount ?? 0),
      frequency:
        body.frequency === "weekly" || body.frequency === "quarterly"
          ? body.frequency
          : "monthly",
      nextRunDate: String(body.nextRunDate ?? state.businessDate),
      status: "active",
      createdAt: now(),
    });
    state = derive(state);
    return { ok: true } as T;
  }
  const recMatch = path.match(/^\/descargos-recurrentes\/([^/]+)$/);
  if (recMatch && method === "POST") {
    const body = jsonBody(options);
    const template = state.payoutRecurring.find((t) => t.id === recMatch[1]);
    if (!template)
      throw new MockApiError("El descargo recurrente no existe.", 404);
    if (body.concept !== undefined) template.concept = String(body.concept);
    if (body.amount !== undefined) template.amount = Number(body.amount);
    if (
      body.frequency === "weekly" ||
      body.frequency === "monthly" ||
      body.frequency === "quarterly"
    )
      template.frequency = body.frequency;
    if (body.nextRunDate !== undefined)
      template.nextRunDate = String(body.nextRunDate);
    if (
      body.status === "active" ||
      body.status === "paused" ||
      body.status === "archived"
    )
      template.status = body.status;
    state = derive(state);
    return { ok: true } as T;
  }
  if (path === "/configuracion" && method === "GET")
    return { config: { ...mockSystemConfig } } as T;
  if (path === "/configuracion" && method === "POST") {
    mockSystemConfig = jsonBody(options).config ?? {};
    return { ok: true } as T;
  }
  const statementMatch = path.match(/^\/clientes\/([^/]+)\/estado$/);
  if (statementMatch && method === "GET") {
    const client = state.clients.find(
      (c) => c.id === decodeURIComponent(statementMatch[1]),
    );
    if (!client) throw new MockApiError("Cliente no encontrado.", 404);
    const cargos = state.charges.filter((c) => c.clientId === client.id);
    const autorizaciones = state.payouts.filter(
      (p) => p.clientId === client.id,
    );
    const cobros = state.movements.filter(
      (m) => m.type === "collection" && m.clientId === client.id,
    );
    const pagos = state.movements.filter(
      (m) => m.type === "payout" && m.clientId === client.id,
    );
    return {
      client: { id: client.id, code: client.code, name: client.name },
      cargos,
      cobros,
      autorizaciones,
      pagos,
      resumen: {
        totalCargado: cargos.reduce((a, c) => a + c.amount, 0),
        totalCobrado: cobros.reduce((a, m) => a + m.amount, 0),
        totalPendiente: cargos
          .filter((c) => c.status !== "cancelled")
          .reduce((a, c) => a + Math.max(0, c.amount - c.collected), 0),
        totalAutorizado: autorizaciones.reduce((a, p) => a + p.amount, 0),
        totalPagadoACliente: pagos.reduce((a, m) => a + m.amount, 0),
      },
    } as T;
  }
  if (path === "/cargos/importar" && method === "POST") {
    const body = jsonBody(options);
    const errores: { fila: number; mensaje: string }[] = [];
    let creados = 0;
    (Array.isArray(body.filas) ? body.filas : []).forEach(
      (fila: Record<string, unknown>, index: number) => {
        const importe = Number(fila.importe);
        const client = state.clients.find(
          (c) =>
            (c.code ?? "").toLowerCase() ===
            String(fila.identificacion ?? "").trim().toLowerCase(),
        );
        if (!client)
          errores.push({ fila: index + 1, mensaje: "Cliente no encontrado." });
        else if (!Number.isInteger(importe) || importe <= 0)
          errores.push({ fila: index + 1, mensaje: "Importe inválido." });
        else {
          state.charges.push({
            id: uid("chg"),
            clientId: client.id,
            service: String(fila.servicio ?? "").trim(),
            amount: importe,
            dueDate:
              String(fila.fecha ?? "") ||
              new Date().toISOString().slice(0, 10),
            required: Boolean(fila.requerido),
            collected: 0,
            status: "pending",
          });
          creados += 1;
        }
      },
    );
    state = derive(state);
    return { creados, errores } as T;
  }
  const chargeUpdateMatch = path.match(/^\/cargos\/([^/]+)$/);
  if (chargeUpdateMatch && method === "POST" && chargeUpdateMatch[1] !== "cancelar") {
    const chargeId = decodeURIComponent(chargeUpdateMatch[1]);
    const charge = state.charges.find((item) => item.id === chargeId);
    if (!charge) throw new MockApiError("Cargo no encontrado.", 404);
    if (charge.status === "cancelled") throw new MockApiError("No se puede modificar un cargo cancelado.", 409);
    if (charge.collected > 0) throw new MockApiError("No se puede modificar un cargo que ya tiene cobros.", 409);
    const body = jsonBody(options);
    Object.assign(charge, {
      clientId: String(body.clientId ?? charge.clientId),
      service: String(body.service ?? charge.service),
      concept: String(body.concept ?? ""),
      currency: String(body.currency ?? "Peso Dominicano"),
      note: String(body.note ?? ""),
      amount: Number(body.amount ?? charge.amount),
      dueDate: String(body.dueDate ?? charge.dueDate),
      required: Boolean(body.required ?? charge.required),
    });
    state = derive(state);
    return structuredClone(charge) as T;
  }
  if (path === "/cargos/cancelar" && method === "POST") {
    const body = jsonBody(options);
    const charge = state.charges.find((item) => item.id === String(body.id ?? ""));
    if (!charge) throw new MockApiError("Registro no encontrado.", 404);
    if (charge.collected > 0) throw new MockApiError("Un registro con movimientos no puede cancelarse.", 409);
    charge.status = "cancelled";
    state = derive(state);
    return structuredClone(charge) as T;
  }
  if (path === "/descargos/cancelar" && method === "POST") {
    const body = jsonBody(options);
    const payout = state.payouts.find((item) => item.id === String(body.id ?? ""));
    if (!payout) throw new MockApiError("Registro no encontrado.", 404);
    if (payout.paid > 0)
      throw new MockApiError("Un registro con movimientos no puede cancelarse.", 409);
    payout.status = "cancelled";
    state = derive(state);
    return structuredClone(payout) as T;
  }
  if (path === "/descargos/importar" && method === "POST") {
    const body = jsonBody(options);
    const errores: { fila: number; mensaje: string }[] = [];
    let creados = 0;
    (Array.isArray(body.filas) ? body.filas : []).forEach(
      (fila: Record<string, unknown>, index: number) => {
        const importe = Number(fila.importe);
        const client = state.clients.find(
          (c) =>
            (c.code ?? "").toLowerCase() ===
            String(fila.identificacion ?? "").trim().toLowerCase(),
        );
        if (!client)
          errores.push({ fila: index + 1, mensaje: "Cliente no encontrado." });
        else if (!Number.isInteger(importe) || importe <= 0)
          errores.push({ fila: index + 1, mensaje: "Importe inválido." });
        else {
          state.payouts.push({
            id: uid("pay"),
            clientId: client.id,
            collectorId:
              String(fila.cobrador ?? "") ||
              state.collectors[0]?.id ||
              "col-1",
            concept: String(fila.concepto ?? "").trim(),
            amount: importe,
            paid: 0,
            status: "pending",
          });
          creados += 1;
        }
      },
    );
    state = derive(state);
    return { creados, errores } as T;
  }
  const depositAction = path.match(/^\/depositos\/([^/]+)\/(aceptar|cancelar)$/);
  if (depositAction && method === "POST") {
    const body = jsonBody(options);
    const movement = state.movements.find(
      (m) => m.id === depositAction[1] && m.type === "deposit",
    );
    if (!movement) throw new MockApiError("El depósito no existe.", 404);
    if (depositAction[2] === "aceptar") {
      if (movement.cancelledAt)
        throw new MockApiError("El depósito ya fue cancelado.", 422);
      movement.acceptedAt ??= now();
      if (Array.isArray(body.desglose))
        movement.denominations = body.desglose as NonNullable<typeof movement.denominations>;
    } else {
      if (movement.acceptedAt)
        throw new MockApiError("El depósito ya fue aceptado.", 422);
      movement.cancelledAt ??= now();
    }
    state = derive(state);
    return { ok: true } as T;
  }
  throw new MockApiError("Ruta mock no implementada para esta vista.", 404);
}
