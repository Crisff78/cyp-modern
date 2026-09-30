import {
  randomUUID,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { RemittanceState } from "./remittances.js";
import { emptyAdminToolsState, type AdminToolsState } from "./admin-tools.js";

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
  active?: boolean;
  name: string;
  code: string;
  phone: string;
  address: string;
  routeId: string;
  collectionPointId?: string;
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
  zoneId?: string;
  number?: string;
  from?: string;
  to?: string;
  active?: boolean;
};
export type Zone = { id: string; name: string; sector: string; number?: string; from?: string; to?: string; active?: boolean };
export type Service = { id: string; service: string; abbr: string; caption: string; obligated: boolean; fixedAmount: boolean; active: boolean };
export type DelayReason = { id: string; reason: string; active: boolean };
export type RecurringCharge = {
  id: string; clientId: string; routeId?: string; serviceId?: string;
  registeredAt: string; startDate: string; endDate: string; frequency: string;
  day1: string; day2: string; currency: string; service: string; concept: string;
  useConceptAmount: boolean; amount: number; note: string; active: boolean;
};
export type Collector = {
  id: string;
  name: string;
  initials: string;
  routeId: string;
  status: "active" | "offline" | "limit";
  collectionLimit: number;
  payoutLimit: number;
  lat: number | null;
  lng: number | null;
  lastSeen: string;
  active?: boolean;
  ident?: string;
  cellular?: string;
  accountId?: string;
};
export type Charge = {
  id: string;
  clientId: string;
  service: string;
  serviceId?: string;
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
  registeredCentrally?: boolean;
  acceptedAt?: string;
  acceptedBy?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  cancellationNote?: string;
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
export type MovementCancellation = {
  id: string;
  movementId: string;
  movementType: "collection" | "payout" | "office_delivery";
  reason: string;
  actorId: string;
  createdAt: string;
};
export type State = {
  remittances: RemittanceState;
  clients: Client[];
  clientMachines: ClientMachine[];
  clientMachineLogs: ClientMachineLog[];
  routes: Route[];
  zones: Zone[];
  services: Service[];
  delayReasons: DelayReason[];
  recurringCharges: RecurringCharge[];
  collectors: Collector[];
  charges: Charge[];
  payouts: Payout[];
  payoutRecurring: RecurringPayout[];
  movements: Movement[];
  depositEvents: DepositEvent[];
  movementCancellations: MovementCancellation[];
  settlements: Settlement[];
  idempotency: Idempotency[];
  accounts: Account[];
  adminTools: AdminToolsState;
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
  remittances: { rates: [], transfers: [], cashSessions: [], events: [] },
  clients: [],
  clientMachines: [],
  clientMachineLogs: [],
  routes: [],
  zones: [],
  services: [],
  delayReasons: [],
  recurringCharges: [],
  collectors: [],
  charges: [],
  payouts: [],
  payoutRecurring: [],
  movements: [],
  depositEvents: [],
  movementCancellations: [],
  settlements: [],
  idempotency: [],
  accounts: [],
  adminTools: emptyAdminToolsState(),
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
  if (collector.active === false)
    throw new DomainError("COLLECTOR_INACTIVE", "El cobrador está inactivo.", 409);
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
          registeredCentrally: user.role === "admin",
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
export function createCentralCollections(
  state: State,
  user: User,
  input: { clientId: string; collectorId: string; lines: Array<{ chargeId: string; amount: number }> },
  now = new Date(),
) {
  assertAdmin(user);
  const client = state.clients.find((item) => item.id === input.clientId);
  if (!client) throw new DomainError("NOT_FOUND", "Cliente no encontrado.", 404);
  const route = state.routes.find((item) => item.id === client.routeId);
  if (client.active === false || !route || route.active === false)
    throw new DomainError("CLIENT_ROUTE_INACTIVE", "El cliente necesita una ruta activa para registrar el cobro.", 409);
  if (route.collectorId !== input.collectorId)
    throw new DomainError("ROUTE_MISMATCH", "El cobrador seleccionado no corresponde a la ruta del cliente.", 422);
  if (!input.lines.length || input.lines.length > 100 || new Set(input.lines.map((line) => line.chargeId)).size !== input.lines.length)
    throw new DomainError("INVALID_COLLECTION_LINES", "Selecciona entre 1 y 100 cargos, sin repetirlos.", 422);
  for (const line of input.lines) {
    if (!Number.isSafeInteger(line.amount) || line.amount <= 0 || line.amount > 1_000_000_000)
      throw new DomainError("INVALID_AMOUNT", "El importe debe ser un entero positivo en centavos.", 422);
    const charge = state.charges.find((item) => item.id === line.chargeId);
    if (!charge || charge.clientId !== client.id)
      throw new DomainError("CHARGE_CLIENT_MISMATCH", "Todos los cargos deben pertenecer al cliente seleccionado.", 422);
    if (charge.currency && !["DOP", "Peso Dominicano"].includes(charge.currency))
      throw new DomainError("UNSUPPORTED_COLLECTION_CURRENCY", "Los cobros de esta caja se registran únicamente en pesos dominicanos.", 422);
  }
  // Validate the complete receipt before publishing any of its movements.
  const draft = structuredClone(state);
  const movements = input.lines.map((line) => postMovement(draft, user, "collection", line, now));
  state.charges = draft.charges;
  state.movements = draft.movements;
  return movements;
}

export function createCentralPayments(
  state: State,
  user: User,
  input: { clientId: string; collectorId: string; lines: Array<{ payoutId: string; amount: number }> },
  now = new Date(),
) {
  assertAdmin(user);
  const client = state.clients.find((item) => item.id === input.clientId);
  if (!client) throw new DomainError("NOT_FOUND", "Cliente no encontrado.", 404);
  if (client.active === false)
    throw new DomainError("CLIENT_INACTIVE", "El cliente debe estar activo para registrar el pago.", 409);
  const collector = state.collectors.find((item) => item.id === input.collectorId);
  if (!collector) throw new DomainError("NOT_FOUND", "Cobrador no encontrado.", 404);
  if (collector.active === false)
    throw new DomainError("COLLECTOR_INACTIVE", "El cobrador debe estar activo para registrar el pago.", 409);
  if (!input.lines.length || input.lines.length > 100 || new Set(input.lines.map((line) => line.payoutId)).size !== input.lines.length)
    throw new DomainError("INVALID_PAYMENT_LINES", "Selecciona entre 1 y 100 descargos, sin repetirlos.", 422);
  for (const line of input.lines) {
    if (!Number.isSafeInteger(line.amount) || line.amount <= 0 || line.amount > 1_000_000_000)
      throw new DomainError("INVALID_AMOUNT", "El importe debe ser un entero positivo en centavos.", 422);
    const payout = state.payouts.find((item) => item.id === line.payoutId);
    if (!payout || payout.clientId !== client.id)
      throw new DomainError("PAYOUT_CLIENT_MISMATCH", "Todos los descargos deben pertenecer al cliente seleccionado.", 422);
    if (payout.collectorId !== collector.id)
      throw new DomainError("PAYOUT_COLLECTOR_MISMATCH", "Todos los descargos deben corresponder al cobrador seleccionado.", 422);
  }
  // Publish the complete payment only after every line passes the ledger guards.
  const draft = structuredClone(state);
  const movements = input.lines.map((line) => postMovement(draft, user, "payout", line, now));
  state.payouts = draft.payouts;
  state.movements = draft.movements;
  return movements;
}

export function cancelMovement(
  state: State,
  user: User,
  movementId: string,
  type: MovementCancellation["movementType"],
  reason: string,
  now = new Date(),
) {
  assertAdmin(user);
  const movement = state.movements.find((item) => item.id === movementId && item.type === type);
  if (!movement) throw new DomainError("MOVEMENT_NOT_FOUND", "El movimiento no existe.", 404);
  const note = reason.trim();
  if (!note || note.length > 500)
    throw new DomainError("CANCELLATION_REASON_REQUIRED", "Escribe un motivo de anulación de hasta 500 caracteres.", 422);
  if (movement.cancelledAt) return movement;
  const date = businessDate(new Date(movement.createdAt));
  if (state.settlements.some((item) => item.collectorId === movement.collectorId && item.date >= date))
    throw new DomainError("DAY_CLOSED", "La jornada de este movimiento ya está cerrada; no se puede anular.", 409);
  if (date !== businessDate(now))
    throw new DomainError("CANCELLATION_DAY_MISMATCH", "Solo puedes anular movimientos de la jornada actual. Los movimientos de otra fecha requieren revisión administrativa.", 409);
  const collector = state.collectors.find((item) => item.id === movement.collectorId);
  if (!collector) throw new DomainError("NOT_FOUND", "Cobrador no encontrado.", 404);
  const balance = preview(state, collector.id);
  if (type === "collection" && balance.collected - balance.deposited < movement.amount)
    throw new DomainError("INSUFFICIENT_COLLECTION_CASH", "No se puede anular el cobro porque su efectivo ya fue depositado. Revisa primero los depósitos de esta jornada.", 409);
  if (type === "office_delivery" && balance.officeDelivered - balance.paidToClients < movement.amount)
    throw new DomainError("INSUFFICIENT_PAYOUT_CASH", "No se puede anular la entrega porque sus fondos ya se usaron para pagos. Revisa primero los pagos de esta jornada.", 409);
  if (type === "payout" && balance.officeDelivered - balance.paidToClients + movement.amount > collector.payoutLimit)
    throw new DomainError("PAYOUT_LIMIT", "Al anular este pago se superaría el límite de efectivo para pagos del cobrador. Revisa primero las entregas de esta jornada.", 409);
  const charge = type === "collection" ? state.charges.find((item) => item.id === movement.chargeId) : undefined;
  const payout = type === "payout" ? state.payouts.find((item) => item.id === movement.payoutId) : undefined;
  if ((type === "collection" && (!charge || charge.status === "cancelled" || charge.collected < movement.amount)) ||
      (type === "payout" && (!payout || payout.status === "cancelled" || payout.paid < movement.amount)))
    throw new DomainError("MOVEMENT_BALANCE_MISMATCH", "El saldo del movimiento no coincide con su cargo o autorización. Requiere revisión administrativa.", 409);
  const createdAt = now.toISOString();
  state.movementCancellations.push({ id: randomUUID(), movementId, movementType: type, reason: note, actorId: user.id, createdAt });
  movement.cancelledAt = createdAt;
  movement.cancelledBy = user.id;
  movement.cancellationNote = note;
  if (charge) {
    charge.collected -= movement.amount;
    charge.status = charge.collected === 0 ? "pending" : charge.collected === charge.amount ? "paid" : "partial";
  }
  if (payout) {
    payout.paid -= movement.amount;
    payout.status = payout.paid === 0 ? "pending" : payout.paid === payout.amount ? "paid" : "partial";
  }
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
      ...(receiptRevoked || m.cancelledAt ? { receiptToken: undefined } : {}),
    }));
  const collectors = state.collectors
    .filter((c) => allowed(c.id))
    .map((c) => {
      const b = preview(state, c.id);
      return {
        ...c,
        cashInHand: b.difference,
        status: (c.active === false ? "offline" : b.collected - b.deposited >= c.collectionLimit ||
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
        .filter((m) => m.type === "collection" && !m.cancelledAt)
        .reduce((s, m) => s + m.amount, 0),
      paid: rows
        .filter((m) => m.type === "payout" && !m.cancelledAt)
        .reduce((s, m) => s + m.amount, 0),
    };
  });
  return {
    businessDate: date,
    clients,
    routes,
    zones: state.zones.filter((z) => user.role === "admin" || routes.some((r) => r.zoneId === z.id)),
    services: state.services,
    delayReasons: state.delayReasons,
    recurringCharges: user.role === "admin" ? state.recurringCharges : [],
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
