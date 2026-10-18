import { StrictApiError } from "./strictApi";
import { managerCommissionMatches } from "./suggestions";
import type { NewRemittanceClient, Quotation, RemittanceContact, Transfer } from "./types";

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
    const phone = side === "recipient" && expected.recipientPhone ? expected.recipientPhone : draft.phone;
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
  if (!valid) throw new StrictApiError("La respuesta no confirmó el envío guardado. Conservamos los datos: reintenta esta misma operación sin cambiarlos.", 200, true, "REMITTANCE_CONFIRMATION_INVALID");
  return row!;
}
