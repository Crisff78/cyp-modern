import {
  randomUUID,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

export type Role = "admin" | "collector";
export type User = {
  id: string;
  name: string;
  role: Role;
  collectorId?: string;
};
export type Account = {
  id: string;
  name: string;
  email: string;
  role: Role;
  collectorId?: string;
  salt: string;
  passwordHash: string;
  credentialVersion: number;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
};
export type PublicAccount = Omit<Account, "salt" | "passwordHash">;
export type Client = {
  id: string;
  name: string;
  code: string;
  phone: string;
  address: string;
  routeId: string;
  alias?: string;
  sector?: string;
  cellular?: string;
  email?: string;
  note?: string;
  identification?: string;
  lat?: number;
  lng?: number;
};
export type ClientMachine = {
  id: string;
  clientId: string;
  number: number;
  entry: string;
  exit: string;
  value: number;
  percentage: number;
  registeredAt: string;
  updatedAt: string;
};
export type ClientMachineLog = {
  id: string;
  clientId: string;
  machineId: string;
  registeredAt: string;
  previousEntry: string;
  entry: string;
  entryDifference: string;
  previousExit: string;
  exit: string;
  exitDifference: string;
  difference: string;
  currency: string;
  amount: number;
  percentage: number;
  charge: number;
  modifiedAt?: string;
  cancelledAt?: string;
};
export type Route = {
  id: string;
  name: string;
  sector: string;
  collectorId: string;
};
export type Collector = {
  id: string;
  name: string;
  initials: string;
  routeId: string;
  status: "active" | "offline" | "limit";
  collectionLimit: number;
  payoutLimit: number;
  lat: number;
  lng: number;
  lastSeen: string;
};
export type Charge = {
  id: string;
  clientId: string;
  service: string;
  concept?: string;
  currency?: string;
  note?: string;
  amount: number;
  collected: number;
  dueDate: string;
  required: boolean;
  status: "pending" | "partial" | "paid" | "cancelled";
  cancelReason?: string;
};
export type Payout = {
  id: string;
  clientId: string;
  collectorId: string;
  concept: string;
  amount: number;
  paid: number;
  status: Charge["status"];
};
export type Movement = {
  id: string;
  collectorId: string;
  clientId?: string;
  chargeId?: string;
  payoutId?: string;
  type: "collection" | "deposit" | "office_delivery" | "payout";
  amount: number;
  createdAt: string;
  receiptToken?: string;
  receiptRevoked?: boolean;
  actorId: string;
  acceptedAt?: string;
  acceptedBy?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  denominations?: Array<{ denominacion: number; cantidad: number }>;
};
export type Settlement = {
  id: string;
  collectorId: string;
  date: string;
  collected: number;
  deposited: number;
  officeDelivered: number;
  paidToClients: number;
  difference: number;
  status: "closed";
  closedAt: string;
  actorId: string;
};
export type Idempotency = {
  id: string;
  fingerprint: string;
  response: unknown;
  createdAt: string;
};
export type RecurringPayout = {
  id: string;
  clientId: string;
  concept: string;
  amount: number;
  frequency: "weekly" | "monthly" | "quarterly";
  nextRunDate: string;
  status: "active" | "paused" | "archived";
  createdAt: string;
};
export type DepositEvent = {
  id: string;
  movementId: string;
  action: "accepted" | "cancelled";
  actorId: string;
  denominations?: Array<{ denominacion: number; cantidad: number }>;
  createdAt: string;
};
export type State = {
  clients: Client[];
  clientMachines: ClientMachine[];
  clientMachineLogs: ClientMachineLog[];
  routes: Route[];
  collectors: Collector[];
  charges: Charge[];
  payouts: Payout[];
  payoutRecurring: RecurringPayout[];
  movements: Movement[];
  depositEvents: DepositEvent[];
  settlements: Settlement[];
  idempotency: Idempotency[];
  accounts: Account[];
  systemConfig?: Record<string, unknown>;
};
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}
export const businessDate = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santo_Domingo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
export const emptyState = (): State => ({
  clients: [],
  clientMachines: [],
  clientMachineLogs: [],
  routes: [],
  collectors: [],
  charges: [],
  payouts: [],
  payoutRecurring: [],
  movements: [],
  depositEvents: [],
  settlements: [],
  idempotency: [],
  accounts: [],
});
export const publicAccount = (account: Account): PublicAccount => {
  const { salt: _salt, passwordHash: _hash, ...rest } = account;
  return rest;
};
export function hashPassword(password: string, salt = randomBytes(16).toString("base64url")) {
  return {
    salt,
    passwordHash: scryptSync(password, salt, 64).toString("base64url"),
  };
}
export function verifyPassword(
  password: string,
  salt: string,
  passwordHash: string,
) {
  try {
    const provided = scryptSync(password, salt, 64),
      stored = Buffer.from(passwordHash, "base64url");
    return (
      provided.length === stored.length && timingSafeEqual(provided, stored)
    );
  } catch {
    return false;
  }
}
export function findAccount(state: State, email: string) {
  const normalized = email.trim().toLowerCase();
  return state.accounts.find(
    (account) => account.email.toLowerCase() === normalized,
  );
}
export function preview(state: State, collectorId: string, date?: string) {
  const rows = state.movements.filter(
    (m) =>
      m.collectorId === collectorId &&
      (!date || businessDate(new Date(m.createdAt)) === date),
  );
  const sum = (type: Movement["type"]) =>
    rows
      .filter((m) => m.type === type && !m.cancelledAt)
      .reduce((a, m) => a + m.amount, 0);
  const collected = sum("collection"),
    deposited = sum("deposit"),
    officeDelivered = sum("office_delivery"),
    paidToClients = sum("payout");
  return {
    collected,
    deposited,
    officeDelivered,
    paidToClients,
    difference: collected - deposited + (officeDelivered - paidToClients),
  };
}
export function acceptDeposit(
  state: State,
  user: User,
  movementId: string,
  desglose?: Array<{ denominacion: number; cantidad: number }>,
) {
  assertAdmin(user);
  const movement = state.movements.find(
    (m) => m.id === movementId && m.type === "deposit",
  );
  if (!movement)
    throw new DomainError("DEPOSIT_NOT_FOUND", "El depósito no existe.", 404);
  const yaCancelado = state.depositEvents.some(
    (e) => e.movementId === movementId && e.action === "cancelled",
  );
  if (yaCancelado)
    throw new DomainError(
      "DEPOSIT_CANCELLED",
      "No se puede aceptar un depósito cancelado.",
      422,
    );
  if (desglose?.length) {
    let total = 0;
    for (const item of desglose) {
      if (
        !Number.isInteger(item.denominacion) ||
        item.denominacion <= 0 ||
        !Number.isInteger(item.cantidad) ||
        item.cantidad < 0
      )
        throw new DomainError(
          "DEPOSIT_BREAKDOWN_INVALID",
          "El desglose contiene valores inválidos.",
          422,
        );
      total += item.denominacion * item.cantidad;
    }
    if (total !== movement.amount)
      throw new DomainError(
        "DEPOSIT_BREAKDOWN_MISMATCH",
        `El desglose suma ${total} centavos y el depósito es ${movement.amount}.`,
        422,
      );
  }
  const yaAceptado = state.depositEvents.some(
    (e) => e.movementId === movementId && e.action === "accepted",
  );
  if (!yaAceptado) {
    const createdAt = new Date().toISOString();
    state.depositEvents.push({
      id: randomUUID(),
      movementId,
      action: "accepted",
      actorId: user.id,
      createdAt,
      ...(desglose?.length ? { denominations: desglose } : {}),
    });
    movement.acceptedAt = createdAt;
    movement.acceptedBy = user.id;
    if (desglose?.length) movement.denominations = desglose;
  }
  return movement;
}

export function cancelDeposit(state: State, user: User, movementId: string) {
  assertAdmin(user);
  const movement = state.movements.find(
    (m) => m.id === movementId && m.type === "deposit",
  );
  if (!movement)
    throw new DomainError("DEPOSIT_NOT_FOUND", "El depósito no existe.", 404);
  const yaAceptado = state.depositEvents.some(
    (e) => e.movementId === movementId && e.action === "accepted",
  );
  if (yaAceptado)
    throw new DomainError(
      "DEPOSIT_ALREADY_ACCEPTED",
      "No se puede cancelar un depósito ya aceptado.",
      422,
    );
  const yaCancelado = state.depositEvents.some(
    (e) => e.movementId === movementId && e.action === "cancelled",
  );
  if (!yaCancelado) {
    const createdAt = new Date().toISOString();
    state.depositEvents.push({
      id: randomUUID(),
      movementId,
      action: "cancelled",
      actorId: user.id,
      createdAt,
    });
    movement.cancelledAt = createdAt;
    movement.cancelledBy = user.id;
  }
  return movement;
}

export function createRecurringPayout(
  state: State,
  user: User,
  input: {
    clientId: string;
    concept: string;
    amount: number;
    frequency: RecurringPayout["frequency"];
    nextRunDate: string;
  },
) {
  assertAdmin(user);
  collectorForClient(state, input.clientId);
  if (!Number.isInteger(input.amount) || input.amount <= 0)
    throw new DomainError(
      "IMPORT_INVALID_AMOUNT",
      "El importe debe ser un entero positivo en centavos.",
      422,
    );
  const template: RecurringPayout = {
    id: randomUUID(),
    clientId: input.clientId,
    concept: input.concept.trim(),
    amount: input.amount,
    frequency: input.frequency,
    nextRunDate: input.nextRunDate,
    status: "active",
    createdAt: new Date().toISOString(),
  };
  state.payoutRecurring.push(template);
  return template;
}

export function updateRecurringPayout(
  state: State,
  user: User,
  id: string,
  cambio: {
    concept?: string;
    amount?: number;
    frequency?: RecurringPayout["frequency"];
    nextRunDate?: string;
    status?: RecurringPayout["status"];
  },
) {
  assertAdmin(user);
  const template = state.payoutRecurring.find((t) => t.id === id);
  if (!template)
    throw new DomainError(
      "NOT_FOUND",
      "El descargo recurrente no existe.",
      404,
    );
  if (cambio.amount !== undefined) {
    if (!Number.isInteger(cambio.amount) || cambio.amount <= 0)
      throw new DomainError(
        "IMPORT_INVALID_AMOUNT",
        "El importe debe ser un entero positivo en centavos.",
        422,
      );
    template.amount = cambio.amount;
  }
  if (cambio.concept !== undefined) template.concept = cambio.concept.trim();
  if (cambio.frequency !== undefined) template.frequency = cambio.frequency;
  if (cambio.nextRunDate !== undefined)
    template.nextRunDate = cambio.nextRunDate;
  if (cambio.status !== undefined) template.status = cambio.status;
  return template;
}

export function saveSystemConfigData(
  state: State,
  user: User,
  data: Record<string, unknown>,
) {
  assertAdmin(user);
  if (JSON.stringify(data).length > 65536)
    throw new DomainError(
      "CONFIG_TOO_LARGE",
      "La configuración excede el tamaño permitido.",
      400,
    );
  state.systemConfig = data;
  return { ok: true };
}

export function clientStatement(state: State, user: User, clientId: string) {
  const client = state.clients.find((c) => c.id === clientId);
  if (!client)
    throw new DomainError("NOT_FOUND", "Cliente no encontrado.", 404);
  if (user.role !== "admin") {
    const collectorId = collectorForClient(state, clientId);
    if (user.collectorId !== collectorId)
      throw new DomainError(
        "FORBIDDEN",
        "Este cliente no pertenece a su ruta.",
        403,
      );
  }
  const cargos = state.charges.filter((c) => c.clientId === clientId);
  const autorizaciones = state.payouts.filter((p) => p.clientId === clientId);
  const cobros = state.movements.filter(
    (m) =>
      m.type === "collection" && m.clientId === clientId && !m.cancelledAt,
  );
  const pagos = state.movements.filter(
    (m) => m.type === "payout" && m.clientId === clientId && !m.cancelledAt,
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
  };
}

export type ImportRowError = { fila: number; mensaje: string };

const MAX_IMPORT_ROWS = 1000;

function assertImportAmount(amount: number) {
  if (!Number.isInteger(amount) || amount <= 0)
    throw new DomainError(
      "IMPORT_INVALID_AMOUNT",
      "El importe debe ser un entero positivo en centavos.",
      422,
    );
}

function findClientByIdentificacion(state: State, identificacion: string) {
  const client = state.clients.find(
    (c) => c.code.toLowerCase() === identificacion.trim().toLowerCase(),
  );
  if (!client)
    throw new DomainError(
      "CLIENT_NOT_FOUND",
      `No existe un cliente con identificación ${identificacion}.`,
      404,
    );
  return client;
}

export function importCharges(
  state: State,
  user: User,
  filas: Array<{
    identificacion: string;
    servicio: string;
    importe: number;
    fecha?: string;
    requerido?: boolean;
  }>,
) {
  assertAdmin(user);
  if (filas.length > MAX_IMPORT_ROWS)
    throw new DomainError(
      "IMPORT_TOO_LARGE",
      `Máximo ${MAX_IMPORT_ROWS} filas por importación.`,
      400,
    );
  const errores: ImportRowError[] = [];
  let creados = 0;
  filas.forEach((fila, index) => {
    try {
      assertImportAmount(fila.importe);
      const client = findClientByIdentificacion(state, fila.identificacion);
      collectorForClient(state, client.id);
      state.charges.push({
        id: randomUUID(),
        clientId: client.id,
        service: fila.servicio.trim(),
        amount: fila.importe,
        dueDate: fila.fecha ?? businessDate(),
        required: fila.requerido ?? false,
        collected: 0,
        status: "pending" as const,
      });
      creados += 1;
    } catch (error) {
      errores.push({
        fila: index + 1,
        mensaje: error instanceof Error ? error.message : "Fila inválida.",
      });
    }
  });
  return { creados, errores };
}

export function importPayouts(
  state: State,
  user: User,
  filas: Array<{
    identificacion: string;
    concepto: string;
    importe: number;
    cobrador?: string;
  }>,
) {
  assertAdmin(user);
  if (filas.length > MAX_IMPORT_ROWS)
    throw new DomainError(
      "IMPORT_TOO_LARGE",
      `Máximo ${MAX_IMPORT_ROWS} filas por importación.`,
      400,
    );
  const errores: ImportRowError[] = [];
  let creados = 0;
  filas.forEach((fila, index) => {
    try {
      assertImportAmount(fila.importe);
      const client = findClientByIdentificacion(state, fila.identificacion);
      const collectorId = collectorForClient(state, client.id);
      if (fila.cobrador && fila.cobrador !== collectorId)
        throw new DomainError(
          "ROUTE_MISMATCH",
          "El cobrador indicado no corresponde a la ruta del cliente.",
          422,
        );
      state.payouts.push({
        id: randomUUID(),
        clientId: client.id,
        collectorId,
        concept: fila.concepto.trim(),
        amount: fila.importe,
        paid: 0,
        status: "pending" as const,
      });
      creados += 1;
    } catch (error) {
      errores.push({
        fila: index + 1,
        mensaje: error instanceof Error ? error.message : "Fila inválida.",
      });
    }
  });
  return { creados, errores };
}

export function assertAdmin(user: User) {
  if (user.role !== "admin")
    throw new DomainError(
      "FORBIDDEN",
      "Esta acción requiere administración.",
      403,
    );
}
export function assertCollectorAccess(user: User, id: string) {
  if (user.role === "collector" && user.collectorId !== id)
    throw new DomainError(
      "FORBIDDEN",
      "Este cobrador no está asignado a tu cuenta.",
      403,
    );
}
export function collectorForClient(state: State, clientId: string) {
  const client = state.clients.find((c) => c.id === clientId);
  if (!client)
    throw new DomainError("NOT_FOUND", "Cliente no encontrado.", 404);
  return state.routes.find((r) => r.id === client.routeId)!.collectorId;
}
export function postMovement(
  state: State,
  user: User,
  type: Movement["type"],
  body: {
    amount: number;
    chargeId?: string;
    payoutId?: string;
    collectorId?: string;
  },
  now = new Date(),
) {
  let collectorId = body.collectorId,
    clientId: string | undefined,
    charge: Charge | undefined,
    payout: Payout | undefined;
  if (type === "collection") {
    charge = state.charges.find((c) => c.id === body.chargeId);
    if (!charge)
      throw new DomainError("NOT_FOUND", "Cargo no encontrado.", 404);
    collectorId = collectorForClient(state, charge.clientId);
    clientId = charge.clientId;
    if (
      charge.status === "cancelled" ||
      charge.collected + body.amount > charge.amount
    )
      throw new DomainError(
        "INVALID_AMOUNT",
        "El cobro supera el saldo pendiente.",
      );
  } else if (type === "payout") {
    payout = state.payouts.find((p) => p.id === body.payoutId);
    if (!payout)
      throw new DomainError("NOT_FOUND", "Descargo no encontrado.", 404);
    collectorId = payout.collectorId;
    clientId = payout.clientId;
    if (
      payout.status === "cancelled" ||
      payout.paid + body.amount > payout.amount
    )
      throw new DomainError(
        "INVALID_AMOUNT",
        "El pago supera el saldo autorizado.",
      );
  } else assertAdmin(user);
  const collector = state.collectors.find((c) => c.id === collectorId);
  if (!collector)
    throw new DomainError("NOT_FOUND", "Cobrador no encontrado.", 404);
  assertCollectorAccess(user, collector.id);
  const date = businessDate(now);
  if (
    state.settlements.some(
      (s) => s.collectorId === collector.id && s.date >= date,
    )
  )
    throw new DomainError("DAY_CLOSED", "La jornada ya está cerrada.", 409);
  // A new operating day cannot absorb an unresolved previous cash balance.
  const old = state.movements.filter(
    (m) =>
      m.collectorId === collector.id &&
      businessDate(new Date(m.createdAt)) < date,
  );
  if (old.length) {
    const oldState = { ...state, movements: old };
    if (preview(oldState, collector.id).difference !== 0)
      throw new DomainError(
        "PREVIOUS_DAY_OPEN",
        "Debes resolver el efectivo pendiente de la jornada anterior.",
        409,
      );
  }
  const balance = preview(state, collector.id);
  const collectionCash = balance.collected - balance.deposited,
    payoutCash = balance.officeDelivered - balance.paidToClients;
  if (
    type === "collection" &&
    collectionCash + body.amount > collector.collectionLimit
  )
    throw new DomainError(
      "COLLECTION_LIMIT",
      "Este cobro excede el límite de cobro. Deposita efectivo primero.",
      409,
    );
  if (
    type === "office_delivery" &&
    payoutCash + body.amount > collector.payoutLimit
  )
    throw new DomainError(
      "PAYOUT_LIMIT",
      "La entrega excede el límite de pago.",
      409,
    );
  if (type === "deposit" && body.amount > collectionCash)
    throw new DomainError(
      "INSUFFICIENT_COLLECTION_CASH",
      "El depósito supera el efectivo cobrado disponible.",
      409,
    );
  if (type === "payout" && body.amount > payoutCash)
    throw new DomainError(
      "INSUFFICIENT_PAYOUT_CASH",
      "No hay fondos de oficina suficientes para este pago.",
      409,
    );
  const movement: Movement = {
    id: randomUUID(),
    collectorId: collector.id,
    clientId,
    chargeId: charge?.id,
    payoutId: payout?.id,
    type,
    amount: body.amount,
    createdAt: now.toISOString(),
    actorId: user.id,
    ...(clientId
      ? {
          receiptToken: randomBytes(24).toString("base64url"),
          receiptRevoked: false,
        }
      : {}),
  };
  if (charge) {
    charge.collected += body.amount;
    charge.status = charge.collected === charge.amount ? "paid" : "partial";
  }
  if (payout) {
    payout.paid += body.amount;
    payout.status = payout.paid === payout.amount ? "paid" : "partial";
  }
  state.movements.push(movement);
  return movement;
}
export function closeDay(
  state: State,
  user: User,
  collectorId: string,
  date: string,
  now = new Date(),
) {
  assertAdmin(user);
  if (!state.collectors.some((c) => c.id === collectorId))
    throw new DomainError("NOT_FOUND", "Cobrador no encontrado.", 404);
  if (date > businessDate(now))
    throw new DomainError(
      "FUTURE_DATE",
      "No se puede cerrar una fecha futura.",
    );
  if (
    state.settlements.some(
      (s) => s.collectorId === collectorId && s.date === date,
    )
  )
    throw new DomainError("DAY_CLOSED", "La jornada ya está cerrada.", 409);
  const totals = preview(state, collectorId, date);
  if (totals.difference !== 0)
    throw new DomainError(
      "UNBALANCED",
      "El cuadre debe tener una diferencia exacta de RD$ 0.00.",
      409,
    );
  const settlement: Settlement = {
    id: randomUUID(),
    collectorId,
    date,
    ...totals,
    status: "closed",
    closedAt: now.toISOString(),
    actorId: user.id,
  };
  state.settlements.push(settlement);
  return settlement;
}
export function snapshot(state: State, user: User) {
  const allowed = (id: string) =>
    user.role === "admin" || user.collectorId === id;
  const routes = state.routes.filter((r) => allowed(r.collectorId));
  const clients = state.clients.filter((c) =>
    routes.some((r) => r.id === c.routeId),
  );
  const movements = state.movements
    .filter((m) => allowed(m.collectorId))
    .map(({ actorId, receiptRevoked, ...m }) => ({
      ...m,
      ...(receiptRevoked ? { receiptToken: undefined } : {}),
    }));
  const collectors = state.collectors
    .filter((c) => allowed(c.id))
    .map((c) => {
      const b = preview(state, c.id);
      return {
        ...c,
        cashInHand: b.difference,
        status: (b.collected - b.deposited >= c.collectionLimit ||
        b.officeDelivered - b.paidToClients >= c.payoutLimit
          ? "limit"
          : Date.now() - Date.parse(c.lastSeen) > 15 * 60 * 1000
            ? "offline"
            : c.status) as Collector["status"],
      };
    });
  const date = businessDate();
  const daily = movements.filter(
    (m) => businessDate(new Date(m.createdAt)) === date,
  );
  const sum = (type: Movement["type"]) =>
    daily
      .filter((m) => m.type === type && !m.cancelledAt)
      .reduce((s, m) => s + m.amount, 0);
  const collected = sum("collection"),
    paid = sum("payout"),
    deposited = sum("deposit"),
    officeDelivered = sum("office_delivery");
  const history = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 6 + i);
    const day = businessDate(d);
    const rows = movements.filter(
      (m) => businessDate(new Date(m.createdAt)) === day,
    );
    return {
      label: day.slice(5),
      collected: rows
        .filter((m) => m.type === "collection")
        .reduce((s, m) => s + m.amount, 0),
      paid: rows
        .filter((m) => m.type === "payout")
        .reduce((s, m) => s + m.amount, 0),
    };
  });
  return {
    businessDate: date,
    clients,
    routes,
    collectors,
    accounts:
      user.role === "admin"
        ? state.accounts.map(publicAccount)
        : state.accounts.filter((a) => a.id === user.id).map(publicAccount),
    charges: state.charges.filter((c) =>
      clients.some((cl) => cl.id === c.clientId),
    ),
    payouts: state.payouts.filter((p) => allowed(p.collectorId)),
    payoutRecurring:
      user.role === "admin" ? state.payoutRecurring : [],
    movements,
    settlements: state.settlements.filter((s) => allowed(s.collectorId)),
    totals: {
      collected,
      paid,
      deposited,
      officeDelivered,
      difference: collected - deposited + officeDelivered - paid,
      activeCollectors: collectors.filter((c) => c.status === "active").length,
    },
    history,
  };
}
