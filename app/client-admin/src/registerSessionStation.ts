import { createStationRegistrar } from "../../shared/registerSessionStation";
import { remittancesApi } from "./remittancesApi";

export const registerSessionStation = createStationRegistrar(remittancesApi);
