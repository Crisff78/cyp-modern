/** Monday–Sunday of the current business week, independent of the host timezone. */
export function currentOperationalWeek(now = new Date()): { from: string; to: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santo_Domingo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (key: string) => parts.find((part) => part.type === key)!.value;
  const local = new Date(Date.UTC(Number(value("year")), Number(value("month")) - 1, Number(value("day"))));
  local.setUTCDate(local.getUTCDate() - (local.getUTCDay() + 6) % 7);
  const from = local.toISOString().slice(0, 10);
  local.setUTCDate(local.getUTCDate() + 6);
  return { from, to: local.toISOString().slice(0, 10) };
}
