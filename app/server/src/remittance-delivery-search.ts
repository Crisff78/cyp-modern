import type { State, User } from "./domain.js";
import { compact, hasLetter, normalized, phoneDigits, phoneEnds } from "./remittance-client-search.js";
import { canSeeReceipt, remittanceOperators, type Remittance } from "./remittances.js";

/**
 * The pending sends an account sees to deliver, newest first: what the window Entregas de dinero lists. With a text,
 * since version 0.9 of the text protocol an identifier is matched whole (the mobile application asked for an exact
 * search): the number of the send, of the receipt or the operating code is that text, the identification of the
 * recipient is that text (with or without hyphens), or a phone of the recipient ends in it (7 digits or more). Only a
 * text with a letter is also looked for by pieces: every word inside the names of the recipient and the sender. The
 * names, the identification and the phones are the copy saved in the send, so a send saved before that copy existed is
 * found by its numbers only.
 */
export function pendingDeliveries(state: State, actor: User, query: string): Remittance[] {
  remittanceOperators(state, actor);
  const lower = normalized(query), digits = phoneDigits(query), byPieces = hasLetter(query), terms = lower.split(/\s+/).filter(Boolean);
  return state.remittances.transfers.filter((transfer) => {
    if (transfer.status !== "pending" || !canSeeReceipt(state, actor, transfer)) return false;
    if (!lower) return true;
    const recipient = transfer.recipientContact;
    if ([transfer.envioReference, transfer.reciboReference, transfer.operatingCode].some((value) => normalized(value) === lower)) return true;
    if (recipient?.identification && compact(recipient.identification) !== "" && compact(recipient.identification) === compact(query)) return true;
    if (digits && [recipient?.phone, recipient?.cellular].some((value) => phoneEnds(value, digits))) return true;
    if (!byPieces) return false;
    const names = normalized(`${recipient?.name ?? ""} ${transfer.senderContact?.name ?? ""}`);
    return terms.every((term) => names.includes(term));
  }).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0) || b.sequence - a.sequence);
}
