/**
 * Synthetic, append-only review data. Never loads .env or prints credentials.
 * Run with the installed tsx CLI; inject DATABASE_URL through the local launcher.
 * Default: --dry-run. To write: --apply --credentials-file <new file in private dir>.
 * Optional: --admin-id configured-admin --with-review-admin --expected-database cyp.
 * A single transaction owns all DB additions and the review-v1-seed-v1 marker.
 * Reversal after commit requires the operator's verified pre-seed DB backup;
 * this script deliberately has no delete/rollback that bypasses immutable ledgers.
 */
import { createHash, randomBytes } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, parse, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  acceptDeposit, businessDate, cancelDeposit, closeDay, createRecurringPayout,
  DomainError, hashPassword, postMovement, preview,
  type Account, type Charge, type Movement, type Payout, type State, type User,
} from "../src/domain.js";
import {
  cancelRemittance, cashBalance, closeRemittanceCash, createRemittance,
  openRemittanceCash, payRemittance, quoteRemittance, setDailyRate,
  type QuoteInput,
} from "../src/remittances.js";
import { PostgresStore } from "../src/store.js";

const namespace = "review-v1-";
const markerId = `${namespace}seed-v1`;
const sampleNote = "DATOS SINTÉTICOS PRUEBA CYP. GPS DE MUESTRA: no representa un cliente ni una ubicación real.";
type Credential = { id: string; email: string; password: string; role: "admin" | "collector" };
type Options = { apply: boolean; adminId: string; withReviewAdmin: boolean; credentialsFile?: string; expectedDatabase: string };
type Row = { id: string; [key: string]: unknown };
type Summary = {
  status: "DRY_RUN" | "APPLIED" | "ALREADY_APPLIED";
  namespace: string; businessDate: string; historicalDate: string;
  added: Record<string, number>; preservedExistingRows: number;
  credentialsWritten: boolean; warnings: string[];
};
class SeedError extends Error {
  constructor(public code: string) { super(code); }
}
const fail = (code: string): never => { throw new SeedError(code); };
const id = (suffix: string) => `${namespace}${suffix}`;
const fingerprint = (options: Options) => createHash("sha256").update(JSON.stringify({
  version: 1, namespace, adminId: options.adminId, withReviewAdmin: options.withReviewAdmin,
})).digest("hex");
const json = (value: unknown) => JSON.stringify(value);
const progress = { databaseCommitted: false, credentialsCreated: false };

function parseOptions(args: string[]): Options {
  const options: Options = { apply: false, adminId: "configured-admin", withReviewAdmin: false, expectedDatabase: "cyp" };
  let mode: string | undefined;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (seen.has(argument)) fail("DUPLICATE_ARGUMENT");
    seen.add(argument);
    if (argument === "--apply" || argument === "--dry-run") {
      if (mode) fail("CONFLICTING_MODE");
      mode = argument; options.apply = argument === "--apply";
    } else if (argument === "--with-review-admin") options.withReviewAdmin = true;
    else if (argument === "--admin-id" || argument === "--credentials-file" || argument === "--expected-database") {
      const value = args[++index];
      if (!value || value.startsWith("--")) fail("MISSING_ARGUMENT_VALUE");
      if (argument === "--admin-id") options.adminId = value;
      else if (argument === "--expected-database") options.expectedDatabase = value;
      else options.credentialsFile = resolve(value);
    } else fail("UNKNOWN_ARGUMENT");
  }
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(options.adminId)) fail("INVALID_ADMIN_ID");
  if (!/^[A-Za-z0-9_-]{1,63}$/.test(options.expectedDatabase)) fail("INVALID_EXPECTED_DATABASE");
  return options;
}

function assertPersistedPreserved(before: State, after: State) {
  const current = collections(after);
  for (const [key, rows] of collections(before)) {
    const byId = new Map((current.get(key) ?? []).map((row) => [row.id, row]));
    for (const row of rows) if (json(row) !== json(byId.get(row.id))) fail("POSTCHECK_EXISTING_ROW_CHANGED");
  }
  if (json(before.systemConfig) !== json(after.systemConfig)) fail("POSTCHECK_EXISTING_CONFIG_CHANGED");
}

function assertNewRowsPersisted(before: State, expected: State, actual: State) {
  const baseline = collections(before), saved = collections(actual);
  const contains = (wanted: unknown, received: unknown): boolean => {
    if (wanted && typeof wanted === "object" && !Array.isArray(wanted))
      return !!received && typeof received === "object" && Object.entries(wanted).every(([key, value]) =>
        contains(value, (received as Record<string, unknown>)[key]));
    if (Array.isArray(wanted)) return Array.isArray(received) && wanted.length === received.length && wanted.every((value, index) => contains(value, received[index]));
    return wanted === received;
  };
  for (const [key, rows] of collections(expected)) {
    const oldIds = new Set((baseline.get(key) ?? []).map((row) => row.id));
    const savedById = new Map((saved.get(key) ?? []).map((row) => [row.id, row]));
    for (const row of rows.filter((row) => !oldIds.has(row.id))) {
      const persisted = savedById.get(row.id);
      // PostgreSQL fills defaults and returns some timestamps as Date objects.
      if (!persisted || !contains(JSON.parse(json(row)), JSON.parse(json(persisted)))) fail("POSTCHECK_NEW_ROW_MISMATCH");
    }
  }
}

function collections(state: State): Map<string, Row[]> {
  const result = new Map<string, Row[]>();
  for (const [key, value] of Object.entries(state)) {
    if (Array.isArray(value)) result.set(key, value as Row[]);
  }
  for (const [key, value] of Object.entries(state.remittances)) result.set(`remittances.${key}`, value as Row[]);
  return result;
}

function assertExistingPreserved(before: State, after: State) {
  let count = 0;
  const next = collections(after);
  for (const [key, rows] of collections(before)) {
    const current = next.get(key);
    if (!current || current.length < rows.length) fail("EXISTING_COLLECTION_CHANGED");
    for (let index = 0; index < rows.length; index++) {
      if (json(rows[index]) !== json(current[index])) fail("EXISTING_ROW_CHANGED");
      count++;
    }
  }
  for (const [key, value] of Object.entries(before)) {
    if (key !== "remittances" && !Array.isArray(value) && json(value) !== json((after as unknown as Record<string, unknown>)[key]))
      fail("EXISTING_METADATA_CHANGED");
  }
  return count;
}

/** Give every new domain-generated row a review namespace before persistence. */
function namespaceNewRows(before: State, state: State) {
  const old = collections(before), current = collections(state), replacements = new Map<string, string>();
  for (const [key, rows] of current) {
    const oldLength = old.get(key)?.length ?? 0;
    rows.slice(oldLength).forEach((row, index) => {
      if (!row.id.startsWith(namespace)) replacements.set(row.id, id(`${key.replaceAll(".", "-")}-${index + 1}`));
    });
  }
  const replace = (value: unknown): unknown => {
    if (typeof value === "string") return replacements.get(value) ?? value;
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
    return value;
  };
  for (const [key, rows] of current) {
    const oldLength = old.get(key)?.length ?? 0;
    for (let index = oldLength; index < rows.length; index++) rows[index] = replace(rows[index]) as Row;
    const ids = rows.map((row) => row.id);
    if (new Set(ids).size !== ids.length) fail("DUPLICATE_GENERATED_ID");
  }
}

function assertFreshNamespace(state: State) {
  for (const rows of collections(state).values()) {
    if (rows.some((row) => row.id.startsWith(namespace))) fail("NAMESPACE_ALREADY_PRESENT_WITHOUT_MARKER");
  }
}

function createAccounts(state: State, options: Options, now: Date) {
  const credentials: Credential[] = [];
  for (const position of [1, 2, ...(options.withReviewAdmin ? [0] : [])]) {
    const role = position === 0 ? "admin" as const : "collector" as const;
    const accountId = id(position === 0 ? "admin" : `operator-${position}`);
    const email = `${accountId}@example.invalid`;
    if (state.accounts.some((account) => account.id === accountId || account.email.toLowerCase() === email)) fail("ACCOUNT_COLLISION");
    const password = options.apply ? randomBytes(24).toString("base64url") : "";
    const secret = options.apply ? hashPassword(password) : { salt: "DRY_RUN", passwordHash: "DRY_RUN_NOT_A_CREDENTIAL" };
    const account: Account = {
      id: accountId, name: `Prueba CyP ${position === 0 ? "Administración" : `Operador ${position}`}`,
      email, role, ...(position ? { collectorId: id(`collector-${position}`) } : {}),
      ...secret, credentialVersion: 1, status: "active", createdAt: now.toISOString(), updatedAt: now.toISOString(),
    };
    state.accounts.push(account);
    if (options.apply) credentials.push({ id: accountId, email, password, role });
  }
  return credentials;
}

function addCharge(state: State, suffix: string, clientId: string, amount: number, dueDate: string, status: Charge["status"] = "pending") {
  const row: Charge = { id: id(suffix), clientId, service: "Prueba CyP servicio de revisión",
    serviceId: id("service-1"),
    concept: "Ejercicio sintético de cobro", currency: "DOP", note: sampleNote,
    amount, collected: 0, dueDate, required: true, status,
    ...(status === "cancelled" ? { cancelReason: "Cancelación de muestra, sin cobro." } : {}),
  };
  state.charges.push(row); return row;
}
function addPayout(state: State, suffix: string, clientId: string, collectorId: string, amount: number, concept: string) {
  const row: Payout = { id: id(suffix), clientId, collectorId, concept: `Prueba CyP ${concept}`, amount, paid: 0, status: "pending" };
  state.payouts.push(row); return row;
}
function acceptNewDeposit(state: State, admin: User, movement: Movement, at: Date) {
  const eventCount = state.depositEvents.length;
  acceptDeposit(state, admin, movement.id, [{ denominacion: 10000, cantidad: movement.amount / 10000 }]);
  // The domain has no injected clock here; only newly created synthetic rows are dated.
  for (const event of state.depositEvents.slice(eventCount)) event.createdAt = at.toISOString();
  movement.acceptedAt = at.toISOString();
}

export function buildReviewSeed(state: State, options: Options, now = new Date()): { summary: Summary; credentials: Credential[] } {
  const marker = state.idempotency.find((row) => row.id === markerId);
  if (marker) {
    if (marker.fingerprint !== fingerprint(options)) fail("SEED_OPTIONS_DIFFER_FROM_COMMITTED_MARKER");
    const prior = marker.response as Summary;
    return { summary: { ...prior, status: "ALREADY_APPLIED", credentialsWritten: false,
      added: Object.fromEntries(Object.keys(prior.added).map((key) => [key, 0])),
      preservedExistingRows: [...collections(state).values()].reduce((count, rows) => count + rows.length, 0),
    }, credentials: [] };
  }
  assertFreshNamespace(state);
  const before = structuredClone(state);
  const today = businessDate(now), yesterday = businessDate(new Date(now.getTime() - 86400000));
  const historical = new Date(`${yesterday}T16:00:00.000Z`);
  const existingAdmin = state.accounts.find((account) => account.id === options.adminId);
  if (existingAdmin ? existingAdmin.role !== "admin" || existingAdmin.status !== "active" : options.adminId !== "configured-admin")
    fail("ADMIN_ACTOR_NOT_AVAILABLE");
  const admin: User = { id: options.adminId, name: existingAdmin?.name ?? "Administración", role: "admin" };
  const warnings = ["GPS sintético marcado; no corresponde a personas reales.", "Anticipos representados como descargos autorizados; no existe un libro independiente de anticipos."];
  state.services.push({ id: id("service-1"), service: "Prueba CyP servicio de revisión", abbr: "PCYP",
    caption: "Servicio sintético para probar cobros", obligated: true, fixedAmount: false, active: true });
  state.delayReasons.push({ id: id("delay-reason-1"), reason: "Prueba CyP visita pendiente de muestra", active: true });
  for (const position of [1, 2]) {
    state.zones.push({ id: id(`zone-${position}`), name: `Prueba CyP Zona ${position}`, sector: `Prueba CyP Zona sintética ${position}`, active: true });
    state.collectors.push({ id: id(`collector-${position}`), name: `Prueba CyP Cobrador ${position}`,
      initials: `P${position}`, routeId: id(`route-${position}`), status: "active", active: true, collectionLimit: 2000000,
      payoutLimit: 1000000, lat: 18.47 + position * 0.015, lng: -69.94 + position * 0.01, lastSeen: now.toISOString() });
    state.routes.push({ id: id(`route-${position}`), zoneId: id(`zone-${position}`), name: `Prueba CyP Ruta ${position}`,
      sector: `Prueba CyP Zona sintética ${position}`, collectorId: id(`collector-${position}`) });
  }
  for (let position = 1; position <= 8; position++) {
    state.clients.push({ id: id(`client-${position}`), code: `REVIEW-V1-${String(position).padStart(2, "0")}`,
      collectionPointId: id(`point-${position}`),
      name: `Prueba CyP Cliente ${position}`, phone: "", address: `Dirección sintética ${position} · GPS de muestra`,
      routeId: id(`route-${position <= 4 ? 1 : 2}`), alias: `Muestra ${position}`, sector: "GPS de muestra",
      cellular: "", email: "", identification: "", note: sampleNote, active: position !== 8,
      lat: Number((18.475 + position * 0.004).toFixed(6)), lng: Number((-69.945 + position * 0.003).toFixed(6)) });
  }
  const credentials = createAccounts(state, options, now);
  const operators: User[] = [1, 2].map((position) => ({ id: id(`operator-${position}`), name: `Prueba CyP Operador ${position}`,
    role: "collector", collectorId: id(`collector-${position}`) }));
  for (const [index, actor] of operators.entries()) {
    const position = index + 1, first = index * 4 + 1, collectorId = actor.collectorId!;
    const historicalCharge = addCharge(state, `charge-history-${position}`, id(`client-${first}`), 100000, yesterday);
    const historicalPayout = addPayout(state, `payout-history-${position}`, id(`client-${first + 1}`), collectorId, 40000, "pago histórico sintético");
    postMovement(state, actor, "collection", { chargeId: historicalCharge.id, amount: 100000 }, historical);
    postMovement(state, admin, "office_delivery", { collectorId, amount: 40000 }, historical);
    postMovement(state, actor, "payout", { payoutId: historicalPayout.id, amount: 40000 }, historical);
    const pastDeposit = postMovement(state, admin, "deposit", { collectorId, amount: 100000 }, historical);
    acceptNewDeposit(state, admin, pastDeposit, historical);
    closeDay(state, admin, collectorId, yesterday, historical);

    const paidCharge = addCharge(state, `charge-paid-${position}`, id(`client-${first}`), 120000, today);
    const partialCharge = addCharge(state, `charge-partial-${position}`, id(`client-${first + 1}`), 150000, today);
    addCharge(state, `charge-pending-${position}`, id(`client-${first + 2}`), 90000, businessDate(new Date(now.getTime() - 3 * 86400000)));
    addCharge(state, `charge-cancelled-${position}`, id(`client-${first + 3}`), 50000, today, "cancelled");
    postMovement(state, actor, "collection", { chargeId: paidCharge.id, amount: 120000 }, now);
    postMovement(state, actor, "collection", { chargeId: partialCharge.id, amount: 60000 }, now);
    const partialPayout = addPayout(state, `payout-partial-${position}`, id(`client-${first}`), collectorId, 60000, "descargo parcial sintético");
    const advance = addPayout(state, `payout-advance-${position}`, id(`client-${first + 1}`), collectorId, 50000, "anticipo sintético autorizado");
    addPayout(state, `payout-pending-${position}`, id(`client-${first + 2}`), collectorId, 80000, "descargo pendiente sintético");
    postMovement(state, admin, "office_delivery", { collectorId, amount: 100000 }, now);
    postMovement(state, actor, "payout", { payoutId: partialPayout.id, amount: 20000 }, now);
    postMovement(state, actor, "payout", { payoutId: advance.id, amount: 50000 }, now);
    const accepted = postMovement(state, admin, "deposit", { collectorId, amount: 100000 }, now);
    acceptNewDeposit(state, admin, accepted, now);
    postMovement(state, admin, "deposit", { collectorId, amount: 30000 }, now);
    const cancelled = postMovement(state, admin, "deposit", { collectorId, amount: 10000 }, now);
    const priorEvents = state.depositEvents.length;
    cancelDeposit(state, admin, cancelled.id);
    cancelled.cancelledAt = now.toISOString();
    for (const event of state.depositEvents.slice(priorEvents)) event.createdAt = now.toISOString();
    const recurring = createRecurringPayout(state, admin, { clientId: id(`client-${first}`), concept: "Prueba CyP pago recurrente sintético",
      amount: 35000, frequency: position === 1 ? "weekly" : "monthly", nextRunDate: businessDate(new Date(now.getTime() + 7 * 86400000)) });
    recurring.createdAt = now.toISOString();
    state.recurringCharges.push({ id: id(`recurring-charge-${position}`), clientId: id(`client-${first}`),
      routeId: id(`route-${position}`), serviceId: id("service-1"), registeredAt: now.toISOString(),
      startDate: today, endDate: "", frequency: position === 1 ? "Semanal" : "Mensual", day1: "1", day2: "",
      currency: "Peso Dominicano", service: "Prueba CyP servicio de revisión", concept: "Cuota sintética de revisión",
      useConceptAmount: false, amount: 45000, note: sampleNote, active: true });
    const machineId = id(`machine-${position}`);
    state.clientMachines.push({ id: machineId, clientId: id(`client-${first}`), number: 1, entry: "1300", exit: "800", value: 100,
      percentage: 10, registeredAt: historical.toISOString(), updatedAt: now.toISOString() });
    for (const [logIndex, at] of [historical, now].entries()) state.clientMachineLogs.push({ id: id(`machine-log-${position}-${logIndex}`),
      clientId: id(`client-${first}`), machineId, registeredAt: at.toISOString(), previousEntry: logIndex ? "1000" : "0",
      entry: logIndex ? "1300" : "1000", entryDifference: logIndex ? "300" : "1000", previousExit: logIndex ? "600" : "0",
      exit: logIndex ? "800" : "600", exitDifference: logIndex ? "200" : "600", difference: logIndex ? "100" : "400",
      currency: "DOP", amount: logIndex ? 10000 : 40000, percentage: 10, charge: logIndex ? 1000 : 4000 });
    if (preview(state, collectorId, yesterday).difference !== 0 || preview(state, collectorId, today).difference !== 80000)
      fail("SYNTHETIC_CASH_INVARIANT_FAILED");
  }

  for (const at of [historical, now]) for (const [currency, rate] of [["USD", "60.000000"], ["EUR", "65.000000"]] as const) {
    if (!state.remittances.rates.some((row) => row.currency === currency && row.date === businessDate(at)))
      setDailyRate(state, admin, { currency, rate, date: businessDate(at) }, at);
  }
  const create = (sender: User, recipient: number, input: QuoteInput, at: Date) => {
    const quote = quoteRemittance(state, input, at);
    return createRemittance(state, admin, { ...input, senderClientId: id(`client-${sender.id === operators[0].id ? 1 : 5}`),
      recipientClientId: id(`client-${recipient}`), sendingUserId: sender.id, quote: quote.quote, note: sampleNote }, operators, at);
  };
  for (const actor of operators) openRemittanceCash(state, admin, { operatorId: actor.id, currency: "DOP", openingAmount: 200000 }, operators, historical);
  const historicalPaid = create(operators[0], 5, { sourceCurrency: "DOP", destinationCurrency: "DOP", amount: 75000 }, historical);
  payRemittance(state, operators[1], historicalPaid.id, new Date(historical.getTime() + 90000));
  const historicalCancelled = create(operators[0], 5, { sourceCurrency: "DOP", destinationCurrency: "DOP", amount: 50000 }, historical);
  cancelRemittance(state, admin, historicalCancelled.id, "Prueba CyP devolución histórica sintética", historical);
  for (const cash of state.remittances.cashSessions.filter((row) => operators.some((actor) => actor.id === row.operatorId) && row.date === yesterday))
    closeRemittanceCash(state, admin, cash.id, cashBalance(state, cash).expected, new Date(historical.getTime() + 180000));
  for (const actor of operators) for (const currency of ["DOP", "USD", "EUR"] as const)
    openRemittanceCash(state, admin, { operatorId: actor.id, currency, openingAmount: currency === "DOP" ? 2000000 : 50000 }, operators, now);
  create(operators[0], 5, { sourceCurrency: "DOP", destinationCurrency: "DOP", amount: 100000 }, now);
  for (const currency of ["USD", "EUR"] as const) {
    let input: QuoteInput = { sourceCurrency: currency, destinationCurrency: "DOP", amount: 10000 };
    try { quoteRemittance(state, input, now); }
    catch (error) {
      if (!(error instanceof DomainError) || !["MONEY_RANGE", "AMOUNT_TOO_SMALL"].includes(error.code)) throw error;
      warnings.push(`Muestra ${currency} sustituida por DOP: se conservó la tasa existente fuera del rango útil para el ejemplo.`);
      input = { sourceCurrency: "DOP", destinationCurrency: "DOP", amount: 75000 };
    }
    create(operators[0], 6, input, now);
  }
  const paid = create(operators[1], 1, { sourceCurrency: "DOP", destinationCurrency: "DOP", amount: 25000 }, now);
  payRemittance(state, operators[0], paid.id, now);
  const cancelled = create(operators[0], 5, { sourceCurrency: "DOP", destinationCurrency: "DOP", amount: 15000 }, now);
  cancelRemittance(state, operators[0], cancelled.id, "Prueba CyP devolución sintética", now);
  namespaceNewRows(before, state);
  const preservedExistingRows = assertExistingPreserved(before, state);
  const initial = collections(before);
  const added = Object.fromEntries([...collections(state)].map(([key, rows]) => [key, rows.length - (initial.get(key)?.length ?? 0)]));
  added.idempotency = 1;
  const summary: Summary = { status: options.apply ? "APPLIED" : "DRY_RUN", namespace, businessDate: today, historicalDate: yesterday,
    added, preservedExistingRows, credentialsWritten: options.apply, warnings };
  state.idempotency.push({ id: markerId, fingerprint: fingerprint(options), response: summary, createdAt: now.toISOString() });
  assertExistingPreserved(before, state);
  return { summary, credentials };
}

async function assertNoSymlink(path: string) {
  let current = path;
  while (true) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) fail("CREDENTIAL_PATH_REPARSE_POINT");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function assertPrivateWindowsAcl(path: string, protectedDirectory: boolean) {
    const script = "$ErrorActionPreference='Stop'; $acl=Get-Acl -LiteralPath $env:CYP_REVIEW_PRIVATE_PATH; $me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $allowed=@($me,'S-1-5-18','S-1-5-32-544'); if($env:CYP_REVIEW_PROTECTED -eq '1' -and -not $acl.AreAccessRulesProtected){exit 2}; if($allowed -notcontains $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value){exit 4}; foreach($rule in $acl.Access){if($rule.AccessControlType -eq 'Allow'){$sid=$rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;if($allowed -notcontains $sid){exit 3}}}; 'PRIVATE_OK'";
    const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, PSModulePath: `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\Modules`, CYP_REVIEW_PRIVATE_PATH: path, CYP_REVIEW_PROTECTED: protectedDirectory ? "1" : "0" },
      encoding: "utf8", timeout: 15000, windowsHide: true,
    });
    if (result.error || result.status !== 0 || result.stdout.trim() !== "PRIVATE_OK") fail("CREDENTIAL_DIRECTORY_NOT_PRIVATE");
}

async function assertPrivateDirectory(directory: string) {
  await assertNoSymlink(directory);
  const stat = await lstat(directory);
  if (!stat.isDirectory()) fail("CREDENTIAL_PARENT_NOT_DIRECTORY");
  if (process.platform === "win32") assertPrivateWindowsAcl(directory, true);
  else if ((stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) fail("CREDENTIAL_DIRECTORY_NOT_PRIVATE");
}

async function writeCredentials(path: string, credentials: Credential[]) {
  if (!isAbsolute(path) || path === parse(path).root) fail("INVALID_CREDENTIAL_PATH");
  await assertPrivateDirectory(dirname(path));
  const handle = await open(path, "wx", 0o600);
  progress.credentialsCreated = true;
  try {
    if (process.platform === "win32") assertPrivateWindowsAcl(path, false);
    else if (((await handle.stat()).mode & 0o077) !== 0) fail("CREDENTIAL_FILE_NOT_PRIVATE");
    await handle.writeFile(JSON.stringify({ purpose: "Accesos locales sintéticos Prueba CyP; conservar en privado y retirar al finalizar la revisión.",
      namespace, accounts: credentials }, null, 2), "utf8");
    await handle.sync();
  } finally { await handle.close(); }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail("DATABASE_URL_REQUIRED_IN_PROCESS_ENVIRONMENT");
  const destination = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(destination.protocol) ||
      !["localhost", "127.0.0.1", "[::1]", "::1"].includes(destination.hostname) ||
      destination.searchParams.has("host") || destination.searchParams.has("hostaddr")) fail("ONLY_LOCAL_POSTGRES_ALLOWED");
  if (decodeURIComponent(destination.pathname.slice(1)) !== options.expectedDatabase) fail("DATABASE_NAME_MISMATCH");
  const store = new PostgresStore(databaseUrl);
  try {
    if (!options.apply) {
      const state = await store.read();
      const result = buildReviewSeed(structuredClone(state), options);
      console.log(JSON.stringify(result.summary, null, 2));
    } else {
      let baseline: State | undefined, expected: State | undefined;
      const result = await store.transaction(async (state) => {
        baseline = structuredClone(state);
        const planned = buildReviewSeed(state, options);
        expected = structuredClone(state);
        if (planned.summary.status !== "ALREADY_APPLIED") {
          if (!options.credentialsFile) fail("APPLY_REQUIRES_PRIVATE_CREDENTIALS_FILE");
          await writeCredentials(options.credentialsFile, planned.credentials);
        }
        return planned.summary;
      });
      progress.databaseCommitted = true;
      const persisted = await store.read();
      assertPersistedPreserved(baseline!, persisted);
      assertNewRowsPersisted(baseline!, expected!, persisted);
      const marker = persisted.idempotency.find((row) => row.id === markerId);
      if (!marker || marker.fingerprint !== fingerprint(options)) fail("POSTCHECK_SEED_MARKER_MISSING");
      console.log(JSON.stringify(result, null, 2));
    }
  } finally { await store.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    // Do not print SQL, connection strings, account data, secrets or raw errors.
    const code = error instanceof SeedError ? error.code : error instanceof DomainError ? error.code : "SEED_FAILED";
    console.error(JSON.stringify({ status: progress.databaseCommitted ? "COMMITTED_POSTCHECK_FAILED" : "FAILED_OR_UNCONFIRMED", code, ...progress,
      action: "Revisa localmente el estado y el archivo privado antes de reintentar. No se imprime el error original." }));
    process.exitCode = 1;
  });
}
