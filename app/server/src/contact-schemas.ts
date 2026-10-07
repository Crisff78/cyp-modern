import { z } from "zod";
import contracts from "../../shared/input-contracts.json" with { type: "json" };
const contactPhonePattern = new RegExp(contracts.phone.pattern);

/** Empty contacts remain optional; names, addresses and passwords use their own contracts. */
export const phoneOrEmpty = z.string().trim().max(contracts.phone.maxLength).refine((value) => {
  if (value === "") return true;
  if (!contactPhonePattern.test(value)) return false;
  const digitCount = value.replace(/[^0-9]/g, "").length;
  return digitCount >= contracts.phone.minDigits && digitCount <= contracts.phone.maxDigits;
}, contracts.phone.message);

export const emailOrEmpty = z.string().trim().max(contracts.email.maxLength).pipe(
  z.union([z.literal(""), z.string().email("Escribe un correo válido.")]),
);
