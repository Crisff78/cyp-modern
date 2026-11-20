// Plain-text protocol for the mobile application (docs/protocolo-cyp/Protocolo CYP 0.4.txt).
// This file has no Fastify in it: how a petition is read, how an answer is written and which code an error gets.
import { DomainError } from "./domain.js";

export const PROTOCOL_COMMANDS = ["login", "logout", "clients", "client", "quote", "send", "recs"] as const;
export type ProtocolCommand = (typeof PROTOCOL_COMMANDS)[number];
/** The names of the parameters, as the document writes them; a PIN error names the one that is wrong. */
export const PROTOCOL_PARAMETERS: Record<Exclude<ProtocolCommand, "login">, readonly string[]> = {
  logout: ["idSesion"],
  clients: ["idSesion", "Texto", "Pagina", "Lado"],
  client: ["idSesion", "idCliente", "Lado"],
  quote: ["idSesion", "idMonedaOrigen", "idMonedaDestino", "Monto", "Modo"],
  send: ["idSesion", "idOperacion", "idRemitente", "idDestinatario", "idMonedaOrigen", "idMonedaDestino", "Monto", "Modo",
    "TotalAPagar", "MontoARecibir", "idForma_Pago", "Recibido", "Referencia", "Banco", "Verificado", "Nota"],
  recs: ["idSesion", "FechaInicial", "FechaFinal", "idEstado", "Pagina"],
};
export const PAGE_SIZE = 100;
export const MAX_RECEIPT_DAYS = 31;
/** What a PIN error names when the whole petition is wrong and not one of its parameters. */
export const WHOLE_PETITION = "Parametros";
/** The longest address of a GET (what follows the name of the server): every server on the way takes it. More goes by POST. */
export const MAX_ADDRESS_LENGTH = 8000;

// One message per code, for the person who uses the application. The application decides by the code.
const MESSAGES: Record<string, string> = {
  SNE: "Sesión no encontrada. Inicie sesión otra vez",
  SNA: "La sesión ya no está activa. Inicie sesión otra vez",
  UCI: "Usuario o clave incorrectos",
  CBI: "El cobrador está inactivo en la central",
  SPE: "No tiene permiso para esta operación",
  PIN: "La petición no viene como se indica",
  DML: "Demasiadas peticiones. Espere un minuto",
  PNE: "Petición no encontrada",
  EIC: "No se pudo completar la operación. Inténtelo de nuevo",
  ORC: "La central no aceptó la operación",
  CNE: "Cliente no encontrado",
  CIN: "El cliente está inactivo",
  CFR: "El cliente no es de su ruta",
  MCL: "El remitente y el destinatario son el mismo cliente",
  TNE: "No hay tasa registrada para una de las monedas",
  MIN: "El monto es demasiado pequeño",
  CCA: "Los importes cambiaron. Cotice otra vez",
  CNA: "No tiene abierta su Caja de Remesas",
  EIS: "El dinero recibido es menos que el total a pagar",
  PNV: "Falta confirmar que el pago ya llegó",
  OPD: "Ese envío ya estaba registrado con otros datos",
  RNE: "No hay recibos que mostrar",
};
export class ProtocolError extends Error {
  constructor(public code: string, message?: string, public dato = "") {
    super(message ?? MESSAGES[code] ?? MESSAGES.ORC);
  }
}
/** The parameter is missing, is one too many or does not have the format of the document. */
export const invalid = (dato: string, message = `El dato ${dato} no tiene el formato indicado`) => new ProtocolError("PIN", message, dato);
export const missing = (dato: string) => invalid(dato, `Falta el dato ${dato}`);

// The format of an amount and the zero are checked before the business sees it, so from here INVALID_AMOUNT is only
// the amount that, asked by what the person receives, sends nothing at all.
const DOMAIN_CODES: Record<string, string> = {
  SESSION_EXPIRED: "SNA", INVALID_CREDENTIALS: "UCI", COLLECTOR_INACTIVE: "CBI", OPERATOR_INACTIVE: "CBI",
  FORBIDDEN: "SPE", PERMISSION_REQUIRED: "SPE", ACCESS_REVOKED: "SPE", OPERATOR_FORBIDDEN: "SPE",
  CLIENT_NOT_FOUND: "CNE", CLIENT_INACTIVE: "CIN", SAME_CLIENT: "MCL", RATE_MISSING: "TNE",
  AMOUNT_TOO_SMALL: "MIN", INVALID_AMOUNT: "MIN", QUOTE_CHANGED: "CCA", CASH_NOT_OPEN: "CNA",
  INSUFFICIENT_TENDERED: "EIS", PAYMENT_NOT_VERIFIED: "PNV",
};
// What only Administración can fix in the central, said to the person at the application.
const commissions = "La central tiene que revisar su configuración de comisiones. Avise al Administrador";
const CENTRAL_SETUP: Record<string, string> = {
  COMMISSION_EXCEEDS_TOTAL: commissions, INVALID_COMMISSION: commissions, INVALID_DELIVERY_COMMISSION: commissions, COMMISSION_POLICY_MISMATCH: commissions,
  INVALID_RATE: "La central tiene que revisar una de sus tasas. Avise al Administrador",
  SEQUENCE_EXHAUSTED: "Se agotó la numeración de envíos de la central. Avise al Administrador",
};
/**
 * Every failure of a petition, as an error of the protocol. A rule of the business without a code of its own goes
 * out as ORC with its message: repeating the petition does not fix it, and EIC tells the application to repeat.
 * `undefined` means the failure is not a known one: the caller logs it and answers EIC.
 */
export function protocolErrorOf(error: unknown): ProtocolError | undefined {
  if (error instanceof ProtocolError) return error;
  if (error instanceof DomainError) {
    const code = DOMAIN_CODES[error.code];
    if (code) return new ProtocolError(code);
    if (error.code === "MONEY_RANGE") return invalid("Monto", "El importe no está dentro de lo que admite la central");
    if (error.code === "INVALID_PAYMENT") return invalid("idForma_Pago", "Revise los datos de la forma de pago");
    return new ProtocolError("ORC", CENTRAL_SETUP[error.code] ?? error.message);
  }
  const status = (error as { statusCode?: number } | null)?.statusCode;
  if (status === 429) return new ProtocolError("DML");
  if (status === 413) return invalid(WHOLE_PETITION, "La petición es demasiado grande");
  if (status === 400 || status === 415) return invalid(WHOLE_PETITION, "La petición no se pudo leer");
  return undefined;
}

const stamp = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Santo_Domingo", hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});
/** YYYYMMDDHHMMSS in the time of the Dominican Republic; empty for a date that is not there. */
export function protocolStamp(date: Date | string | undefined) {
  if (date === undefined || date === "") return "";
  const parts = Object.fromEntries(stamp.formatToParts(typeof date === "string" ? new Date(date) : date).map((part) => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
}
// Unicode classes instead of code points: control characters (tab and line breaks among them), the separators of
// lines and paragraphs, and the invisible format marks that a text pasted from another application may bring.
const lineBreak = /[\n\r\v\f\x85\p{Zl}\p{Zp}]/u;
export const hasLineBreak = (value: string) => lineBreak.test(value);
/** A separator or a line break inside a piece of data would move every field after it. */
export const clean = (value: unknown) => String(value ?? "").replace(/[|!;@\p{Cc}\p{Zl}\p{Zp}]/gu, " ");
/** What a person typed or pasted: the characters that are not seen become a space, as the separators do in answers. */
export const typedText = (value: string) => value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").trim();
export const record = (...fields: unknown[]) => fields.map(clean).join(";");
export const okLine = (now: Date, ...groups: string[]) => ["OK", protocolStamp(now), ...groups].join("|");
/** Always five parts: with no Dato the last pipe is still there. */
export const errorLine = (now: Date, error: ProtocolError) => ["ER", protocolStamp(now), clean(error.code), clean(error.message), clean(error.dato)].join("|");

/** Cents as 1500.00: point, two decimals, no thousands separator. */
export function moneyText(cents: number) {
  const value = BigInt(cents), absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}
/** 1500.00 as cents; undefined when it is not written as the document says. Fifteen digits stay a safe integer. */
export function parseMoney(text: string) {
  return /^\d{1,13}\.\d{2}$/.test(text) ? Number(text.replace(".", "")) : undefined;
}
/** Hundredths of a percent as 5.00 */
export const percentText = (bps: number) => `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, "0")}`;
/** YYYYMMDD as YYYY-MM-DD; undefined when it is not a real date. */
export function parseDate(text: string) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (!match) return undefined;
  const iso = `${match[1]}-${match[2]}-${match[3]}`, date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? undefined : iso;
}
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
/** A page number from 1; undefined when it is not one. Empty is the first page; a page past the end is only empty. */
export function parsePage(text: string) {
  if (text === "") return 1;
  return /^[1-9]\d{0,8}$/.test(text) ? Number(text) : undefined;
}
/**
 * The parameters as they travel. POST: the body, untouched. GET: everything after the first `?`, decoded as a whole
 * and only then split, so `%7C` is a pipe and `+` stays a plus sign. The application of the other party writes
 * `?p=` before them (its own habit, in every petition): both ways are the same petition. Only a literal, lower-case
 * `p=` right after the `?` is that prefix.
 */
export function rawParameters(method: string, url: string, body: unknown) {
  if (method === "POST") {
    const text = typeof body === "string" ? body : "";
    // The prefix is of the addresses only. A body that brings it would be read as a wrong user or a wrong session.
    if (text.startsWith("p=")) throw invalid(WHOLE_PETITION, "Por POST los datos van tal cual en el cuerpo, sin p= delante");
    return text;
  }
  if (url.length > MAX_ADDRESS_LENGTH) throw invalid(WHOLE_PETITION, `La dirección pasa de ${MAX_ADDRESS_LENGTH} caracteres. Mande esta petición por POST`);
  const at = url.indexOf("?");
  if (at < 0) return "";
  const query = url.slice(at + 1);
  try { return decodeURIComponent(query.startsWith("p=") ? query.slice(2) : query); }
  catch { throw invalid(WHOLE_PETITION, "La dirección trae un % que no se puede decodificar. Las letras con acento van en UTF-8 (ñ = %C3%B1)"); }
}
// What the application of the other party adds after the last datum of a petition (3.0 today). Digits and dots, at
// least one dot, short: a telephone written with dots (809.555.0100) is not one.
const VERSION = /^\d{1,3}(\.\d{1,3}){1,2}$/;
export const isVersion = (value: string) => VERSION.test(value);
/** The data a petition cannot go without. Whatever comes after them is optional. */
const REQUIRED: Record<Exclude<ProtocolCommand, "login">, number> = { logout: 1, clients: 1, client: 2, quote: 4, send: 16, recs: 1 };
/**
 * The data without the version of the application, when it comes. It is always one datum more: it is taken away only
 * when the petition already has the data it cannot go without, so an amount in last place (100.00, written as a
 * version is) stays the amount, and in Registrar Envío it can only be the seventeenth datum. The central does not
 * use it. The sign-in reads its own (see login).
 */
export function withoutVersion(command: Exclude<ProtocolCommand, "login">, parts: string[]) {
  return parts.length > REQUIRED[command] && isVersion(parts[parts.length - 1]) ? parts.slice(0, -1) : parts;
}
/** A petition is one line. The error names the parameter that brings the line break, the session too. */
export function assertOneLine(command: Exclude<ProtocolCommand, "login">, parts: string[]) {
  const at = parts.findIndex(hasLineBreak);
  if (at < 0) return;
  const name = PROTOCOL_PARAMETERS[command][at] ?? WHOLE_PETITION;
  throw invalid(name, name === WHOLE_PETITION ? "La petición no puede llevar saltos de línea" : `El dato ${name} no puede llevar saltos de línea`);
}
/** The parameters by their name; the ones left out are empty. More than the petition has is PIN. */
export function namedParameters(command: Exclude<ProtocolCommand, "login">, parts: string[]) {
  const names = PROTOCOL_PARAMETERS[command];
  if (command === "send" && parts.length !== names.length)
    throw invalid(WHOLE_PETITION, `Registrar Envío lleva siempre ${names.length} datos (${names.length - 1} pipes)`);
  if (parts.length > names.length) throw invalid(WHOLE_PETITION, "La petición trae datos de más");
  return Object.fromEntries(names.map((name, index) => [name, parts[index] ?? ""])) as Record<string, string>;
}
