import { randomBytes } from "node:crypto";
import { businessDate, hashPassword, type State } from "./domain.js";
import type { AuthorizationRequest } from "./admin-tools.js";

const prefix = "demo-v2-";
const id = (suffix: string) => `${prefix}${suffix}`;
const pad = (value: number) => String(value).padStart(2, "0");
const example = "DEMO V2 · Ejemplo ficticio para revisar la aplicación.";
const actorId = "demo-admin";

function appendMissing<T extends { id: string }>(rows: T[], row: T) {
  if (!rows.some((current) => current.id === row.id)) rows.push(row);
}

/**
 * Adds catalog examples to the isolated demo-v2 fixture before its ledger is built.
 * The caller owns demo-mode gating, the merge and the persistent version marker.
 * No session, financial movement or usable account is created here.
 */
export function fillDemoCatalogs(state: State, now: Date): void {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid demo catalog date");
  const routes = [1, 2, 3].map((number) => {
    const route = state.routes.find((row) => row.id === id(`route-${number}`));
    if (!route || route.collectorId !== id(`col-${number}`) || route.zoneId !== id(`zone-${number}`) ||
        !state.collectors.some((row) => row.id === route.collectorId))
      throw new Error("Demo catalog fixture requires its three routes and collectors");
    return route;
  });
  const clients = Array.from({ length: 24 }, (_, index) => {
    const client = state.clients.find((row) => row.id === id(`client-${pad(index + 1)}`));
    if (!client || client.routeId !== routes[Math.floor(index / 8)].id)
      throw new Error("Demo catalog fixture requires eight clients per route");
    return client;
  });
  const at = (daysAgo: number, minutesAgo = 0) =>
    new Date(now.getTime() - daysAgo * 86_400_000 - minutesAgo * 60_000).toISOString();
  const date = (daysAgo: number) => businessDate(new Date(at(daysAgo)));
  const data = state.adminTools;

  for (const [index, route] of routes.entries()) {
    const number = index + 1;
    appendMissing(state.zones, {
      id: id(`zone-${number}`), name: `DEMO V2 · Zona ${number}`, sector: route.sector,
      number: `DEMO-V2-Z${number}`, from: `DEMO-V2-${pad(index * 8 + 1)}`,
      to: `DEMO-V2-${pad(number * 8)}`, active: true,
    });
    appendMissing(data.pcpGroups, { id: id(`pcp-group-${number}`), name: `DEMO V2 · Grupo de puntos ${number}` });
  }

  const serviceNames = ["Servicio semanal", "Mantenimiento", "Distribución", "Servicio adicional", "Servicio archivado"];
  serviceNames.forEach((name, index) => appendMissing(state.services, {
    id: id(`service-${index + 1}`), service: `DEMO V2 · ${name}`, abbr: `DV${index + 1}`,
    caption: `${example} ${name}.`, obligated: index < 2, fixedAmount: index !== 3, active: index !== 4,
  }));
  ["Visita reprogramada", "Cliente ausente", "Revisión del importe", "Motivo archivado"].forEach((reason, index) =>
    appendMissing(state.delayReasons, { id: id(`delay-reason-${index + 1}`), reason: `DEMO V2 · ${reason}`, active: index !== 3 }));

  for (let index = 0; index < 6; index += 1) {
    const number = index + 1, groupNumber = Math.floor(index / 2) + 1;
    const pcpId = id(`pcp-${number}`), stationId = id(`station-${number}`);
    appendMissing(data.pcps, {
      id: pcpId, number: `DEMO-V2-PCP-${pad(number)}`, name: `DEMO V2 · Punto de cobros y pagos ${number}`,
      groupId: id(`pcp-group-${groupNumber}`), address: `Dirección ficticia, zona de ejemplo ${groupNumber}`,
      phone: "", active: number !== 6,
    });
    appendMissing(data.stations, {
      id: stationId, number: `DEMO-V2-EST-${pad(number)}`, name: `DEMO V2 · Estación ${number}`,
      deviceId: `DEMO-V2-DISPOSITIVO-${pad(number)}`, description: example,
      group: `DEMO V2 · Grupo de puntos ${groupNumber}`, type: index % 2 === 0 ? "Demo escritorio" : "Demo tableta",
      license: "", version: "", active: number !== 6,
    });
    if (!data.pcpStations.some((row) => row.pcpId === pcpId && row.stationId === stationId))
      data.pcpStations.push({ pcpId, stationId });
  }

  clients.forEach((client, index) => {
    const service = state.services.find((row) => row.id === id(`service-${index % 4 + 1}`))!;
    const active = index % 6 !== 5;
    const frequency = ["Semanal", "Quincenal", "Mensual", "Trimestral"][index % 4];
    appendMissing(state.recurringCharges, {
      id: id(`recurring-charge-${pad(index + 1)}`), clientId: client.id, routeId: client.routeId, serviceId: service.id,
      registeredAt: at(32, index), startDate: date(30), endDate: active ? "" : date(7), frequency,
      day1: frequency === "Semanal" ? "1" : "5", day2: frequency === "Quincenal" ? "20" : "",
      currency: "DOP", service: service.service, concept: `DEMO V2 · Cuota de ejemplo ${pad(index + 1)}`,
      useConceptAmount: false, amount: 35_000 + index % 6 * 12_500,
      note: `${example} Plantilla sin generación automática.`, active,
    });
  });

  // Counter logs follow the same initial/update semantics as the machine API;
  // their charge field is informational and does not create a ledger charge.
  clients.filter((_, index) => index % 2 === 0).forEach((client, index) => {
    const machineId = id(`machine-${pad(index + 1)}`), number = index + 1;
    const previousEntry = 1_000 + index * 100, previousExit = 200 + index * 20;
    const entry = previousEntry + 80 + index * 5, exit = previousExit + 20 + index;
    const value = 100 + index * 20, percentage = 25;
    const registeredAt = at(14, index), updatedAt = at(2, index);
    appendMissing(state.clientMachines, {
      id: machineId, clientId: client.id, number, entry: String(entry), exit: String(exit),
      value, percentage, registeredAt, updatedAt,
    });
    appendMissing(state.clientMachineLogs, {
      id: id(`machine-log-${pad(number)}-initial`), clientId: client.id, machineId, registeredAt,
      previousEntry: "", entry: String(previousEntry), entryDifference: String(previousEntry),
      previousExit: "", exit: String(previousExit), exitDifference: String(previousExit), difference: "",
      currency: "DOP", amount: value, percentage, charge: 0,
    });
    appendMissing(state.clientMachineLogs, {
      id: id(`machine-log-${pad(number)}-update`), clientId: client.id, machineId, registeredAt: updatedAt,
      previousEntry: String(previousEntry), entry: String(entry), entryDifference: String(entry - previousEntry),
      previousExit: String(previousExit), exit: String(exit), exitDifference: String(exit - previousExit),
      difference: String(entry - previousEntry - (exit - previousExit)), currency: "DOP", amount: value,
      percentage, charge: value * percentage / 100, modifiedAt: updatedAt,
    });
  });

  const statuses: AuthorizationRequest["status"][] = ["pending", "approved", "rejected", "cancelled"];
  for (let index = 0; index < 12; index += 1) {
    const client = clients[index * 2], route = routes.find((row) => row.id === client.routeId)!;
    const requestId = id(`authorization-${pad(index + 1)}`), status = statuses[index % statuses.length];
    const createdAt = at(4 + Math.floor(index / 4), index), resolvedAt = at(3 + Math.floor(index / 4), index);
    appendMissing(data.authorizationRequests, {
      id: requestId, clientId: client.id, collectorId: route.collectorId, delayReasonId: id(`delay-reason-${index % 3 + 1}`),
      forCollection: index % 2 === 0, note: `${example} Solicitud ${pad(index + 1)} de ${index % 2 === 0 ? "cobro" : "pago"}.`,
      status, createdAt, createdBy: actorId,
      ...(status === "pending" ? {} : { resolvedAt, resolvedBy: actorId, resolutionNote: `DEMO V2 · Decisión de ejemplo: ${status === "approved" ? "aprobada" : status === "rejected" ? "rechazada" : "anulada"}.` }),
    });
    appendMissing(data.traces, {
      id: id(`trace-authorization-${pad(index + 1)}-created`), actorId,
      action: "demo.example.request.created", resource: "solicitudes-autorizacion", resourceId: requestId, createdAt,
    });
    if (status !== "pending") appendMissing(data.traces, {
      id: id(`trace-authorization-${pad(index + 1)}-resolved`), actorId,
      action: `demo.example.request.${status}`, resource: "solicitudes-autorizacion", resourceId: requestId, createdAt: resolvedAt,
    });
  }

  for (let index = 0; index < 3; index += 1) {
    const accountId = id(`disabled-user-${index + 1}`);
    if (state.accounts.some((row) => row.id === accountId)) continue;
    // Random password is immediately discarded; these rows cannot authenticate.
    const credentials = hashPassword(randomBytes(32).toString("base64url"));
    state.accounts.push({
      id: accountId, name: `DEMO V2 · Usuario inactivo ${index + 1}`, email: `demo-v2-inactivo-${index + 1}@example.invalid`,
      role: "collector", collectorId: routes[index].collectorId, ...credentials, credentialVersion: 1,
      status: "disabled", createdAt: at(30), updatedAt: at(30),
    });
  }
}
