import type { State, User } from "./domain.js";
import { normalized, phoneMatches } from "./remittance-client-search.js";
import { canSeeReceipt, remittanceOperators, type Remittance } from "./remittances.js";

/**
 * The pending sends an account sees to deliver, newest first: what the window Entregas de dinero lists. With a text,
 * those that have all its words among the numbers of the send, the names and the identification of the recipient
 * (with or without hyphens), or the digits in a phone of the recipient. The names, the identification and the phones
 * are the copy saved in the send, so a send saved before that copy existed is found by its numbers only.
 */
export function pendingDeliveries(state: State, actor: User, query: string): Remittance[] {
  remittanceOperators(state, actor);
  const terms = normalized(query).split(/\s+/).filter(Boolean);
  const digits = /^[+\d\s().-]+$/.test(query) ? query.replace(/\D/g, "") : "";
  const identityQuery = normalized(query).replace(/[\s-]/g, "");
  return state.remittances.transfers.filter((transfer) => {
    if (transfer.status !== "pending" || !canSeeReceipt(state, actor, transfer)) return false;
    if (!terms.length) return true;
    const recipient = transfer.recipientContact;
    const text = normalized(`${transfer.envioReference} ${transfer.reciboReference} ${transfer.operatingCode} ${recipient?.name ?? ""} ${transfer.senderContact?.name ?? ""} ${recipient?.identification ?? ""}`);
    const identity = normalized(recipient?.identification ?? "").replace(/[\s-]/g, "");
    return terms.every((term) => text.includes(term)) || (identityQuery.length >= 3 && identity.includes(identityQuery)) ||
      (digits.length >= 3 && [recipient?.phone, recipient?.cellular].some((value) => phoneMatches(value, digits)));
  }).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0) || b.sequence - a.sequence);
}
