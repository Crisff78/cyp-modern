import { StrictApiError } from "../../shared/remittances/strictApi";

export type RraaPreview = Readonly<{
  clientId: string; stationCode: string; deviceId: string; license: string; validatedAt: string;
}>;

export function confirmedRraaPreview(value: unknown,
  expected: Readonly<Pick<RraaPreview, "clientId" | "stationCode" | "deviceId">>): RraaPreview {
  const row = value as RraaPreview | null;
  const text = (entry: unknown, max: number) => typeof entry === "string" && entry.length > 0 && entry.length <= max &&
    entry === entry.trim() && !/[|\u0000-\u001f\u007f]/.test(entry);
  if (!row || typeof row !== "object" || Array.isArray(row) ||
      !text(row.clientId, 80) || !text(row.stationCode, 160) || !text(row.deviceId, 160) || !text(row.license, 1024) ||
      row.clientId !== expected.clientId || row.stationCode !== expected.stationCode.trim() || row.deviceId !== expected.deviceId.trim() ||
      typeof row.validatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.validatedAt) ||
      !Number.isFinite(Date.parse(row.validatedAt)) || new Date(row.validatedAt).toISOString() !== row.validatedAt)
    throw new StrictApiError("No pudimos confirmar la respuesta de RRAA para esta empresa, estación y dispositivo. Vuelve a obtener la licencia.", 200, false, "RRAA_PREVIEW_INVALID");
  return row;
}
