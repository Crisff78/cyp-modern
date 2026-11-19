import type { StationInstallationRef } from "../server/src/station-installation-protocol";
import type { StrictApi } from "./remittances/strictApi";

export type SessionStation = { name: string; number: string; linked: boolean };

export function readSessionStations(api: StrictApi, installations: StationInstallationRef[]) {
  return api<SessionStation[]>("/auth/estaciones", { method: "POST", readOnly: true, body: JSON.stringify({ installations }) });
}
