export const businessDate = (value: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santo_Domingo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(timestamp) : "";
};

export const businessTimestamp = (value: string) => {
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toLocaleString("es-DO", {
    timeZone: "America/Santo_Domingo",
  }) : "";
};

export const currencyCode = (value?: string) => {
  const normalized = (value ?? "DOP").trim().toLowerCase();
  if (["dop", "peso dominicano", "peso dominicano (dop)"].includes(normalized)) return "DOP";
  if (["usd", "dólar americano", "dolar americano", "dólar americano (usd)", "dólar estadounidense", "dolar estadounidense"].includes(normalized)) return "USD";
  if (["eur", "euro", "euro (eur)"].includes(normalized)) return "EUR";
  return "";
};

const currencyNames: Record<string, string> = { DOP: "Peso Dominicano", USD: "Dólar Americano", EUR: "Euro" };
const currencySymbols: Record<string, string> = { DOP: "RD$", USD: "US$", EUR: "€" };
export const currencyName = (value?: string) => currencyNames[currencyCode(value)] ?? value ?? "Peso Dominicano";

export const nativeMoney = (cents: number | bigint, currency?: string) => {
  const code = currencyCode(currency);
  const symbol = currencySymbols[code] ?? currency ?? "";
  if (typeof cents === "number" && !Number.isSafeInteger(cents)) throw new Error("El importe excede el rango seguro de centavos.");
  const value = BigInt(cents);
  const absolute = value < 0n ? -value : value;
  const units = new Intl.NumberFormat("es-DO", { maximumFractionDigits: 0 }).format(absolute / 100n);
  const decimal = new Intl.NumberFormat("es-DO").formatToParts(1.1).find((part) => part.type === "decimal")?.value ?? ".";
  return `${symbol} ${value < 0n ? "-" : ""}${units}${decimal}${String(absolute % 100n).padStart(2, "0")}`;
};

export const financeMatches = (date: string, currency: string | undefined, from: string, to: string, selected: string) =>
  (!from || Boolean(date) && date >= from) && (!to || Boolean(date) && date <= to)
  && (selected === "No definido" || currencyCode(currency) === currencyCode(selected));

export const collectionCash = (movements: readonly { collectorId: string; type: string; amount: number; currency?: string; cancelledAt?: string }[], collectorId: string, currency: string) =>
  movements.filter((movement) => movement.collectorId === collectorId && !movement.cancelledAt && currencyCode(movement.currency) === currencyCode(currency))
    .reduce((cash, movement) => cash + (movement.type === "collection" ? movement.amount : movement.type === "deposit" ? -movement.amount : 0), 0);

export const nativeTotals = (rows: readonly { currency?: string; amount: number | bigint }[], emptyCurrency = "DOP") => {
  const totals = new Map<string, bigint>();
  for (const row of rows) {
    if (typeof row.amount === "number" && !Number.isSafeInteger(row.amount)) throw new Error("El importe excede el rango seguro de centavos.");
    const code = currencyCode(row.currency);
    totals.set(code, (totals.get(code) ?? 0n) + BigInt(row.amount));
  }
  return [...totals].map(([code, cents]) => {
    return nativeMoney(cents, code || "Moneda no definida");
  }).join(" · ") || nativeMoney(0, emptyCurrency);
};

export const centsInput = (cents: number) => {
  if (!Number.isSafeInteger(cents)) throw new Error("El importe excede el rango seguro de centavos.");
  const value = BigInt(cents);
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
};

export const decimalProductCents = (price: string, quantity: string) => {
  const hundredths = (input: string) => {
    if (!/^\d+(\.\d{1,2})?$/.test(input)) throw new Error("Escribe importe y cantidad válidos con un máximo de dos decimales.");
    const [whole, fraction = ""] = input.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  };
  const cents = (hundredths(price) * hundredths(quantity) + 50n) / 100n;
  if (cents <= 0n || cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("El importe total debe ser positivo y estar dentro del rango seguro de centavos.");
  return Number(cents);
};

export const obligationReceived = (item: { currency?: string; currencyConflict?: boolean; collected?: number; paid?: number; collectedByCurrency?: Record<string, number>; paidByCurrency?: Record<string, number> }) =>
  item.currencyConflict ? Object.entries(item.collectedByCurrency ?? item.paidByCurrency ?? {}).filter(([, amount]) => amount !== 0).map(([currency, amount]) => ({ currency, amount }))
    : [{ currency: item.currency, amount: item.collected ?? item.paid ?? 0 }];
