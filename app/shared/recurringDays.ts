import contracts from "./input-contracts.json";

/** Empty HTML inputs become null; API strings must contain only one or two digits. */
export function recurringDayFromInput(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const rules = contracts.recurringDay;
  let day = value;
  if (typeof value === "string" && new RegExp(rules.numericStringPattern).test(value)) day = Number(value);
  if (typeof day !== "number" || !Number.isInteger(day) || day < rules.min || day > rules.max)
    throw new Error("El día debe ser un entero de 1 a 31 o quedar vacío cuando no se utiliza.");
  return day;
}
