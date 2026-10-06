/** Keep spreadsheet formulas inert, including prefixes hidden behind whitespace. */
export function neutralizeCsvFormula(value: unknown): string {
  const text = String(value ?? "");
  return /^\s*[=+@\-]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
}

export function encodeCsvCell(value: unknown, delimiter = ";", alwaysQuote = false): string {
  const text = neutralizeCsvFormula(value);
  const escaped = text.replace(/"/g, '""');
  return alwaysQuote || text.includes(delimiter) || /["\r\n]/.test(text) ? `"${escaped}"` : escaped;
}
