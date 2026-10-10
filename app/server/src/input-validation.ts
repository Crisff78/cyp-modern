import { z } from "zod";
import { phoneOrEmpty } from "./contact-schemas.js";
import contracts from "../../shared/input-contracts.json" with { type: "json" };

const singleLineControls = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const nonTextControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

export const singleLine = (max: number, min = 0) => z.string()
  .refine((value) => !singleLineControls.test(value), "Usa una sola línea sin caracteres de control.")
  .trim().min(min, "Completa este campo.").max(max, `Usa como máximo ${max} caracteres.`);

export const freeText = (max: number, min = 0) => z.string()
  .refine((value) => !nonTextControls.test(value), "El texto contiene caracteres de control no válidos.")
  .trim().min(min, "Completa este campo.").max(max, `Usa como máximo ${max} caracteres.`);

// IDs may be legacy strings; validation never changes their identity or fingerprints.
export const boundedId = z.string().min(1, "Indica un identificador.")
  .max(80, "El identificador admite hasta 80 caracteres.")
  .refine((value) => value.trim().length > 0 && !singleLineControls.test(value), "El identificador no es válido.");

const emailFormat = z.email();
export const optionalEmail = singleLine(200)
  .refine((value) => value === "" || emailFormat.safeParse(value).success, "Escribe un correo válido o deja el campo vacío.");

const phoneFormat = /^\+?(?=[\d ().-]*\d)[\d ().-]+(?:\s*(?:ext\.?|extension|extensión|x|#)\s*\d{1,6})?$/iu;
export const phone = singleLine(contracts.phone.maxLength).pipe(phoneOrEmpty);
const generalPhone = singleLine(40).refine((value) => {
  if (value === "") return true;
  return phoneFormat.test(value) && /\d/.test(value);
}, "Escribe un teléfono con dígitos, separadores y extensión opcional de hasta 6 dígitos, o deja el campo vacío.");

export const machineCounter = singleLine(100).refine((value) => {
  if (value === "") return true;
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || !Number.isFinite(Number(value))) return false;
  const [whole, fraction = ""] = value.split(".");
  const integer = BigInt(whole || "0"), maximum = BigInt(Number.MAX_SAFE_INTEGER);
  return integer < maximum || (integer === maximum && !/[1-9]/.test(fraction));
}, "Indica un contador decimal no negativo dentro del rango seguro, o deja el campo vacío.");

export const fourDecimalNumber = (max: number) => z.number()
  .min(0, "El valor no puede ser negativo.").max(max, `El valor no puede superar ${max}.`)
  .refine((value) => {
    const [coefficient, exponent = "0"] = String(value).toLowerCase().split("e");
    const decimalPlaces = (coefficient.split(".")[1]?.length ?? 0) - Number(exponent);
    return decimalPlaces <= 4;
  }, "Usa como máximo cuatro decimales.");

export const recurringDay = z.union([
  z.string().max(2, "El día admite hasta dos dígitos.")
    .refine((value) => value === "" || (/^\d+$/.test(value) && Number(value) <= 31), "Indica un día entero entre 0 y 31, o deja el campo vacío."),
  z.number().int("El día debe ser entero.").min(0, "El día no puede ser negativo.").max(31, "El día no puede superar 31."),
]);

// Configuration keeps its existing values and unknown keys. Only active UI fields
// are validated here; checks do not normalize the stored configuration or its hash.
const configText = (max: number) => z.string({ error: "Escribe un texto." })
  .max(max, `Usa como máximo ${max} caracteres.`)
  .refine((value) => !singleLineControls.test(value), "Usa una sola línea sin caracteres de control.");
const configNumber = (min: number, max: number, empty = false, integer = false, fourDecimals = false) => z.unknown().refine((value) => {
  if (empty && value === "") return true;
  if (typeof value !== "number" && typeof value !== "string") return false;
  if (typeof value === "string" && (value.length > 80 || !(integer ? /^\d+$/ : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/).test(value))) return false;
  if (fourDecimals && typeof value === "string" && (value.split(".")[1]?.length ?? 0) > 4) return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max &&
    (!integer || Number.isInteger(number)) &&
    (!fourDecimals || fourDecimalNumber(max).safeParse(number).success);
}, `Indica ${integer ? "un entero" : "un número decimal"} entre ${min} y ${max}${fourDecimals ? ", con hasta cuatro decimales" : ""}${empty ? ", o deja el campo vacío" : ""}.`);

const knownConfigFields: Record<string, z.ZodType> = {
  receiptFooterNote: freeText(2000),
  companyLogoDataUrl: z.string().max(24576).refine((value) => value === "" || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value), "Usa una imagen PNG, JPEG o WebP en base64 de hasta 24 KiB, o deja el campo vacío."),
  "general.empresa": configText(160), "general.direccion": configText(500),
  "general.telefono": configText(40).refine((value) => generalPhone.safeParse(value).success, "Escribe un teléfono válido o deja el campo vacío."),
  "general.fax": configText(40).refine((value) => generalPhone.safeParse(value).success, "Escribe un teléfono válido o deja el campo vacío."),
  "general.correo": configText(200).refine((value) => optionalEmail.safeParse(value).success, "Escribe un correo válido o deja el campo vacío."),
  "general.licencia": configText(160), "general.moneda": configText(40),
  "cargos.servicioTm": configText(160), "cargos.conceptoTm": configText(160),
  "impresion.url": configText(500), "impresion.listadoUrl": configText(500),
  "impresion.nombre": configText(160), "impresion.listadoNombre": configText(160),
  "cobros.porcientoCdc": configNumber(0, 100, false, false, true),
  "impresion.puerto": configNumber(1, 65535, true, true),
  "impresion.listadoPuerto": configNumber(1, 65535, true, true),
  "gps.latitud": configNumber(-90, 90, true), "gps.longitud": configNumber(-180, 180, true),
};
for (const key of [
  "clientes.modificarCodigo", "clientes.requerirIdentificacion", "clientes.identificacionUnica",
  "cargos.importeConcepto", "cargos.modificarImporteConcepto", "cargos.modificarPrecio", "cargos.modificarCantidad", "cargos.enPcp", "cargos.tragamonedas",
  "descargos.modificarCantidad",
  "cobros.guardarGps", "cobros.mezclarServiciosRecibo", "cobros.cobrosParciales", "cobros.cobroSaldoPendiente", "cobros.obligarVencidos",
  "impresion.mismaImpresora", "impresion.reciboHtml", "impresion.reciboMatriz", "impresion.reciboVirtual", "impresion.listadoHtml", "impresion.listadoMatriz", "impresion.listadoVirtual",
  "interfaz.monitorInicio",
]) knownConfigFields[key] = z.boolean({ error: "Selecciona verdadero o falso." });

export const systemConfigInput = z.record(z.string(), z.unknown()).superRefine((config, context) => {
  for (const [key, schema] of Object.entries(knownConfigFields)) {
    if (!Object.hasOwn(config, key)) continue;
    const result = schema.safeParse(config[key]);
    if (!result.success) for (const issue of result.error.issues)
      context.addIssue({ code: "custom", path: [key, ...issue.path], message: issue.message });
  }
});
