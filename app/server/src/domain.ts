import {
  randomUUID,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { RemittanceState } from "./remittances.js";
import { emptyAdminToolsState, type AdminToolsState } from "./admin-tools.js";
import type { AccountRole } from "./account-roles.js";

export type Role = AccountRole;
export const ledgerCurrencies = ["DOP", "USD", "EUR"] as const;
export type LedgerCurrency = (typeof ledgerCurrencies)[number];
// Missing currency in historical records means DOP. Never infer a ledger
// movement's currency from an obligation that may have been edited later.
const currencyAliases: Readonly<Record<string, LedgerCurrency>> = Object.freeze({
  dop: "DOP", "peso dominicano": "DOP", usd: "USD", "dólar americano": "USD", "dolar americano": "USD",
  "dólar estadounidense": "USD", "dolar estadounidense": "USD", eur: "EUR", euro: "EUR",
});
export function supportedLedgerCurrency(value?: string): LedgerCurrency | undefined {
  const name = (value ?? "DOP").trim().toLowerCase() || "dop";
  return Object.hasOwn(currencyAliases, name) ? currencyAliases[name] : undefined;
}
export function ledgerCurrency(value?: string): LedgerCurrency {
  const currency = supportedLedgerCurrency(value);
  if (!currency) throw new DomainError("INVALID_CURRENCY", "Selecciona DOP, USD o EUR.", 422);
  return currency;
}
export function obligationCurrencyConflict(state: State, row: Charge | Payout, type: "collection" | "payout") {
  const currency = supportedLedgerCurrency(row.currency);
  if (!currency) return true;
  const movements = state.movements.filter((movement) => movement.type === type &&
    (type === "collection" ? movement.chargeId === row.id : movement.payoutId === row.id));
  const nativeTotal = movements.filter((movement) => !movement.cancelledAt && ledgerCurrency(movement.currency) === currency)
    .reduce((total, movement) => total + movement.amount, 0);
  const aggregate = "collected" in row ? row.collected : row.paid;
  return movements.some((movement) => ledgerCurrency(movement.currency) !== currency) ||
    (currency !== "DOP" && aggregate !== nativeTotal);
}
export function financialObligation<T extends Charge | Payout>(state: State, row: T, type: "collection" | "payout"): Omit<T, "currency"> & {
  currency: string; currencyConflict?: true; currencyUnsupported?: true;
  collectedByCurrency?: Record<LedgerCurrency, number>; paidByCurrency?: Record<LedgerCurrency, number>;
} {
  const currencyConflict = obligationCurrencyConflict(state, row, type);
  const supported = supportedLedgerCurrency(row.currency);
  const byCurrency = Object.fromEntries(ledgerCurrencies.map((currency) => [currency,
    state.movements.filter((movement) => movement.type === type && !movement.cancelledAt && ledgerCurrency(movement.currency) === currency &&
      (type === "collection" ? movement.chargeId === row.id : movement.payoutId === row.id)).reduce((total, movement) => total + movement.amount, 0),
  ])) as Record<LedgerCurrency, number>;
  return { ...row, currency: supported ?? row.currency ?? "DOP", ...(!supported ? { currencyUnsupported: true as const } : {}), ...(currencyConflict ? {
    currencyConflict: true,
    ...(type === "collection" ? { collectedByCurrency: byCurrency } : { paidByCurrency: byCurrency }),
  } : {}) };
}
export type User = {
  id: string;
  name: string;
  role: Role;
  collectorId?: string;
};
export type Account = {
  id: string;
  name: string;
  nickname?: string;
  note?: string;
  permissionIds?: number[];
  permissionRevision?: number;
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
  internalIdentification?: string;
  active?: boolean;
  name: string;
  code: string;
  phone: string;
  address: string;
  routeId: string;
  preferredCurrency?: LedgerCurrency;
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
export type Service = {
  id: string; service: string; abbr: string; caption: string;
  obligated: boolean; fixedAmount: boolean; active: boolean;
  // Optional operator-entered references. They do not price obligations or move stock.
  referencePriceCents?: number | null;
  referenceCurrency?: LedgerCurrency | null;
  taxReference?: string | null;
  benefitReference?: string | null;
  referenceQuantity?: string | null;
};
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
  currency?: LedgerCurrency;
  dueDate?: string;
  amount: number;
  paid: number;
  status: Charge["status"];
};
export type DepositComponent = {
  method: "cash" | "cheque" | "bank_deposit";
  amount: number;
  bank?: string;
  reference?: string;
};
export type Bank = { id: string; name: string; active: boolean };
export type ClientIdentityReservation = {
  id: string; sequence: number; code: string; internalIdentification: string;
  actorId: string; createdAt: string; clientId?: string;
};
export type Movement = {
  id: string;
  collectorId: string;
  clientId?: string;
  chargeId?: string;
  payoutId?: string;
  type: "collection" | "deposit" | "office_delivery" | "payout";
  amount: number;
  currency?: LedgerCurrency;
  note?: string;
  bankId?: string;
  bankName?: string;
  reference?: string;
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
  depositComponents?: DepositComponent[];
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
  totalsByCurrency?: Record<LedgerCurrency, ReturnType<typeof preview>>;
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
  currency?: LedgerCurrency;
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
  banks: Bank[];
  clientIdentityReservations: ClientIdentityReservation[];
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
  banks: [],
  clientIdentityReservations: [],
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
export function preview(state: State, collectorId: string, date?: string, currency: LedgerCurrency = "DOP") {
  const rows = state.movements.filter(
    (m) =>
      m.collectorId === collectorId &&
      ledgerCurrency(m.currency) === currency &&
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
// Components describe one deposit; they do not introduce separate bank balances.
// Missing components preserve historical cash deposits and their fingerprints.
function depositCashAmount(amount: number, components?: DepositComponent[]) {
  if (components === undefined) return amount;
  if (!Array.isArray(components) || components.length < 1 || components.length > 20)
    throw new DomainError("DEPOSIT_COMPONENTS_INVALID", "Indica entre 1 y 20 componentes del depósito.", 422);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_MONEY_AMOUNT)
    throw new DomainError("DEPOSIT_COMPONENTS_INVALID", "El importe del depósito debe ser un entero positivo seguro en centavos.", 422);
  let total = 0n, cash = 0n;
  for (const component of components) {
    if (!component || !["cash", "cheque", "bank_deposit"].includes(component.method) ||
      !Number.isSafeInteger(component.amount) || component.amount <= 0 || component.amount > MAX_MONEY_AMOUNT)
      throw new DomainError("DEPOSIT_COMPONENTS_INVALID", "Cada componente necesita un método e importe positivo seguro en centavos.", 422);
    if (component.method === "cash") {
      if (component.bank !== undefined || component.reference !== undefined)
        throw new DomainError("DEPOSIT_COMPONENTS_INVALID", "El efectivo no utiliza banco ni referencia.", 422);
      cash += BigInt(component.amount);
    } else if (typeof component.bank !== "string" || !component.bank.trim() || component.bank.length > 160 ||
      typeof component.reference !== "string" || !component.reference.trim() || component.reference.length > 160)
      throw new DomainError("DEPOSIT_COMPONENTS_INVALID", "Indica banco y referencia para cheques y depósitos bancarios (máximo 160 caracteres).", 422);
    total += BigInt(component.amount);
  }
  if (total !== BigInt(amount))
    throw new DomainError("DEPOSIT_COMPONENTS_MISMATCH", "La suma de los componentes debe coincidir exactamente con el importe del depósito.", 422);
  return Number(cash);
}
function assertDenominations(amount: number, lines?: Array<{ denominacion: number; cantidad: number }>, exactEmpty = false) {
  if (lines === undefined || (!exactEmpty && !lines.length)) return;
  let total = 0;
  for (const line of lines) {
    const value = line.denominacion * line.cantidad;
    if (!Number.isSafeInteger(line.denominacion) || line.denominacion <= 0 ||
        !Number.isSafeInteger(line.cantidad) || line.cantidad < 0 ||
        !Number.isSafeInteger(value) || !Number.isSafeInteger(total + value))
      throw new DomainError("DEPOSIT_BREAKDOWN_INVALID", "El desglose contiene valores inválidos.", 422);
    total += value;
  }
  if (total !== amount)
    throw new DomainError("DEPOSIT_BREAKDOWN_MISMATCH", `El desglose de efectivo suma ${total} centavos; se esperan ${amount}.`, 422);
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
  const cashAmount = depositCashAmount(movement.amount, movement.depositComponents);
  assertDenominations(cashAmount, desglose, movement.depositComponents !== undefined);
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
    currency?: LedgerCurrency;
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
    currency: ledgerCurrency(input.currency),
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
    currency?: LedgerCurrency;
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
  if (cambio.currency !== undefined) template.currency = ledgerCurrency(cambio.currency);
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
  if (!canReadAdministration(user)) {
    if (user.role !== "collector") throw new DomainError("FORBIDDEN", "Esta cuenta no tiene acceso operativo.", 403);
    const collectorId = collectorForClient(state, clientId);
    if (user.collectorId !== collectorId)
      throw new DomainError(
        "FORBIDDEN",
        "Este cliente no pertenece a su ruta.",
        403,
      );
  }
  const cargos = state.charges.filter((c) => c.clientId === clientId).map((row) => financialObligation(state, row, "collection"));
  const autorizaciones = state.payouts.filter((p) => p.clientId === clientId).map((row) => financialObligation(state, row, "payout"));
  const cobros = state.movements.filter(
    (m) =>
      m.type === "collection" && m.clientId === clientId && !m.cancelledAt,
  );
  const pagos = state.movements.filter(
    (m) => m.type === "payout" && m.clientId === clientId && !m.cancelledAt,
  );
  const summarize = (currency: LedgerCurrency) => ({
    totalCargado: cargos.filter((c) => !c.currencyConflict && ledgerCurrency(c.currency) === currency).reduce((a, c) => a + c.amount, 0),
    totalCobrado: cobros.filter((m) => ledgerCurrency(m.currency) === currency).reduce((a, m) => a + m.amount, 0),
    totalPendiente: cargos.filter((c) => !c.currencyConflict && c.status !== "cancelled" && ledgerCurrency(c.currency) === currency).reduce((a, c) => a + Math.max(0, c.amount - c.collected), 0),
    totalAutorizado: autorizaciones.filter((p) => !p.currencyConflict && ledgerCurrency(p.currency) === currency).reduce((a, p) => a + p.amount, 0),
    totalPagadoACliente: pagos.filter((m) => ledgerCurrency(m.currency) === currency).reduce((a, m) => a + m.amount, 0),
  });
  return {
    client: { id: client.id, code: client.code, name: client.name },
    cargos,
    cobros,
    autorizaciones,
    pagos,
    resumen: summarize("DOP"),
    resumenByCurrency: Object.fromEntries(ledgerCurrencies.map((currency) => [currency, summarize(currency)])),
    currencyConflicts: [...cargos, ...autorizaciones].filter((row) => row.currencyConflict),
  };
}

export type ImportRowError = { fila: number; mensaje: string };

export const MAX_MONEY_AMOUNT = 1_000_000_000;
const MAX_IMPORT_ROWS = 1000;

function assertImportAmount(amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_MONEY_AMOUNT)
    throw new DomainError(
      "IMPORT_INVALID_AMOUNT",
      `El importe debe ser un entero seguro de 1 a ${MAX_MONEY_AMOUNT} centavos.`,
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
    moneda?: LedgerCurrency;
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
        currency: ledgerCurrency(fila.moneda),
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
    moneda?: LedgerCurrency;
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
        currency: ledgerCurrency(fila.moneda),
        dueDate: businessDate(),
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
export function canReadAdministration(user: User) {
  return user.role === "admin" || user.role === "supervisor";
}
export function assertAdminRead(user: User) {
  if (!canReadAdministration(user)) throw new DomainError("FORBIDDEN", "Esta consulta requiere administración o supervisión.", 403);
}
export function assertCollectorAccess(user: User, id: string) {
  if (user.role !== "admin" && !(user.role === "collector" && user.collectorId === id))
    throw new DomainError(
      "FORBIDDEN",
      "Este cobrador no está asignado a tu cuenta.",
      403,
    );
}
export function assertCollectorReadAccess(user: User, id: string) {
  if (!canReadAdministration(user)) assertCollectorAccess(user, id);
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
    currency?: LedgerCurrency;
    note?: string;
    bankId?: string;
    reference?: string;
    denominations?: Array<{ denominacion: number; cantidad: number }>;
    depositComponents?: DepositComponent[];
  },
  now = new Date(),
) {
  const bank = body.bankId ? state.banks.find((row) => row.id === body.bankId && row.active) : undefined;
  if (body.bankId && !bank) throw new DomainError("BANK_UNAVAILABLE", "Selecciona un banco activo del catálogo.", 422);
  if ((body.bankId || body.reference) && type !== "collection")
    throw new DomainError("COLLECTION_METADATA_ONLY", "El banco y la referencia corresponden a un cobro.", 422);
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
  } else if (type === "payout") {
    payout = state.payouts.find((p) => p.id === body.payoutId);
    if (!payout)
      throw new DomainError("NOT_FOUND", "Descargo no encontrado.", 404);
    collectorId = payout.collectorId;
    clientId = payout.clientId;
  } else assertAdmin(user);
  if ((charge && obligationCurrencyConflict(state, charge, "collection")) || (payout && obligationCurrencyConflict(state, payout, "payout")))
    throw new DomainError("LEGACY_CURRENCY_RECONCILIATION_REQUIRED", "La autorización tiene movimientos históricos en otra moneda. Requiere revisión administrativa antes de continuar; no se convirtió ni modificó ningún importe.", 409);
  const currency = type === "collection" ? ledgerCurrency(charge?.currency)
    : type === "payout" ? ledgerCurrency(payout?.currency) : ledgerCurrency(body.currency);
  if (body.currency !== undefined && ledgerCurrency(body.currency) !== currency)
    throw new DomainError("CURRENCY_MISMATCH", "La moneda debe coincidir con la autorización.", 422);
  if (user.role !== "admin" && currency !== "DOP")
    throw new DomainError("UNSUPPORTED_COLLECTOR_CURRENCY", "Este portal de cobrador opera en DOP; USD y EUR se registran desde administración.", 422);
  assertImportAmount(body.amount);
  if (charge && (charge.status === "cancelled" || charge.collected + body.amount > charge.amount))
    throw new DomainError("INVALID_AMOUNT", "El cobro supera el saldo pendiente.");
  if (payout && (payout.status === "cancelled" || payout.paid + body.amount > payout.amount))
    throw new DomainError("INVALID_AMOUNT", "El pago supera el saldo autorizado.");
  if (body.depositComponents !== undefined && type !== "deposit")
    throw new DomainError("DEPOSIT_COMPONENTS_INVALID", "Los componentes solo se permiten en depósitos.", 422);
  if (type === "deposit") {
    const cashAmount = depositCashAmount(body.amount, body.depositComponents);
    assertDenominations(cashAmount, body.denominations, body.depositComponents !== undefined);
  }
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
    if (ledgerCurrencies.some((unit) => preview(oldState, collector.id, undefined, unit).difference !== 0))
      throw new DomainError(
        "PREVIOUS_DAY_OPEN",
        "Debes resolver el efectivo pendiente de la jornada anterior.",
        409,
      );
  }
  const balance = preview(state, collector.id, undefined, currency);
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
    currency,
    ...(body.note ? { note: body.note } : {}),
    ...(bank ? { bankId: bank.id, bankName: bank.name } : {}),
    ...(body.reference ? { reference: body.reference } : {}),
    ...(body.denominations ? { denominations: body.denominations } : {}),
    ...(body.depositComponents ? { depositComponents: structuredClone(body.depositComponents) } : {}),
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
  input: { clientId: string; collectorId: string; currency?: LedgerCurrency; bankId?: string; reference?: string; note?: string; lines: Array<{ chargeId: string; amount: number }> },
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
    if (obligationCurrencyConflict(state, charge, "collection"))
      throw new DomainError("LEGACY_CURRENCY_RECONCILIATION_REQUIRED", "La autorización tiene una moneda histórica sin resolver. Requiere revisión administrativa; no se modificó ningún importe.", 409);
    if (ledgerCurrency(charge.currency) !== ledgerCurrency(input.currency))
      throw new DomainError("CURRENCY_MISMATCH", "Todos los cargos deben pertenecer a la moneda seleccionada.", 422);
  }
  // Validate the complete receipt before publishing any of its movements.
  const draft = structuredClone(state);
  const movements = input.lines.map((line) => postMovement(draft, user, "collection", {
    ...line, ...(input.bankId ? { bankId: input.bankId } : {}),
    ...(input.reference ? { reference: input.reference } : {}), ...(input.note ? { note: input.note } : {}),
  }, now));
  state.charges = draft.charges;
  state.movements = draft.movements;
  return movements;
}

export function createCentralPayments(
  state: State,
  user: User,
  input: { clientId: string; collectorId: string; currency?: LedgerCurrency; lines: Array<{ payoutId: string; amount: number }> },
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
    if (obligationCurrencyConflict(state, payout, "payout"))
      throw new DomainError("LEGACY_CURRENCY_RECONCILIATION_REQUIRED", "La autorización tiene una moneda histórica sin resolver. Requiere revisión administrativa; no se modificó ningún importe.", 409);
    if (ledgerCurrency(payout.currency) !== ledgerCurrency(input.currency))
      throw new DomainError("CURRENCY_MISMATCH", "Todos los descargos deben pertenecer a la moneda seleccionada.", 422);
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
  const balance = preview(state, collector.id, undefined, ledgerCurrency(movement.currency));
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
  const totalsByCurrency = Object.fromEntries(ledgerCurrencies.map((currency) => [currency, preview(state, collectorId, date, currency)])) as Record<LedgerCurrency, ReturnType<typeof preview>>;
  if (Object.values(totalsByCurrency).some((balance) => balance.difference !== 0))
    throw new DomainError(
      "UNBALANCED",
      "El cuadre debe tener una diferencia exacta de 0.00 en cada moneda (DOP, USD y EUR).",
      409,
    );
  const settlement: Settlement = {
    id: randomUUID(),
    collectorId,
    date,
    ...totals,
    totalsByCurrency,
    status: "closed",
    closedAt: now.toISOString(),
    actorId: user.id,
  };
  state.settlements.push(settlement);
  return settlement;
}
export function snapshot(state: State, user: User) {
  const administration = canReadAdministration(user);
  const allowed = (id: string) =>
    administration || (user.role === "collector" && user.collectorId === id);
  const routes = state.routes.filter((r) => allowed(r.collectorId));
  const clients = state.clients.filter((c) =>
    routes.some((r) => r.id === c.routeId),
  ).map((client) => ({ ...client, preferredCurrency: client.preferredCurrency ?? "DOP" }));
  const movements = state.movements
    .filter((m) => allowed(m.collectorId) && (administration || ledgerCurrency(m.currency) === "DOP"))
    .map(({ actorId, receiptRevoked, ...m }) => ({
      ...m,
      createdBy: actorId,
      createdByName: state.accounts.find((account) => account.id === actorId)?.name ?? actorId,
      currency: ledgerCurrency(m.currency),
      ...(receiptRevoked || m.cancelledAt ? { receiptToken: undefined } : {}),
    }));
  const collectors = state.collectors
    .filter((c) => allowed(c.id))
    .map((c) => {
      const b = preview(state, c.id);
      const balances = Object.fromEntries(ledgerCurrencies.map((currency) => [currency, preview(state, c.id, undefined, currency)]));
      return {
        ...c,
        cashInHand: b.difference,
        cashInHandByCurrency: Object.fromEntries(ledgerCurrencies.map((currency) => [currency, balances[currency].difference])),
        status: (c.active === false ? "offline" : (administration ? Object.values(balances) : [b]).some((balance) => balance.collected - balance.deposited >= c.collectionLimit ||
        balance.officeDelivered - balance.paidToClients >= c.payoutLimit)
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
  const sum = (type: Movement["type"], currency: LedgerCurrency = "DOP") =>
    daily
      .filter((m) => m.type === type && !m.cancelledAt && ledgerCurrency(m.currency) === currency)
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
      (m) => businessDate(new Date(m.createdAt)) === day && ledgerCurrency(m.currency) === "DOP",
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
    banks: state.banks,
    routes,
    zones: state.zones.filter((z) => administration || routes.some((r) => r.zoneId === z.id)),
    services: state.services,
    delayReasons: state.delayReasons,
    recurringCharges: administration ? state.recurringCharges.map((row) => ({ ...row, currency: supportedLedgerCurrency(row.currency) ?? row.currency, ...(!supportedLedgerCurrency(row.currency) ? { currencyUnsupported: true } : {}) })) : [],
    collectors,
    accounts:
      administration
        ? state.accounts.map(publicAccount)
        : state.accounts.filter((a) => a.id === user.id).map(publicAccount),
    charges: state.charges.filter((c) =>
      clients.some((cl) => cl.id === c.clientId) && (administration || supportedLedgerCurrency(c.currency) === "DOP"),
    ).map((c) => financialObligation(state, c, "collection")),
    payouts: state.payouts.filter((p) => allowed(p.collectorId) && (administration || supportedLedgerCurrency(p.currency) === "DOP")).map((p) => financialObligation(state, p, "payout")),
    payoutRecurring:
      administration ? state.payoutRecurring : [],
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
    totalsByCurrency: Object.fromEntries(ledgerCurrencies.map((currency) => {
      const collected = sum("collection", currency), paid = sum("payout", currency), deposited = sum("deposit", currency), officeDelivered = sum("office_delivery", currency);
      return [currency, { collected, paid, deposited, officeDelivered, difference: collected - deposited + officeDelivered - paid }];
    })),
    history,
  };
}
