/** ASCII digits; an optional comma must delimit complete groups of three. */
export function ungroupDecimal(value: string, draft = false, decimalDigits = 2): string | undefined {
  if (draft && (value === "" || value === ".")) return value;
  const fraction = draft ? `{0,${decimalDigits}}` : `{1,${decimalDigits}}`;
  if (!new RegExp(`^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\\.[0-9]${fraction})?$`).test(value)) return undefined;
  return value.replaceAll(",", "");
}
