import { z } from "zod";
import { ledgerCurrencies } from "./domain.js";
import { boundedId, singleLine, phone, optionalEmail, freeText } from "./input-validation.js";
import { phoneOrEmpty, emailOrEmpty } from "./contact-schemas.js";

export const clientInput = z.object({
  name: singleLine(160, 1), code: singleLine(80, 1), phone: phone.pipe(phoneOrEmpty).default(""),
  address: singleLine(240).default(""), routeId: boundedId,
  preferredCurrency: z.enum(ledgerCurrencies).optional(), alias: singleLine(160).default(""),
  sector: singleLine(160).default(""), cellular: phone.pipe(phoneOrEmpty).default(""),
  email: optionalEmail.pipe(emailOrEmpty).default(""), note: freeText(2000).default(""),
  identification: singleLine(80).default(""), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(),
}).strict();
export const remittanceClientDraft = clientInput.pick({ name: true, phone: true, address: true, routeId: true, identification: true, preferredCurrency: true })
  .refine((value) => value.identification.length > 0, { path: ["identification"], message: "Indica la cédula o el pasaporte del cliente." });
export type RemittanceClientDraft = z.infer<typeof remittanceClientDraft>;
