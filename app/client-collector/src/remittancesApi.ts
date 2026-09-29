import { createStrictApi } from "../../shared/remittances/strictApi";
import { getToken } from "./api";
import { isMockToken } from "./mock";

export const remittancesApi = createStrictApi(getToken, () => isMockToken(getToken()));
