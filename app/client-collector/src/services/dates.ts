export const BUSINESS_TIME_ZONE = "America/Santo_Domingo";

const calendarDate = /^\d{4}-\d{2}-\d{2}$/;
const dateOptions = { day: "numeric", month: "long" } as const;
const calendarFormatter = new Intl.DateTimeFormat("es-DO", {
  ...dateOptions,
  timeZone: "UTC",
});
const timestampFormatter = new Intl.DateTimeFormat("es-DO", {
  ...dateOptions,
  hour: "2-digit",
  minute: "2-digit",
  timeZone: BUSINESS_TIME_ZONE,
});
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: BUSINESS_TIME_ZONE,
});
const clockFormatter = new Intl.DateTimeFormat("es-DO", {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZone: BUSINESS_TIME_ZONE,
});

// ISO timestamps without an offset use UTC, never the device's local zone.
const instant = (value: string) =>
  new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`);

export function dateLabel(value: string): string {
  // A calendar date has no time zone. Parse and format it in UTC to keep its day.
  return calendarDate.test(value)
    ? calendarFormatter.format(new Date(`${value}T00:00:00Z`))
    : timestampFormatter.format(instant(value));
}

export function businessDay(value: string): string {
  if (calendarDate.test(value)) return value;
  const parts = dayFormatter.formatToParts(instant(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export const timeLabel = (value: Date): string => clockFormatter.format(value);
