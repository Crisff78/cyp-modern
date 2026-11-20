// Plain-text protocol for the mobile application: the seven petitions of docs/protocolo-cyp/Protocolo CYP 0.2.txt.
// Each one is a thin adapter in front of the same functions the JSON API uses; no rule of the business lives here.
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { businessDate, DomainError, type State, type User } from "./domain.js";
import type { Store } from "./store.js";
import { assertAuthSession, endOwnAuthSession, recordMutationTrace } from "./admin-tools.js";
import { authorizeRequest, currentAccessUser, guardCatalogChanges, requireRemittancePermission } from "./access.js";
import { listRemittanceClients, remittanceClientContact } from "./remittance-client-search.js";
import { canSeeOutgoing, createRemittance, currencies, payoutOf, quoteRemittance, type AmountMode, type Currency, type Remittance } from "./remittances.js";
import { isPaymentTextDraft, totalPaidForTransfer, type RemittancePaymentInput } from "../../shared/remittances/payment.mjs";
import { boundedId } from "./input-validation.js";
import {
  assertOneLine, daysBetween, errorLine, hasLineBreak, invalid, MAX_RECEIPT_DAYS, missing, moneyText, namedParameters, okLine, PAGE_SIZE, parseDate,
  parseMoney, parsePage, percentText, PROTOCOL_COMMANDS, protocolErrorOf, ProtocolError, protocolStamp, rawParameters, record, typedText,
  WHOLE_PETITION, type ProtocolCommand,
} from "./text-protocol.js";

type Claims = User & { authVersion?: string; sid?: string; exp?: number };
/** Marks the session tokens given by this protocol: the JSON API does not take them (see the preHandler of app.ts). */
export const TEXT_PROTOCOL_CHANNEL = "cyp";
export type TextProtocolDeps = {
  store: Store;
  systemOperators: User[];
  /** The session token of the web: `idSesion` is one of them, marked with the channel of the protocol. */
  verifyToken: (token: string) => Claims;
  /** The check of every request of the web (session alive, account, role, collector, permission of the path). */
  authenticate: (claims: Claims, method: string, path: string) => Promise<User>;
  /** `expiresAt`: when the record of the session ends (its token has its own end, in `exp`). */
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
const METHODS = { cash: "1", card: "2", transfer: "3", deposit: "4" } as const;
const STATUS = { pending: "0", paid: "1", cancelled: "2" } as const;
const AMOUNT_MODES: readonly AmountMode[] = ["source", "total", "destination"];
const CLIENT_ERRORS: Record<string, string> = { CLIENT_NOT_FOUND: "CNE", CLIENT_INACTIVE: "CIN", FORBIDDEN: "CFR" };

const currencyOf = (name: string, value: string): Currency => {
  if (!(currencies as readonly string[]).includes(value)) throw value === "" ? missing(name) : invalid(name);
  return value as Currency;
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
/** The client chosen for one side of a send; the error carries its id, as the document says. */
function contactOf(state: State, actor: User, id: string, side: "sender" | "recipient") {
  try { return remittanceClientContact(state, actor, id, side); }
  catch (error) {
    const code = error instanceof DomainError ? CLIENT_ERRORS[error.code] : undefined;
    if (code) throw new ProtocolError(code, undefined, id);
    throw error;
  }
}

export async function registerTextProtocol(app: FastifyInstance, deps: TextProtocolDeps) {
  const sessionOf = (token: string): Claims => {
    if (token === "") throw missing("idSesion");
    try { return deps.verifyToken(token); }
    catch (error) { throw new ProtocolError((error as { code?: string }).code === "FAST_JWT_EXPIRED" ? "SNA" : "SNE"); }
  };

  async function login(raw: string, now: Date) {
    if (hasLineBreak(raw)) throw invalid("Clave", "La petición no puede llevar saltos de línea");
    const at = raw.indexOf("|");
    if (raw === "" || at === 0) throw missing("Usuario");
    if (at < 0 || raw.length === at + 1) throw missing("Clave");
    const body = deps.loginBody.safeParse({ email: raw.slice(0, at), password: raw.slice(at + 1) });
    if (!body.success) throw invalid(body.error.issues[0]?.path[0] === "email" ? "Usuario" : "Clave");
    let session: Awaited<ReturnType<TextProtocolDeps["signIn"]>>;
    try { session = await deps.signIn(body.data.email, body.data.password, TEXT_PROTOCOL_CHANNEL); }
    catch (error) {
      // The document gives no SPE at the sign-in: an account whose entry was withdrawn cannot come in, and is told why.
      if (error instanceof DomainError && error.code === "ACCESS_REVOKED")
        throw new ProtocolError("UCI", "Su cuenta no tiene permiso para entrar. Pida a Administración que la revise");
      throw error;
    }
    const claims = deps.verifyToken(session.token);
    const can = async ([method, path]: readonly [string, string]) => {
      try { await deps.authenticate(claims, method, path); return "1"; }
      catch (error) { if (error instanceof DomainError) return "0"; throw error; }
    };
    const { id, name, role } = session.user;
    // Vence: the first of the two ends a session has, the one of its record and the one of its token.
    const ends = Math.min(Date.parse(session.expiresAt), ...(claims.exp ? [claims.exp * 1000] : []));
    return okLine(now, session.token, record(id, name, role, await can(SEND), await can(VIEW)), protocolStamp(new Date(ends)));
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
    const { rows, more } = pageRows(listRemittanceClients(state, actor, text, sideOf(input.Lado)), page);
    if (!rows.length) throw new ProtocolError("CNE", "No hay clientes que mostrar");
    return okLine(now, more, rows.map((client) => record(client.id, client.code, client.name)).join("!"));
  }

  function client(state: State, actor: User, parts: string[], now: Date) {
    const input = namedParameters("client", parts), id = idOf("idCliente", input.idCliente);
    const contact = contactOf(state, actor, id, sideOf(input.Lado));
    // The contact of a send does not carry the currency; it is the one of the client record.
    const currency = state.clients.find((row) => row.id === id)?.preferredCurrency ?? "DOP";
    return okLine(now, record(contact.id, contact.code, contact.name, contact.identification ?? "", contact.phone, contact.cellular, contact.address, currency));
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

  async function send(claims: Claims, raw: string, parts: string[], now: Date) {
    const input = namedParameters("send", parts);
    if (!/^[A-Za-z0-9-]{8,64}$/.test(input.idOperacion)) throw input.idOperacion === "" ? missing("idOperacion") : invalid("idOperacion");
    const senderClientId = idOf("idRemitente", input.idRemitente), recipientClientId = idOf("idDestinatario", input.idDestinatario);
    const sourceCurrency = currencyOf("idMonedaOrigen", input.idMonedaOrigen), destinationCurrency = currencyOf("idMonedaDestino", input.idMonedaDestino);
    const amount = sentAmountOf(input.Monto);
    if (!["0", "1", "2"].includes(input.Modo)) throw input.Modo === "" ? missing("Modo") : invalid("Modo");
    const amountMode = AMOUNT_MODES[Number(input.Modo)];
    const total = amountOf("TotalAPagar", input.TotalAPagar), receive = amountOf("MontoARecibir", input.MontoARecibir);
    const payment = paymentOf(input), note = textOf("Nota", input.Nota, 2000);
    // Everything but the session, character by character: what the document calls «los mismos datos».
    const fingerprint = createHash("sha256").update(raw.slice(raw.indexOf("|") + 1)).digest("hex");
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
      if (senderClientId === recipientClientId) throw new ProtocolError("MCL");
      contactOf(state, actor, senderClientId, "sender");
      contactOf(state, actor, recipientClientId, "recipient");
      const quoted = quoteRemittance(state, { sourceCurrency, destinationCurrency, amount, amountMode }, now);
      if (quoted.totalAmount !== total || quoted.calculation.payoutAmount !== receive) throw new ProtocolError("CCA");
      const checkCatalogChanges = guardCatalogChanges(state, actor, SEND[1]);
      // The principal is the one of the quote: typed as the total or as what the person receives, the Monto is not it.
      const transfer = createRemittance(state, actor, {
        sourceCurrency, destinationCurrency, amount: quoted.amount, senderClientId, recipientClientId, quote: quoted.quote, note, payment,
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
    return okLine(now, more, rows.map(receipt).join("!"));
  }
  const receipt = (transfer: Remittance) => record(
    transfer.id, transfer.envioReference, transfer.reciboReference, transfer.operatingCode, protocolStamp(transfer.createdAt), STATUS[transfer.status],
    transfer.senderClientId, transfer.senderContact?.name ?? "", transfer.recipientClientId, transfer.recipientContact?.name ?? "",
    transfer.recipientContact?.phone || transfer.recipientContact?.cellular || "",
    transfer.sourceCurrency, moneyText(transfer.amount), moneyText(transfer.commissionAmount), moneyText(totalPaidForTransfer(transfer)),
    transfer.destinationCurrency, moneyText(payoutOf(transfer)), transfer.payment ? METHODS[transfer.payment.method] : "", protocolStamp(transfer.paidAt));

  async function answer(command: string, request: FastifyRequest, now: Date) {
    if (!(PROTOCOL_COMMANDS as readonly string[]).includes(command)) throw new ProtocolError("PNE");
    const name = command as ProtocolCommand;
    // Every petition comes by GET or by POST. The only exception is the password of the sign-in outside demo mode.
    if (name === "login" && request.method !== "POST" && !deps.passwordByGet) throw invalid(WHOLE_PETITION, "En esta central, Iniciar Sesión solo se acepta por POST");
    const raw = rawParameters(request.method, request.url, request.body);
    if (name === "login") return login(raw, now);
    const parts = raw.split("|");
    assertOneLine(name, parts);
    const claims = sessionOf(parts[0]);
    if (name === "logout") return logout(claims, parts, now);
    // The permission is asked twice on purpose: by the equivalent path, as the web does, and by its own name, so a
    // change in the table of paths can never leave these petitions open.
    const actor = await deps.authenticate(claims, ...(name === "recs" ? VIEW : SEND));
    requireRemittancePermission(actor, name === "recs" ? "remittances.view" : "remittances.create");
    if (name === "send") return send(claims, raw, parts, now);
    const state = await deps.store.read();
    if (name === "clients") return clients(state, actor, parts, now);
    if (name === "client") return client(state, actor, parts, now);
    if (name === "quote") return quote(state, parts, now);
    return receipts(state, actor, parts, now);
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
