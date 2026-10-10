import type pg from "pg";
import type { State } from "./domain.js";
import { getAdminTools, type AdminToolsState } from "./admin-tools.js";
import type { StationInstallation, StationInstallationChallenge } from "./station-installation-protocol.js";

const clean = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row)
  .filter(([, value]) => value !== null).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]));
export async function readAdminTools(client: pg.PoolClient): Promise<AdminToolsState> {
  const rows = async (sql: string) => (await client.query(sql)).rows.map(clean);
  const scope = (await client.query('SELECT scope_id AS "scopeId" FROM station_installation_scope WHERE id=$1', ["main"])).rows[0];
  return {
    ...(scope ? { installationScopeId: String(scope.scopeId) } : {}),
    installations: await rows(`SELECT scope_id AS "scopeId",station_id AS "stationId",installation_id AS "installationId",
      public_key_spki AS "publicKeySpki",algorithm,status,revision,registered_at AS "registeredAt",registered_by AS "registeredBy",
      revoked_at AS "revokedAt",revoked_by AS "revokedBy",revocation_reason AS "revocationReason"
      FROM station_installations ORDER BY scope_id,station_id,installation_id`),
    installationChallenges: await rows(`SELECT version,purpose,challenge_id AS "challengeId",nonce,scope_id AS "scopeId",
      station_id AS "stationId",installation_id AS "installationId",actor_id AS "actorId",session_id AS "sessionId",origin,
      expires_at AS "expiresAt",created_at AS "createdAt",public_key_spki AS "publicKeySpki"
      FROM station_installation_challenges ORDER BY created_at,challenge_id`),
    pcpGroups: await rows('SELECT id,name FROM pcp_groups ORDER BY name,id'),
    stations: await rows(`SELECT id,number,name,device_id AS "deviceId",description,station_group AS "group",station_type AS type,
      license,version,active,rraa_client_id AS "rraaClientId",rraa_station_code AS "rraaStationCode",
      rraa_device_id AS "rraaDeviceId",rraa_validated_at AS "rraaValidatedAt",rraa_validated_by AS "rraaValidatedBy"
      FROM pcp_stations ORDER BY number,id`),
    pcps: await rows('SELECT id,number,name,group_id AS "groupId",address,phone,active FROM pcps ORDER BY number,id'),
    pcpStations: await rows('SELECT pcp_id AS "pcpId",station_id AS "stationId" FROM pcp_station_links ORDER BY pcp_id,station_id'),
    sessions: await rows(`SELECT id,user_id AS "userId",user_name AS "userName",role,collector_id AS "collectorId",
      started_at AS "startedAt",expires_at AS "expiresAt",revoked_at AS "revokedAt",revoked_by AS "revokedBy" FROM auth_sessions ORDER BY started_at,id`),
    authorizationRequests: await rows(`SELECT id,client_id AS "clientId",collector_id AS "collectorId",delay_reason_id AS "delayReasonId",
      for_collection AS "forCollection",note,status,created_at AS "createdAt",created_by AS "createdBy",resolved_at AS "resolvedAt",
      resolved_by AS "resolvedBy",resolution_note AS "resolutionNote" FROM authorization_requests ORDER BY created_at,id`),
    traces: await rows('SELECT id,actor_id AS "actorId",action,resource,resource_id AS "resourceId",created_at AS "createdAt" FROM admin_traces ORDER BY created_at,id'),
  } as AdminToolsState;
}
export async function saveAdminTools(client: pg.PoolClient, state: State, before: State) {
  const data = getAdminTools(state), old = getAdminTools(before);
  if (old.installationScopeId && data.installationScopeId !== old.installationScopeId)
    throw new Error("The station installation namespace cannot be changed or removed.");
  if (!data.installationScopeId && (data.installations.length || data.installationChallenges.length))
    throw new Error("Station installations require a persisted namespace.");
  if (data.installationScopeId && data.installationScopeId !== old.installationScopeId) {
    await client.query('INSERT INTO station_installation_scope(id,scope_id) VALUES($1,$2)', ["main",data.installationScopeId]);
  }
  const changed = <T extends { id: string }>(rows: T[], row: T) => JSON.stringify(rows.find((item) => item.id === row.id)) !== JSON.stringify(row);
  for (const row of data.pcpGroups) {
    if (!changed(old.pcpGroups, row)) continue;
    await client.query('INSERT INTO pcp_groups(id,name) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name', [row.id,row.name]);
  }
  for (const row of data.stations) {
    if (!changed(old.stations, row)) continue;
    await client.query(`INSERT INTO pcp_stations(id,number,name,device_id,description,station_group,station_type,license,version,active,
      rraa_client_id,rraa_station_code,rraa_device_id,rraa_validated_at,rraa_validated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(id) DO UPDATE SET number=EXCLUDED.number,name=EXCLUDED.name,
      device_id=EXCLUDED.device_id,description=EXCLUDED.description,station_group=EXCLUDED.station_group,
      station_type=EXCLUDED.station_type,license=EXCLUDED.license,version=EXCLUDED.version,active=EXCLUDED.active,
      rraa_client_id=EXCLUDED.rraa_client_id,rraa_station_code=EXCLUDED.rraa_station_code,rraa_device_id=EXCLUDED.rraa_device_id,
      rraa_validated_at=EXCLUDED.rraa_validated_at,rraa_validated_by=EXCLUDED.rraa_validated_by`,
      [row.id,row.number,row.name,row.deviceId,row.description,row.group,row.type,row.license,row.version,row.active,
        row.rraaClientId ?? null,row.rraaStationCode ?? null,row.rraaDeviceId ?? null,row.rraaValidatedAt ?? null,row.rraaValidatedBy ?? null]);
  }
  for (const row of data.pcps) {
    if (!changed(old.pcps, row)) continue;
    await client.query(`INSERT INTO pcps(id,number,name,group_id,address,phone,active) VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(id) DO UPDATE SET number=EXCLUDED.number,name=EXCLUDED.name,group_id=EXCLUDED.group_id,
      address=EXCLUDED.address,phone=EXCLUDED.phone,active=EXCLUDED.active`, [row.id,row.number,row.name,row.groupId,row.address,row.phone,row.active]);
  }
  for (const link of old.pcpStations) if (!data.pcpStations.some((row) => row.pcpId === link.pcpId && row.stationId === link.stationId))
    await client.query('DELETE FROM pcp_station_links WHERE pcp_id=$1 AND station_id=$2', [link.pcpId,link.stationId]);
  for (const link of data.pcpStations) if (!old.pcpStations.some((row) => row.pcpId === link.pcpId && row.stationId === link.stationId))
    await client.query('INSERT INTO pcp_station_links(pcp_id,station_id) VALUES($1,$2)', [link.pcpId,link.stationId]);
  for (const row of old.pcpGroups) if (!data.pcpGroups.some((group) => group.id === row.id))
    await client.query('DELETE FROM pcp_groups WHERE id=$1', [row.id]);
  for (const row of data.sessions) {
    if (!changed(old.sessions, row)) continue;
    await client.query(`INSERT INTO auth_sessions(id,user_id,user_name,role,collector_id,started_at,expires_at,revoked_at,revoked_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET user_name=EXCLUDED.user_name,revoked_at=EXCLUDED.revoked_at,revoked_by=EXCLUDED.revoked_by`,
      [row.id,row.userId,row.userName,row.role,row.collectorId ?? null,row.startedAt,row.expiresAt,row.revokedAt ?? null,row.revokedBy ?? null]);
  }
  const installationKey = (row: StationInstallation) => JSON.stringify([row.scopeId,row.stationId,row.installationId]);
  const installed = new Map(old.installations.map((row) => [installationKey(row),row]));
  const nextInstalled = new Set(data.installations.map(installationKey));
  for (const key of installed.keys()) if (!nextInstalled.has(key))
    throw new Error("Station installation registrations cannot be deleted.");
  for (const row of data.installations) {
    const previous = installed.get(installationKey(row));
    if (previous && JSON.stringify(previous) === JSON.stringify(row)) continue;
    if (previous) {
      const immutable = (value: StationInstallation) => JSON.stringify([value.scopeId,value.stationId,value.installationId,
        value.publicKeySpki,value.algorithm,value.registeredAt,value.registeredBy]);
      if (immutable(previous) !== immutable(row) || previous.status !== "active" || row.status !== "revoked" || previous.revision === row.revision)
        throw new Error("Station installation keys and registration history are immutable.");
      await client.query(`UPDATE station_installations SET status=$4,revision=$5,revoked_at=$6,revoked_by=$7,revocation_reason=$8
        WHERE scope_id=$1 AND station_id=$2 AND installation_id=$3`,
        [row.scopeId,row.stationId,row.installationId,row.status,row.revision,row.revokedAt ?? null,row.revokedBy ?? null,row.revocationReason ?? null]);
    } else {
      await client.query(`INSERT INTO station_installations(namespace_id,scope_id,station_id,installation_id,public_key_spki,
        algorithm,status,revision,registered_at,registered_by,revoked_at,revoked_by,revocation_reason)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [data.installationScopeId,row.scopeId,row.stationId,row.installationId,row.publicKeySpki,row.algorithm,row.status,row.revision,
          row.registeredAt,row.registeredBy,row.revokedAt ?? null,row.revokedBy ?? null,row.revocationReason ?? null]);
    }
  }
  const challenges = new Map(old.installationChallenges.map((row) => [row.challengeId,row]));
  const nextChallenges = new Set(data.installationChallenges.map((row) => row.challengeId));
  // The existing Store transaction and advisory lock make consumption/pruning
  // atomic with registration, revocation, idempotency and audit persistence.
  for (const id of challenges.keys()) if (!nextChallenges.has(id))
    await client.query('DELETE FROM station_installation_challenges WHERE challenge_id=$1', [id]);
  for (const row of data.installationChallenges) {
    const previous: StationInstallationChallenge | undefined = challenges.get(row.challengeId);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(row)) throw new Error("Station installation challenges cannot be changed.");
      continue;
    }
    await client.query(`INSERT INTO station_installation_challenges(namespace_id,scope_id,station_id,installation_id,
      challenge_id,version,purpose,nonce,actor_id,session_id,origin,created_at,expires_at,public_key_spki)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [data.installationScopeId,row.scopeId,row.stationId,row.installationId,row.challengeId,row.version,row.purpose,row.nonce,
        row.actorId,row.sessionId,row.origin,row.createdAt,row.expiresAt,row.publicKeySpki ?? null]);
  }
  for (const row of data.authorizationRequests) {
    if (!changed(old.authorizationRequests, row)) continue;
    await client.query(`INSERT INTO authorization_requests(id,client_id,collector_id,delay_reason_id,for_collection,note,status,
      created_at,created_by,resolved_at,resolved_by,resolution_note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,resolved_at=EXCLUDED.resolved_at,resolved_by=EXCLUDED.resolved_by,
      resolution_note=EXCLUDED.resolution_note`,
      [row.id,row.clientId,row.collectorId,row.delayReasonId ?? null,row.forCollection,row.note,row.status,row.createdAt,row.createdBy,
        row.resolvedAt ?? null,row.resolvedBy ?? null,row.resolutionNote ?? null]);
  }
  for (const row of data.traces) {
    if (old.traces.some((trace) => trace.id === row.id)) continue;
    await client.query('INSERT INTO admin_traces(id,actor_id,action,resource,resource_id,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [row.id,row.actorId,row.action,row.resource,row.resourceId ?? null,row.createdAt]);
  }
}
