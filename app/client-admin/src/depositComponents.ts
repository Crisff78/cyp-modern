import { businessDate, currencyCode } from "./adminFinance";
import type { DepositComponent, Movement } from "./types";

export type NonCashDepositLine = {
  id: string;
  method: "cheque" | "bank_deposit";
  amount: string;
  bank: string;
  reference: string;
};
export const MAX_DEPOSIT_CENTS = 1_000_000_000;

export function depositInputCents(input: string) {
  const value = input.trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value))
    throw new Error("Escribe un importe válido con un máximo de dos decimales.");
  const [units, decimals = ""] = value.replace(",", ".").split(".");
  const cents = BigInt(units) * 100n + BigInt(decimals.padEnd(2, "0"));
  if (cents <= 0n || cents > BigInt(MAX_DEPOSIT_CENTS))
    throw new Error(`Cada importe debe estar entre 1 y ${MAX_DEPOSIT_CENTS} centavos.`);
  return Number(cents);
}

function nonCashComponents(lines: readonly NonCashDepositLine[]): DepositComponent[] {
  return lines.map((line) => {
    if (!["cheque", "bank_deposit"].includes(line.method)) throw new Error("Selecciona cheque o depósito bancario.");
    const bank = line.bank.trim(), reference = line.reference.trim();
    if (!bank || !reference || bank.length > 160 || reference.length > 160)
      throw new Error("Cada cheque o depósito bancario necesita banco y referencia (máximo 160 caracteres).");
    return { method: line.method, amount: depositInputCents(line.amount), bank, reference };
  });
}

export function nonCashDepositAmount(lines: readonly NonCashDepositLine[]) {
  const total = nonCashComponents(lines).reduce((sum, line) => sum + BigInt(line.amount), 0n);
  if (total > BigInt(MAX_DEPOSIT_CENTS)) throw new Error("El total excede el importe máximo del depósito.");
  return Number(total);
}

export function buildDepositComponents(cashAmount: number, lines: readonly NonCashDepositLine[]) {
  if (!Number.isSafeInteger(cashAmount) || cashAmount < 0 || cashAmount > MAX_DEPOSIT_CENTS)
    throw new Error("El desglose de efectivo contiene cantidades inválidas o fuera del rango permitido.");
  const components: DepositComponent[] = [
    ...(cashAmount > 0 ? [{ method: "cash" as const, amount: cashAmount }] : []),
    ...nonCashComponents(lines),
  ];
  if (components.length < 1 || components.length > 20) throw new Error("Indica entre 1 y 20 componentes, incluido el efectivo.");
  const total = components.reduce((sum, line) => sum + BigInt(line.amount), 0n);
  if (total > BigInt(MAX_DEPOSIT_CENTS)) throw new Error("El total excede el importe máximo del depósito.");
  return { amount: Number(total), cashAmount, components };
}

export function depositComponentsMatch(received: unknown, expected: readonly DepositComponent[]) {
  if (!Array.isArray(received) || received.length !== expected.length) return false;
  return expected.every((line, index) => {
    const row = received[index];
    return row && typeof row === "object" && !Array.isArray(row) && row.method === line.method && row.amount === line.amount &&
      row.bank === line.bank && row.reference === line.reference &&
      Object.keys(row).every((key) => ["method", "amount", "bank", "reference"].includes(key));
  });
}

export function confirmedDepositMatches(value: unknown, expected: {
  collectorId: string; amount: number; currency: string; depositComponents: readonly DepositComponent[];
  denominations?: readonly { denominacion: number; cantidad: number }[];
}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const movement = value as Movement;
  return typeof movement.id === "string" && Boolean(movement.id) && movement.type === "deposit" &&
    movement.collectorId === expected.collectorId && movement.amount === expected.amount &&
    (movement.currency === undefined || typeof movement.currency === "string") &&
    currencyCode(movement.currency) === currencyCode(expected.currency) && typeof movement.createdAt === "string" &&
    Boolean(businessDate(movement.createdAt)) && depositComponentsMatch(movement.depositComponents, expected.depositComponents) &&
    (expected.denominations === undefined || Array.isArray(movement.denominations) && movement.denominations.length === expected.denominations.length &&
      expected.denominations.every((line, index) => movement.denominations![index]?.denominacion === line.denominacion &&
        movement.denominations![index]?.cantidad === line.cantidad));
}

export function depositCashTotal(movement: Pick<Movement, "amount" | "depositComponents">) {
  if (movement.depositComponents === undefined) return movement.amount;
  return movement.depositComponents.filter((line) => line.method === "cash").reduce((sum, line) => sum + line.amount, 0);
}

export const depositMethodLabel = (method: DepositComponent["method"]) => ({
  cash: "Efectivo", cheque: "Cheque", bank_deposit: "Depósito bancario",
})[method];
