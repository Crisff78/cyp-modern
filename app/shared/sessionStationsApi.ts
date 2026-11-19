import type { StationInstallationRef } from "../server/src/station-installation-protocol";
import type { StrictApi } from "./remittances/strictApi";

export type SessionStation = { name: string; number: string; linked: boolean };
export type StationChoice = Pick<SessionStation, "name" | "number">;
const lastStationKey = "cyp-last-verified-station";

export function rememberSessionStation(stations: SessionStation[]) {
  const linked = stations.filter(station => station.linked);
  try {
    if (linked.length === 1) localStorage.setItem(lastStationKey, linked[0].number);
    else localStorage.removeItem(lastStationKey);
  } catch { /* Storage preferences do not determine the installation. */ }
}

export function lastStationNumber() {
  try { return localStorage.getItem(lastStationKey); } catch { return null; }
}

export function readSessionStations(api: StrictApi, installations: StationInstallationRef[]) {
  return api<SessionStation[]>("/auth/estaciones", { method: "POST", readOnly: true, body: JSON.stringify({ installations }) });
}
