import { listLocalStationInstallations } from "./remittances/localStationInstallations";
import { StrictApiError, type StrictApi } from "./remittances/strictApi";
import { readSessionStations, type StationChoice } from "./sessionStationsApi";
import { getOrCreateStationInstallationKey } from "./stationInstallationKey";
import { invalidResponse, registrationChallenge, sendPending, signInstallationRequest, validSummary, type PendingRequest } from "./stationInstallationRequests";

type PendingRegistration = { station: StationChoice; stationId: string; request: PendingRequest };

const sameStation = (a: StationChoice, b: StationChoice) => a.number === b.number && a.name === b.name;

export function createStationRegistrar(api: StrictApi) {
  const pending = new Map<string, PendingRegistration>();
  return async function registerStation(actorId: string, choice: StationChoice, login?: { canRegister: boolean; onlyExisting?: boolean }) {
    if (!navigator.locks) throw new Error("Abre CyP en un navegador con conexión segura para registrar esta estación.");
    await navigator.locks.request("cyp-register-session-station", async () => {
      let intent = pending.get(actorId);
      if (!intent || !sameStation(intent.station, choice)) {
        const installations = await listLocalStationInstallations();
        const stations = await readSessionStations(api, installations);
        const linked = stations.filter(row => row.linked);
        if (login && linked.length === 1 && sameStation(linked[0], choice)) return;
        if (linked.length || !stations.some(row => sameStation(row, choice))) {
          window.dispatchEvent(new Event("cyp-stations-updated"));
          if (login && linked.length === 1) throw new Error(`Este navegador está vinculado a ${linked[0].number} · ${linked[0].name}. Elige esa estación o usa el vínculo actual.`);
          if (login && linked.length > 1) throw new Error("Este navegador tiene varios vínculos. Usa el vínculo actual para entrar y revísalos en Estaciones.");
          throw new Error("El listado de estaciones cambió. Comprueba la estación en uso.");
        }
        if (login?.onlyExisting) throw new Error("La última estación usada ya no está vinculada. Elige la estación que usarás o entra con «Usar vínculo actual».");
        if (login && !login.canRegister) throw new Error("Para registrar este navegador se necesita permiso de edición de estaciones. Puedes entrar con «Usar vínculo actual».");
        const previousChoice = intent?.station;
        if (previousChoice && stations.some(row => sameStation(row, previousChoice)))
          throw new Error(`Reintenta primero el registro pendiente de ${previousChoice.number} · ${previousChoice.name}.`);
        // A removed, renamed or inactive target cannot pass the transactional check on its original request.
        pending.delete(actorId);
        const catalog = await api<Array<StationChoice & { id: string; active: boolean }>>("/estaciones");
        const matches = catalog.filter(row => row.active && sameStation(row, choice));
        if (matches.length !== 1) throw new Error("La estación seleccionada cambió. Actualiza el listado.");
        const stationId = matches[0].id;
        const identity = await getOrCreateStationInstallationKey(stationId);
        const request = await signInstallationRequest(api, registrationChallenge(stationId, identity), stationId, actorId,
          { number: choice.number, name: choice.name, installations });
        intent = { station: choice, stationId, request };
        pending.set(actorId, intent);
      }
      try {
        const result = await sendPending(api, intent.request);
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
  };
}
