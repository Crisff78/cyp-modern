import { z } from "zod";
import contracts from "../../shared/input-contracts.json" with { type: "json" };

/** Empty contacts remain optional; names, addresses and passwords use their own contracts. */
export const phoneOrEmpty = z.string().trim().max(contracts.phone.maxLength).refine((value) => {
  if (value === "") return true;
  if (!/^\+?[0-9() -]+$/.test(value)) return false;
  const digitCount = value.replace(/[^0-9]/g, "").length;
  return digitCount >= contracts.phone.minDigits && digitCount <= contracts.phone.maxDigits;
}, "Escribe un teléfono válido con 8 a 15 dígitos; admite + al inicio, espacios, guiones y paréntesis.");

export const emailOrEmpty = z.string().trim().max(contracts.email.maxLength).pipe(
  z.union([z.literal(""), z.string().email("Escribe un correo válido.")]),
);
