import { listLocalStationInstallations } from "../../shared/remittances/localStationInstallations";
import { StrictApiError } from "../../shared/remittances/strictApi";
import { readSessionStations, type SessionStation } from "../../shared/sessionStationsApi";
import { remittancesApi } from "./remittancesApi";
import { getOrCreateStationInstallationKey } from "./stationInstallationKey";
import { invalidResponse, registrationChallenge, sendPending, signInstallationRequest, validSummary, type PendingRequest } from "./stationInstallationRequests";

type StationChoice = Pick<SessionStation, "name" | "number">;
type PendingRegistration = { station: StationChoice; stationId: string; request: PendingRequest };
const pending = new Map<string, PendingRegistration>();
const sameStation = (a: StationChoice, b: StationChoice) => a.number === b.number && a.name === b.name;

export async function registerSessionStation(actorId: string, choice: StationChoice) {
  if (!navigator.locks) throw new Error("Abre CyP en un navegador con conexión segura para registrar esta estación.");
  await navigator.locks.request("cyp-register-session-station", async () => {
    let intent = pending.get(actorId);
    if (!intent || !sameStation(intent.station, choice)) {
      const installations = await listLocalStationInstallations();
      const stations = await readSessionStations(remittancesApi, installations);
      if (stations.some(row => row.linked) || !stations.some(row => sameStation(row, choice))) {
        window.dispatchEvent(new Event("cyp-stations-updated"));
        throw new Error("El listado de estaciones cambió. Comprueba la estación en uso.");
      }
      const previousChoice = intent?.station;
      if (previousChoice && stations.some(row => sameStation(row, previousChoice)))
        throw new Error(`Reintenta primero el registro pendiente de ${previousChoice.number} · ${previousChoice.name}.`);
      // A removed, renamed or inactive target cannot pass the transactional check on its original request.
      pending.delete(actorId);
      const catalog = await remittancesApi<Array<StationChoice & { id: string; active: boolean }>>("/estaciones");
      const matches = catalog.filter(row => row.active && sameStation(row, choice));
      if (matches.length !== 1) throw new Error("La estación seleccionada cambió. Actualiza el listado.");
      const stationId = matches[0].id;
      const identity = await getOrCreateStationInstallationKey(stationId);
      const request = await signInstallationRequest(registrationChallenge(stationId, identity), stationId, actorId,
        { number: choice.number, name: choice.name, installations });
      intent = { station: choice, stationId, request };
      pending.set(actorId, intent);
    }
    try {
      const result = await sendPending(intent.request);
      if (!validSummary(result, intent.stationId, intent.request.installationId) || result.status !== "active") throw invalidResponse();
      pending.delete(actorId);
    } catch (error) {
      const uncertain = error instanceof StrictApiError && (error.uncertain ||
        (intent.request.uncertain && [0, 401, 403, 429].includes(error.status)));
      if (uncertain) intent.request.uncertain = true;
      else pending.delete(actorId);
      throw error;
    }
    window.dispatchEvent(new Event("cyp-stations-updated"));
  });
}
