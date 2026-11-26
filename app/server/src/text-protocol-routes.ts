// Plain-text protocol for the mobile application: the petitions of docs/protocolo-cyp/Protocolo CYP 0.11.txt.
// Each one is a thin adapter in front of the same functions the JSON API uses; no rule of the business lives here.
// Two things are its own: the idCliente (the number of the internal identification of the client instead of its id,
// clientIds and clientOf) and, in Entregar Envío, the order of its checks and the idOperacion that tells a repetition
// from another attempt (pay).
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { businessDate, DomainError, type State, type User } from "./domain.js";
import type { Store } from "./store.js";
import { assertAuthSession, endOwnAuthSession, recordMutationTrace } from "./admin-tools.js";
import { authorizeRequest, currentAccessUser, guardCatalogChanges, requireRemittancePermission } from "./access.js";
import { listRemittanceClients, remittanceClientContact } from "./remittance-client-search.js";
import { pendingDeliveries } from "./remittance-delivery-search.js";
import {
  canSeeOutgoing, createRemittance, currencies, deliverableByReference, payoutOf, payRemittance, quoteRemittance, ratesInForce,
  type AmountMode, type Currency, type Remittance,
} from "./remittances.js";
import { isPaymentTextDraft, totalPaidForTransfer, type RemittancePaymentInput } from "../../shared/remittances/payment.mjs";
import { boundedId } from "./input-validation.js";
import {
  assertOneLine, daysBetween, errorLine, hasLineBreak, invalid, isVersion, MAX_RECEIPT_DAYS, missing, moneyText, namedParameters, okLine, PAGE_SIZE,
  parseDate, parseMoney, parsePage, percentText, PROTOCOL_COMMANDS, protocolErrorOf, ProtocolError, protocolStamp, rawParameters, record, typedText,
  WHOLE_PETITION, withoutVersion, type ProtocolCommand,
} from "./text-protocol.js";
import { isShortSessionId, type sessionIdCodec } from "./text-protocol-session.js";

type Claims = User & { authVersion?: string; sid?: string; channel?: string };
/** Marks the session tokens given by this protocol: the JSON API does not take them (see the preHandler of app.ts). */
export const TEXT_PROTOCOL_CHANNEL = "cyp";
export type TextProtocolDeps = {
  store: Store;
  systemOperators: User[];
  /** A session token: of the web, or an idSesion given before version 0.5, marked with the channel of the protocol. */
  verifyToken: (token: string) => Claims;
  /** The idSesion of 32 characters and what it stands for (text-protocol-session.ts). */
  sessionIds: ReturnType<typeof sessionIdCodec>;
  claimsOfSession: (sid: string) => Promise<Claims | undefined>;
  /** The check of every request of the web (session alive, account, role, collector, permission of the path). */
  authenticate: (claims: Claims, method: string, path: string) => Promise<User>;
  /** `expiresAt`: when the record of the session ends. */
  signIn: (login: string, password: string, channel?: string) => Promise<{ token: string; user: User; expiresAt: string }>;
  loginBody: z.ZodType<{ email: string; password: string }>;
  /**
   * Whether the sign-in is taken by GET. A password in an address stays in the records of whatever is on the way, so
   * it is taken only where the data are fictitious (demo mode); elsewhere the sign-in stays POST-only until that is
   * decided (docs/PROTOCOLO-TEXTO-PLANO.md, «Antes de producción»).
   */
  passwordByGet: boolean;
};
export const TEXT_PROTOCOL_ROUTES = ["/cyp_login", "/cyp_:cmd"];
export const isTextProtocolRoute = (url: string | undefined) => url !== undefined && TEXT_PROTOCOL_ROUTES.includes(url);

// What the document calls PuedeEnviar and PuedeVerEnvios, as the paths of the JSON API that ask for the same.
const SEND: readonly [string, string] = ["POST", "/api/envios"], VIEW: readonly [string, string] = ["GET", "/api/envios"];
// Envíos por Entregar and Entregar Envío, and what the document calls PuedeEntregar, by the paths that ask for the same.
const PENDING: readonly [string, string] = ["GET", "/api/envios/recibos"], PAY: readonly [string, string] = ["POST", "/api/envios/x/pagar"];
/** The check of each petition that needs more than a session: the equivalent path and the permission by its own name. */
const ACCESS: Record<Exclude<ProtocolCommand, "login" | "logout" | "currencies">, readonly [readonly [string, string], Parameters<typeof requireRemittancePermission>[1]]> = {
  clients: [SEND, "remittances.create"], client: [SEND, "remittances.create"], quote: [SEND, "remittances.create"], send: [SEND, "remittances.create"],
  recs: [VIEW, "remittances.view"], pend: [PENDING, "remittances.receipts"], pay: [PAY, "remittances.pay"],
  // Tasas Vigentes, as Cotizar: whoever may quote sees the rates in force, as the web shows them to a cashier in the
  // snapshot of remittances. remittances.rates.view is for the window that registers and lists every rate.
  rates: [SEND, "remittances.create"],
};
// Listado de Monedas is for whoever may send, see sends or deliver: the names of the currencies of a record.
const CURRENCY_ACCESS = [[SEND, "remittances.create"], [VIEW, "remittances.view"], [PENDING, "remittances.receipts"]] as const;
const METHODS = { cash: "1", card: "2", transfer: "3", deposit: "4" } as const;
const STATUS = { pending: "0", paid: "1", cancelled: "2" } as const;
// The names the central gives the currencies (collector-assignments.ts), for Listado de Monedas.
const CURRENCY_NAMES: Record<Currency, string> = { DOP: "Peso Dominicano", USD: "Dólar Americano", EUR: "Euro" };
// Since 0.11 the idMoneda of the protocol is a number, as in LSAN, where 1 is the peso; the code still comes in. Never
// renumbered once the application uses them: a repeated send would go in another currency.
const CURRENCY_IDS: Record<Currency, string> = { DOP: "1", USD: "2", EUR: "3" };
// A Map, not an object: a text such as «constructor» is no currency.
const CURRENCY_BY_ID: ReadonlyMap<string, Currency> = new Map(currencies.map((currency) => [CURRENCY_IDS[currency], currency]));
const AMOUNT_MODES: readonly AmountMode[] = ["source", "total", "destination"];
const CLIENT_ERRORS: Record<string, string> = { CLIENT_NOT_FOUND: "CNE", CLIENT_INACTIVE: "CIN", FORBIDDEN: "CFR" };

const currencyOf = (name: string, value: string): Currency => {
  const currency = CURRENCY_BY_ID.get(value) ?? ((currencies as readonly string[]).includes(value) ? value as Currency : undefined);
  if (!currency) throw value === "" ? missing(name) : invalid(name);
  return currency;
};
const idOf = (name: string, value: string) => {
  if (value === "") throw missing(name);
  if (!boundedId.safeParse(value).success) throw invalid(name);
  return value;
};
/** An amount written as 1500.00, in cents. */
const amountOf = (name: string, value: string) => {
  if (value === "") throw missing(name);
  const cents = parseMoney(value);
  if (cents === undefined) throw invalid(name);
  return cents;
};
/** The Monto of a quote or of a send: zero has the format, but it is too small for anything. */
const sentAmountOf = (value: string) => {
  const cents = amountOf("Monto", value);
  if (cents === 0) throw new ProtocolError("MIN");
  return cents;
};
/** What a person typed: the characters that are not seen become spaces before the length is measured. */
const textOf = (name: string, value: string, max: number) => {
  const text = typedText(value);
  if (text.length > max) throw invalid(name, `El dato ${name} admite hasta ${max} caracteres`);
  return text;
};
const sideOf = (value: string) => {
  if (value !== "" && value !== "0" && value !== "1") throw invalid("Lado");
  return value === "1" ? "recipient" as const : "sender" as const;
};
const pageOf = (value: string) => {
  const page = parsePage(value);
  if (page === undefined) throw invalid("Pagina");
  return page;
};
/** One page of a list and whether more are left. */
const pageRows = <T>(rows: T[], page: number) => ({ rows: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), more: rows.length > page * PAGE_SIZE ? "1" : "0" });
// The number as it goes out: 0, or up to 16 digits without zeros in front. 0031 is not one: it is looked for as an id.
const INTERNAL_IDENTIFICATION = /^INT[0-9]{8,16}$/, CLIENT_NUMBER = /^(0|[1-9][0-9]{0,15})$/;
/**
 * The Identificacion the protocol shows: the cédula or the passport. When a client is created without one, the web can
 * copy the client's own internal identification into it (Generar identificación); that copy is not a cédula and goes
 * out empty. Only the client's own: another text that looks like one may be a real document.
 */
const identityOf = (identification: string | undefined, internalIdentification: string | undefined) =>
  identification && identification !== internalIdentification ? identification : "";
/** The number of an internal identification, as text (16 digits do not fit in a Number): INT00000031 is 31. */
const numberOf = (internalIdentification?: string) =>
  internalIdentification && INTERNAL_IDENTIFICATION.test(internalIdentification) ? internalIdentification.slice(3).replace(/^0+(?=[0-9])/, "") : undefined;
/**
 * The idCliente of each client, by its id, built once per petition with every client (also the inactive ones and those
 * of other routes). Since 0.8 it is the number of its internal identification (INT00000031 is 31). The central makes
 * that number unique and no id is only digits, so it is always a number for a client that has one. Only if data came
 * that broke it (two internal identifications with the same number) does the internal identification go out as it is.
 * A client without one keeps its id; in the public demo every client has one. What goes out comes in as the same client.
 */
function clientIds(state: State) {
  const owners = new Map<string, number>();
  for (const row of state.clients) {
    const number = numberOf(row.internalIdentification);
    if (number !== undefined) owners.set(number, (owners.get(number) ?? 0) + 1);
  }
  return new Map(state.clients.map((row) => {
    const number = numberOf(row.internalIdentification);
    return [row.id, number !== undefined && owners.get(number) === 1 ? number : row.internalIdentification ?? row.id] as const;
  }));
}
/**
 * The client an idCliente stands for. A number: the only client with that number (with two, nobody), or else the client
 * with that id. INT and digits: by the internal identification, as in 0.6. Anything else: by the id (the long one of
 * before 0.6 still comes in). It never throws: a text that is nobody's is answered by whoever asks for it.
 */
function clientOf(state: State, idCliente: string) {
  if (CLIENT_NUMBER.test(idCliente)) {
    const owners = state.clients.filter((row) => numberOf(row.internalIdentification) === idCliente);
    if (owners.length) return owners.length === 1 ? owners[0] : undefined;
  }
  return (INTERNAL_IDENTIFICATION.test(idCliente) ? state.clients.find((row) => row.internalIdentification === idCliente) : undefined) ??
    state.clients.find((row) => row.id === idCliente);
}
/** The client chosen for one side of a send; the error carries the idCliente as it came, as the document says. */
function contactOf(state: State, actor: User, idCliente: string, side: "sender" | "recipient") {
  try { return remittanceClientContact(state, actor, clientOf(state, idCliente)?.id ?? idCliente, side); }
  catch (error) {
    const code = error instanceof DomainError ? CLIENT_ERRORS[error.code] : undefined;
    if (code) throw new ProtocolError(code, undefined, idCliente);
    throw error;
  }
}

export async function registerTextProtocol(app: FastifyInstance, deps: TextProtocolDeps) {
  const sessionOf = async (token: string): Promise<Claims> => {
    if (token === "") throw missing("idSesion");
    if (isShortSessionId(token)) {
      const sid = deps.sessionIds.open(token);
      // Out of any catch: a central that fails is EIC, and the application repeats the petition with this same session.
      const claims = sid ? await deps.claimsOfSession(sid) : undefined;
      if (!claims) throw new ProtocolError("SNE");
      return claims;
    }
    try { return deps.verifyToken(token); }
    catch (error) { throw new ProtocolError((error as { code?: string }).code === "FAST_JWT_EXPIRED" ? "SNA" : "SNE"); }
  };

  async function login(raw: string, now: Date) {
    if (hasLineBreak(raw)) throw invalid("Clave", "La petición no puede llevar saltos de línea");
    const at = raw.indexOf("|");
    if (raw === "" || at === 0) throw missing("Usuario");
    if (at < 0 || raw.length === at + 1) throw missing("Clave");
    // Usuario|Clave, and the application may add its version: Usuario|Clave|3.0. A password may hold pipes, so that
    // has two readings; both are tried, first without the last datum (what an application that sends its version
    // means) and, only if that is not the password, whole. An account whose password is right is never tried twice.
    const email = raw.slice(0, at), rest = raw.slice(at + 1), cut = rest.lastIndexOf("|");
    const versioned = cut >= 0 && isVersion(rest.slice(cut + 1));
    if (versioned && cut === 0) throw missing("Clave");
    let session: Awaited<ReturnType<TextProtocolDeps["signIn"]>> | undefined, refused: unknown;
    for (const password of versioned ? [rest.slice(0, cut), rest] : [rest]) {
      const body = deps.loginBody.safeParse({ email, password });
      if (!body.success) {
        if (refused) break; // The second reading does not fit: the answer is the one of the first.
        throw invalid(body.error.issues[0]?.path[0] === "email" ? "Usuario" : "Clave");
      }
      try { session = await deps.signIn(body.data.email, body.data.password, TEXT_PROTOCOL_CHANNEL); break; }
      catch (error) {
        // The document gives no SPE at the sign-in: an account whose entry was withdrawn cannot come in, and is told why.
        if (error instanceof DomainError && error.code === "ACCESS_REVOKED")
          throw new ProtocolError("UCI", "Su cuenta no tiene permiso para entrar. Pida a Administración que la revise");
        if (!(error instanceof DomainError) || error.code !== "INVALID_CREDENTIALS") throw error;
        refused = error;
      }
    }
    if (!session) throw refused;
    const claims = deps.verifyToken(session.token);
    const can = async ([method, path]: readonly [string, string]) => {
      try { await deps.authenticate(claims, method, path); return "1"; }
      catch (error) { if (error instanceof DomainError) return "0"; throw error; }
    };
    const { id, name, role } = session.user;
    return okLine(now, deps.sessionIds.seal(claims.sid as string), record(id, name, role, await can(SEND), await can(VIEW), await can(PAY)), protocolStamp(new Date(session.expiresAt)));
  }

  async function logout(claims: Claims, parts: string[], now: Date) {
    namedParameters("logout", parts);
    await deps.store.transaction((state) => {
      recordMutationTrace(state, claims, "/cyp_logout", {}, endOwnAuthSession(state, claims, now), now);
    });
    return okLine(now);
  }

  function clients(state: State, actor: User, parts: string[], now: Date) {
    const input = namedParameters("clients", parts), text = textOf("Texto", input.Texto, 160), page = pageOf(input.Pagina);
    // An idCliente is matched as the protocol resolves it (clientOf): the number, the internal identification or the id.
    const exactId = text ? clientOf(state, text)?.id : undefined;
    const { rows, more } = pageRows(listRemittanceClients(state, actor, text, sideOf(input.Lado), exactId), page);
    if (!rows.length) throw new ProtocolError("CNE", "No hay clientes que mostrar");
    const ids = clientIds(state);
    // Since 0.10 the Identificacion goes fourth, where the application asked for it: idCliente;Codigo;Nombre;Identificacion;Telefono;Direccion.
    return okLine(now, more, rows.map((client) => record(ids.get(client.id) ?? client.id, client.code, client.name, identityOf(client.identification, client.internalIdentification), client.phone, client.address)).join("!"));
  }

  function client(state: State, actor: User, parts: string[], now: Date) {
    const input = namedParameters("client", parts), id = idOf("idCliente", input.idCliente);
    const contact = contactOf(state, actor, id, sideOf(input.Lado));
    // The contact of a send carries neither the currency nor the internal identification: they are in the client record.
    const saved = state.clients.find((row) => row.id === contact.id);
    return okLine(now, record(clientIds(state).get(contact.id) ?? contact.id, contact.code, contact.name, identityOf(contact.identification, saved?.internalIdentification), contact.phone, contact.cellular, contact.address,
      CURRENCY_IDS[saved?.preferredCurrency ?? "DOP"]));
  }

  function quote(state: State, parts: string[], now: Date) {
    const input = namedParameters("quote", parts);
    const sourceCurrency = currencyOf("idMonedaOrigen", input.idMonedaOrigen), destinationCurrency = currencyOf("idMonedaDestino", input.idMonedaDestino);
    const amount = sentAmountOf(input.Monto);
    if (!["", "0", "1", "2"].includes(input.Modo)) throw invalid("Modo");
    const result = quoteRemittance(state, { sourceCurrency, destinationCurrency, amount, amountMode: AMOUNT_MODES[Number(input.Modo)] }, now);
    return okLine(now, record(moneyText(result.amount), moneyText(result.commissionAmount), moneyText(result.totalAmount), moneyText(result.calculation.payoutAmount),
      percentText(result.commissionBps), moneyText(result.calculation.deliveryCommissionAmount), result.quote.sourceRate, result.quote.destinationRate));
  }

  /** Listado de Monedas: the currencies of the central, in its order, for whoever may send, see sends or deliver. */
  async function currencyList(claims: Claims, parts: string[], now: Date) {
    let refused: unknown = new ProtocolError("SPE");
    for (const [path, permission] of CURRENCY_ACCESS) {
      try { requireRemittancePermission(await deps.authenticate(claims, ...path), permission); refused = undefined; break; }
      catch (error) { refused = error; }
    }
    if (refused) throw refused;
    namedParameters("currencies", parts);
    // Since 0.11 idMoneda;Nombre;Codigo: the number first, the Nombre where it was, the code at the end.
    return okLine(now, currencies.map((currency) => record(CURRENCY_IDS[currency], CURRENCY_NAMES[currency], currency)).join("!"));
  }

  /** Tasas Vigentes: the rates a quote made now uses (ratesInForce), all of them or one currency. */
  function rates(state: State, parts: string[], now: Date) {
    const input = namedParameters("rates", parts);
    const currency = input.idMoneda === "" ? undefined : currencyOf("idMoneda", input.idMoneda);
    const rows = ratesInForce(state, now).filter((row) => !currency || row.currency === currency);
    // The Dato of an error that comes from the petition is what came, as with an idCliente.
    if (currency && !rows.length) throw new ProtocolError("TNE", `No hay tasa vigente de ${currency}`, input.idMoneda);
    return okLine(now, rows.map((row) => record(CURRENCY_IDS[row.currency], row.purchaseRate, row.saleRate, row.date.replace(/-/g, ""), protocolStamp(row.changedAt))).join("!"));
  }

  /** The payment as the JSON API takes it. What must be empty with each way of paying is checked here: it is PIN. */
  function paymentOf(input: Record<string, string>): RemittancePaymentInput {
    const method = ({ "1": "cash", "3": "transfer", "4": "deposit" } as const)[input.idForma_Pago as "1" | "3" | "4"];
    if (!method) throw input.idForma_Pago === "" ? missing("idForma_Pago") : invalid("idForma_Pago");
    const empty = (name: string) => { if (input[name] !== "") throw invalid(name, `El dato ${name} va vacío con esta forma de pago`); };
    if (method === "cash") {
      for (const name of ["Referencia", "Banco", "Verificado"]) empty(name);
      return input.Recibido === "" ? { method } : { method, tenderedAmount: amountOf("Recibido", input.Recibido) };
    }
    empty("Recibido");
    const reference = textOf("Referencia", input.Referencia, 160), bank = textOf("Banco", input.Banco, 160);
    if (!reference) throw missing("Referencia");
    if (!isPaymentTextDraft(reference)) throw invalid("Referencia");
    if (!isPaymentTextDraft(bank)) throw invalid("Banco");
    if (!["", "0", "1"].includes(input.Verificado)) throw invalid("Verificado");
    // Without `verified` the business answers PAYMENT_NOT_VERIFIED: the code PNV of the document.
    return { method, reference, ...(bank ? { bank } : {}), ...(input.Verificado === "1" ? { verified: true } : {}) };
  }

  async function send(claims: Claims, parts: string[], now: Date) {
    const input = namedParameters("send", parts);
    if (!/^[A-Za-z0-9-]{8,64}$/.test(input.idOperacion)) throw input.idOperacion === "" ? missing("idOperacion") : invalid("idOperacion");
    const senderClientId = idOf("idRemitente", input.idRemitente), recipientClientId = idOf("idDestinatario", input.idDestinatario);
    const sourceCurrency = currencyOf("idMonedaOrigen", input.idMonedaOrigen), destinationCurrency = currencyOf("idMonedaDestino", input.idMonedaDestino);
    const amount = sentAmountOf(input.Monto);
    if (!["0", "1", "2"].includes(input.Modo)) throw input.Modo === "" ? missing("Modo") : invalid("Modo");
    const amountMode = AMOUNT_MODES[Number(input.Modo)];
    const total = amountOf("TotalAPagar", input.TotalAPagar), receive = amountOf("MontoARecibir", input.MontoARecibir);
    const payment = paymentOf(input), note = textOf("Nota", input.Nota, 2000);
    // Everything but the session (and the version of the application, already taken away), character by character:
    // what the document calls «los mismos datos». Without a version it is the text it always was. The currencies count
    // by their code: before 0.11 only codes came in, so the saved fingerprints still hold, and USD or 2 is the same send.
    const fingerprint = createHash("sha256").update([...parts.slice(1, 4), sourceCurrency, destinationCurrency, ...parts.slice(6)].join("|")).digest("hex");
    return deps.store.transaction((state) => {
      assertAuthSession(state, claims, claims.sid);
      const actor = currentAccessUser(state, claims);
      authorizeRequest(actor, ...SEND);
      requireRemittancePermission(actor, "remittances.create");
      const scope = `${TEXT_PROTOCOL_CHANNEL}:${actor.id}:${input.idOperacion}`;
      const existing = state.idempotency.find((row) => row.id === scope);
      if (existing) {
        const saved = existing.response as { envioReference: string; envio: string };
        if (existing.fingerprint !== fingerprint) throw new ProtocolError("OPD", undefined, saved.envioReference);
        return okLine(now, saved.envio);
      }
      // After the idOperacion, as always. An idCliente may come as the number, the internal identification or the long id:
      // the same client by two of them is still the same client, and two equal texts that are nobody's are still MCL.
      const sender = clientOf(state, senderClientId)?.id ?? senderClientId, recipient = clientOf(state, recipientClientId)?.id ?? recipientClientId;
      if (sender === recipient) throw new ProtocolError("MCL");
      contactOf(state, actor, senderClientId, "sender");
      contactOf(state, actor, recipientClientId, "recipient");
      const quoted = quoteRemittance(state, { sourceCurrency, destinationCurrency, amount, amountMode }, now);
      if (quoted.totalAmount !== total || quoted.calculation.payoutAmount !== receive) throw new ProtocolError("CCA");
      const checkCatalogChanges = guardCatalogChanges(state, actor, SEND[1]);
      // The principal is the one of the quote: typed as the total or as what the person receives, the Monto is not it.
      const transfer = createRemittance(state, actor, {
        sourceCurrency, destinationCurrency, amount: quoted.amount, senderClientId: sender, recipientClientId: recipient, quote: quoted.quote, note, payment,
        ...(amountMode === "total" ? { requestedTotalAmount: amount } : amountMode === "destination" ? { requestedReceiveAmount: amount } : {}),
      }, deps.systemOperators, now);
      checkCatalogChanges();
      recordMutationTrace(state, actor, "/cyp_send", {}, transfer, now);
      const envio = record(transfer.id, transfer.envioReference, transfer.reciboReference, transfer.operatingCode, protocolStamp(transfer.createdAt),
        moneyText(transfer.amount), moneyText(transfer.commissionAmount), moneyText(transfer.totalAmount), moneyText(payoutOf(transfer)), moneyText(transfer.payment?.changeAmount ?? 0));
      // Kept for as long as the row lives (the document promises seven days at least): the answer of a repeated petition.
      state.idempotency.push({ id: scope, fingerprint, response: { protocol: TEXT_PROTOCOL_CHANNEL, transferId: transfer.id, envioReference: transfer.envioReference, envio }, createdAt: now.toISOString() });
      return okLine(now, envio);
    });
  }

  function receipts(state: State, actor: User, parts: string[], now: Date) {
    const input = namedParameters("recs", parts);
    const from = input.FechaInicial === "" ? businessDate(now) : parseDate(input.FechaInicial);
    if (!from) throw invalid("FechaInicial");
    const to = input.FechaFinal === "" ? from : parseDate(input.FechaFinal);
    if (!to) throw invalid("FechaFinal");
    if (to < from) throw invalid("FechaFinal", "La FechaFinal es anterior a la FechaInicial");
    if (daysBetween(from, to) >= MAX_RECEIPT_DAYS) throw invalid("FechaFinal", `Entre la FechaInicial y la FechaFinal puede haber ${MAX_RECEIPT_DAYS} días como máximo`);
    if (!["", "0", "1", "2", "3"].includes(input.idEstado)) throw invalid("idEstado");
    const status = input.idEstado === "" || input.idEstado === "3" ? undefined : input.idEstado;
    const page = pageOf(input.Pagina);
    const visible = state.remittances.transfers.filter((transfer) => {
      if (status !== undefined && STATUS[transfer.status] !== status) return false;
      // The day of the send is the one of the Dominican Republic, as everywhere in the central.
      const date = businessDate(new Date(transfer.createdAt));
      return date >= from && date <= to && canSeeOutgoing(state, actor, transfer);
    }).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0) || b.sequence - a.sequence);
    const { rows, more } = pageRows(visible, page);
    if (!rows.length) throw new ProtocolError("RNE");
    return okLine(now, more, rows.map(receiptOf(state)).join("!"));
  }
  /** The record of a send in Listado de Recibos, Envíos por Entregar and Entregar Envío, with the clients by their idCliente. */
  const receiptOf = (state: State) => {
    const ids = clientIds(state), internal = new Map(state.clients.map((row) => [row.id, row.internalIdentification]));
    return (transfer: Remittance) => receipt(transfer, (id) => ids.get(id) ?? id, internal.get(transfer.recipientClientId));
  };
  const receipt = (transfer: Remittance, idCliente: (id: string) => string, recipientInternal?: string) => record(
    transfer.id, transfer.envioReference, transfer.reciboReference, transfer.operatingCode, protocolStamp(transfer.createdAt), STATUS[transfer.status],
    idCliente(transfer.senderClientId), transfer.senderContact?.name ?? "", idCliente(transfer.recipientClientId), transfer.recipientContact?.name ?? "",
    transfer.recipientContact?.phone || transfer.recipientContact?.cellular || "",
    CURRENCY_IDS[transfer.sourceCurrency], moneyText(transfer.amount), moneyText(transfer.commissionAmount), moneyText(totalPaidForTransfer(transfer)),
    CURRENCY_IDS[transfer.destinationCurrency], moneyText(payoutOf(transfer)), transfer.payment ? METHODS[transfer.payment.method] : "", protocolStamp(transfer.paidAt),
    // The identification the recipient is asked for at the delivery: the copy saved in the send, not the client record of today.
    identityOf(transfer.recipientContact?.identification, recipientInternal));

  function pending(state: State, actor: User, parts: string[], now: Date) {
    const input = namedParameters("pend", parts), text = textOf("Texto", input.Texto, 160), page = pageOf(input.Pagina);
    // Since 0.8, the sends to one recipient by its idCliente: the application does not have to look for them by the cédula.
    const recipient = input.idDestinatario === "" ? undefined : clientOf(state, idOf("idDestinatario", input.idDestinatario));
    if (input.idDestinatario !== "" && !recipient) throw new ProtocolError("CNE", undefined, input.idDestinatario);
    const found = pendingDeliveries(state, actor, text).filter((transfer) => !recipient || transfer.recipientClientId === recipient.id);
    const { rows, more } = pageRows(found, page);
    if (!rows.length) throw new ProtocolError("RNE", "No hay envíos por entregar");
    return okLine(now, more, rows.map(receiptOf(state)).join("!"));
  }

  async function pay(claims: Claims, parts: string[], now: Date) {
    const input = namedParameters("pay", parts);
    if (!/^[A-Za-z0-9-]{8,64}$/.test(input.idOperacion)) throw input.idOperacion === "" ? missing("idOperacion") : invalid("idOperacion");
    if (!/^ENV\d{8}$/.test(input.NumEnvio)) throw input.NumEnvio === "" ? missing("NumEnvio") : invalid("NumEnvio");
    const receive = amountOf("MontoARecibir", input.MontoARecibir);
    // With «pay» in front: an idOperacion that was of a send, used again here, is never taken for the same operation.
    const fingerprint = createHash("sha256").update(["pay", ...parts.slice(1)].join("|")).digest("hex");
    return deps.store.transaction((state) => {
      assertAuthSession(state, claims, claims.sid);
      const actor = currentAccessUser(state, claims);
      authorizeRequest(actor, ...PAY);
      requireRemittancePermission(actor, "remittances.pay");
      // The same idOperacion with the same data is the petition whose answer was lost: the saved answer, and nothing
      // leaves the box again. Any other attempt on a send that is already delivered is answered ENP below.
      const scope = `${TEXT_PROTOCOL_CHANNEL}:${actor.id}:${input.idOperacion}`;
      const existing = state.idempotency.find((row) => row.id === scope);
      if (existing) {
        const saved = existing.response as { envioReference: string; envio: string; transferId?: string };
        if (existing.fingerprint !== fingerprint) throw new ProtocolError("OPD", "Ese idOperacion ya se usó con otros datos", saved.envioReference);
        // The same record again, made now: a delivery is never undone, so only the idCliente may have changed its form
        // (a delivery of 0.7 repeated after 0.8 does not bring the INT back).
        const delivered = state.remittances.transfers.find((row) => row.id === saved.transferId);
        return okLine(now, delivered ? receiptOf(state)(delivered) : saved.envio);
      }
      const transfer = deliverableByReference(state, actor, input.NumEnvio);
      if (!transfer) throw new ProtocolError("ENE", undefined, input.NumEnvio);
      // What the application showed is what leaves the box: a wrong NumEnvio never delivers the money of another send.
      if (payoutOf(transfer) !== receive) throw new ProtocolError("MNC", undefined, input.NumEnvio);
      if (transfer.status !== "pending") throw new ProtocolError("ENP", undefined, STATUS[transfer.status]);
      const checkCatalogChanges = guardCatalogChanges(state, actor, PAY[1]), currency = transfer.destinationCurrency;
      try { payRemittance(state, actor, transfer.id, now); }
      catch (error) {
        // Only around the delivery itself: here FORBIDDEN is the recipient out of the route of a collector, and the
        // box is the one of the currency the recipient receives.
        const code = error instanceof DomainError ? error.code : "";
        if (code === "FORBIDDEN")
          throw new ProtocolError("CFR", "El destinatario no es de su ruta", clientIds(state).get(transfer.recipientClientId) ?? transfer.recipientClientId);
        if (code === "CASH_NOT_OPEN") throw new ProtocolError("CNA", `No tiene abierta hoy su Caja de Remesas en ${currency}`, CURRENCY_IDS[currency]);
        if (code === "INSUFFICIENT_CASH") throw new ProtocolError("CSF", `Su Caja de Remesas en ${currency} no tiene fondos para esta entrega`, CURRENCY_IDS[currency]);
        throw error;
      }
      checkCatalogChanges();
      recordMutationTrace(state, actor, "/cyp_pay", {}, transfer, now);
      const envio = receiptOf(state)(transfer);
      state.idempotency.push({ id: scope, fingerprint, response: { protocol: TEXT_PROTOCOL_CHANNEL, transferId: transfer.id, envioReference: transfer.envioReference, envio }, createdAt: now.toISOString() });
      return okLine(now, envio);
    });
  }

  async function answer(command: string, request: FastifyRequest, now: Date) {
    if (!(PROTOCOL_COMMANDS as readonly string[]).includes(command)) throw new ProtocolError("PNE");
    const name = command as ProtocolCommand;
    // Every petition comes by GET or by POST. The only exception is the password of the sign-in outside demo mode.
    if (name === "login" && request.method !== "POST" && !deps.passwordByGet) throw invalid(WHOLE_PETITION, "En esta central, Iniciar Sesión solo se acepta por POST");
    const raw = rawParameters(request.method, request.url, request.body);
    if (name === "login") return login(raw, now);
    const parts = withoutVersion(name, raw.split("|"));
    assertOneLine(name, parts);
    const claims = await sessionOf(parts[0]);
    if (name === "logout") return logout(claims, parts, now);
    if (name === "currencies") return currencyList(claims, parts, now);
    // The permission is asked twice on purpose: by the equivalent path, as the web does, and by its own name, so a
    // change in the table of paths can never leave these petitions open.
    const [path, permission] = ACCESS[name];
    const actor = await deps.authenticate(claims, ...path);
    requireRemittancePermission(actor, permission);
    if (name === "send") return send(claims, parts, now);
    if (name === "pay") return pay(claims, parts, now);
    const state = await deps.store.read();
    if (name === "clients") return clients(state, actor, parts, now);
    if (name === "client") return client(state, actor, parts, now);
    if (name === "quote") return quote(state, parts, now);
    if (name === "pend") return pending(state, actor, parts, now);
    if (name === "rates") return rates(state, parts, now);
    if (name === "recs") return receipts(state, actor, parts, now);
    throw new ProtocolError("PNE");
  }

  // Always HTTP 200 and one line of text: the result is in OK or ER, never in the HTTP code.
  const reply200 = (reply: FastifyReply, line: string) => reply.code(200).type("text/plain; charset=utf-8").send(line);
  await app.register(async (scope) => {
    // The body is the petition itself, whatever Content-Type the application's library sends with it (or none).
    scope.addHook("onRequest", async (request) => { if (request.method === "POST") request.headers["content-type"] = "text/plain"; });
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "string" }, (_request, body, done) => done(null, body));
    scope.setErrorHandler((error, request, reply) => {
      const known = protocolErrorOf(error);
      if (known) return reply200(reply, errorLine(new Date(), known));
      const reference = /^[a-zA-Z0-9_-]{1,64}$/.test(request.id) ? request.id : "soporte";
      console.error("Request failed", reference, (error as Error).message);
      return reply200(reply, errorLine(new Date(), new ProtocolError("EIC", `No se pudo completar la operación. Inténtelo de nuevo. Referencia para soporte: ${reference}`)));
    });
    const handler = (command: (request: FastifyRequest) => string) => async (request: FastifyRequest, reply: FastifyReply) => {
      const now = new Date();
      return reply200(reply, await answer(command(request), request, now));
    };
    scope.route({ method: ["GET", "POST"], url: "/cyp_login", exposeHeadRoute: false,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, handler: handler(() => "login") });
    scope.route({ method: ["GET", "POST"], url: "/cyp_:cmd", exposeHeadRoute: false,
      handler: handler((request) => (request.params as { cmd: string }).cmd) });
  });
}
