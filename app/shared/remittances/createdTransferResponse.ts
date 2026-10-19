import { StrictApiError } from "./strictApi";
import { managerCommissionMatches } from "./suggestions";
import type { NewRemittanceClient, Quotation, RemittanceContact, Transfer } from "./types";

// A phone is the same however it is written: the server compares only its digits.
const phoneDigits = (value: string) => value.replace(/\D/g, "");

/** The phone written for the recipient of one transfer, sent only when its digits differ from the record's. */
export function changedRecipientPhone(typed: string, known: string) {
  const phone = typed.trim();
  return phone && phoneDigits(phone) !== phoneDigits(known) ? phone : "";
}

/**
 * Where the phone written for the recipient of one transfer is also kept, as the server saves it: a new record
 * without its own phone keeps it whoever registers the transfer; an existing record without phone takes it only
 * from administration, and never when it is the cellular of the record. Otherwise only the transfer carries it.
 */
export function recipientPhoneRecord(typed: string, contact: Pick<RemittanceContact, "phone" | "cellular">, newRecord: NewRemittanceClient | undefined, isAdmin: boolean): "newRecord" | "existingRecord" | "transferOnly" {
  if (!typed.trim()) return "transferOnly";
  if (newRecord) return newRecord.phone.trim() ? "transferOnly" : "newRecord";
  return isAdmin && !contact.phone && phoneDigits(typed) !== phoneDigits(contact.cellular) ? "existingRecord" : "transferOnly";
}

/** Only offer the saved receipt after the API confirms the original operation. */
export function confirmedCreatedTransfer(value: unknown, expected: Record<string, unknown>, actorId: string, quotation?: Quotation): Transfer {
  const row = value as Transfer | null;
  const expectedQuote = expected.quote as Transfer["quote"];
  const contactValid = (contact: RemittanceContact | undefined, id: string) => contact === undefined ||
    Boolean(contact && contact.id === id && [contact.code, contact.name, contact.phone, contact.cellular, contact.address].every((field) => typeof field === "string"));
  const clientValid = (side: "sender" | "recipient") => {
    if (!row) return false;
    const id = row[`${side}ClientId`], draft = expected[side === "sender" ? "newSenderClient" : "newRecipientClient"] as NewRemittanceClient | undefined;
    if (!draft) return typeof id === "string" && id === expected[`${side}ClientId`];
    const contact = row[`${side}Contact`];
    // The record keeps its own phone unless the one written for the transfer has other digits (as the server does).
    const phone = (side === "recipient" && typeof expected.recipientPhone === "string" && changedRecipientPhone(expected.recipientPhone, draft.phone)) || draft.phone;
    return Boolean(typeof id === "string" && id && contact && contact.id === id && contact.name === draft.name.trim() && contact.identification === draft.identification.trim() && contact.address === draft.address.trim() && contact.phone === phone);
  };
  const valid = Boolean(row && typeof row === "object" && !Array.isArray(row) &&
    [row.id, row.envioReference, row.reciboReference, row.operatingCode, row.sendingUserId].every((field) => typeof field === "string" && field.length > 0) &&
    row.registeredBy === actorId && row.sendingUserId === (expected.sendingUserId ?? actorId) && row.status === "pending" &&
    clientValid("sender") && clientValid("recipient") && row.senderClientId !== row.recipientClientId &&
    ["sourceCurrency", "destinationCurrency", "amount", "commissionBps"].every((field) => row[field as keyof Transfer] === expected[field]) &&
    [row.amount, row.commissionBps, row.commissionAmount, row.totalAmount, row.receiveAmount].every((amount) => Number.isSafeInteger(amount) && amount >= 0) &&
    typeof row.createdAt === "string" && Number.isFinite(Date.parse(row.createdAt)) && typeof row.note === "string" &&
    row.quote && ["date", "sourceRate", "destinationRate"].every((field) => typeof row.quote[field as keyof Transfer["quote"]] === "string" && row.quote[field as keyof Transfer["quote"]] === expectedQuote?.[field as keyof Transfer["quote"]]) &&
    contactValid(row.senderContact, row.senderClientId) && contactValid(row.recipientContact, row.recipientClientId) &&
    (!quotation || (
      ["amountDop", "requestedReceiveAmount", "receiveRoundingDifference", "receiveAmount", "commissionAmount", "totalAmount"].every((key) => row[key as keyof Transfer] === quotation[key as keyof Quotation]) &&
      (!quotation.commissionAllocation || (row.commissionAllocation?.managerId === row.sendingUserId && typeof row.commissionAllocation?.managerName === "string" &&
        Object.entries(quotation.commissionAllocation).every(([key, value]) => row.commissionAllocation?.[key as keyof NonNullable<Transfer["commissionAllocation"]>] === value)))
    )) &&
    managerCommissionMatches(expected.managerCommission as Transfer["managerCommission"], row.managerCommission));
  // An answer 200 means the API finished this operation, and a retry with the same key repeats the same answer:
  // the window does not wait for another one. It names the saved reference so the operator checks it in the list.
  if (!valid) {
    const reference = row && typeof row === "object" && typeof row.envioReference === "string" && /^[A-Z0-9-]{1,40}$/.test(row.envioReference) ? ` ${row.envioReference}` : "";
    throw new StrictApiError(`La API respondió que registró el envío${reference}, pero su respuesta no coincide con los datos enviados. Revisa el envío en el listado antes de registrar otro; no lo repitas sin comprobarlo.`, 200, false, "REMITTANCE_CONFIRMATION_INVALID");
  }
  return row!;
}
