// Pruebas E2E contra el servidor real (modo real, PostgreSQL) — tolerante a datos acumulados.
const BASE = "http://127.0.0.1:3001";
const results = [];
const ok = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`);
};
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) { console.error("Faltan ADMIN_EMAIL/ADMIN_PASSWORD"); process.exit(1); }
const key = () => "k-" + crypto.randomUUID();
let token = "";
async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "idempotency-key": key(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santo_Domingo" }).format(new Date());

(async () => {
  const login = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  token = (await login.json()).token ?? "";
  ok("Login admin (modo real)", login.status === 200 && !!token, `status=${login.status}`);

  const clientes = (await req("GET", "/api/clientes")).json;
  ok("GET /api/clientes (14 legacy)", Array.isArray(clientes) && clientes.length >= 14, `total=${clientes?.length}`);
  const cliA = clientes[0], cliB = clientes[1];
  ok("Clientes con codigo", !!cliA?.code && !!cliB?.code, `A=${cliA?.code} B=${cliB?.code}`);

  // G2: importar cargos (todas validas para no ensuciar reporte de errores)
  const imp = await req("POST", "/api/cargos/importar", { filas: [
    { identificacion: cliA.code, servicio: "PRUEBA Internet", importe: 50000, fecha: hoy },
    { identificacion: cliB.code, servicio: "PRUEBA Agua", importe: 30000, fecha: hoy },
  ]});
  ok("G2 importar cargos: 200 y 2 creadas", imp.status === 200 && imp.json?.creados === 2, JSON.stringify(imp.json)?.slice(0,120));
  const impBad = await req("POST", "/api/cargos/importar", { filas: [
    { identificacion: "NO-EXISTE-XYZ", servicio: "X", importe: 100 },
  ]});
  ok("G2 fila invalida reportada sin abortar", impBad.status === 200 && impBad.json?.creados === 0 && impBad.json?.errores?.length === 1, JSON.stringify(impBad.json)?.slice(0,100));

  // G4: estado de cuenta
  const est = await req("GET", `/api/clientes/${cliA.id}/estado`);
  const pruebaDeA = est.json?.cargos?.filter(c => String(c.service).startsWith("PRUEBA")) ?? [];
  ok("G4 estado de cuenta: 200 con cargos PRUEBA", est.status === 200 && pruebaDeA.length >= 2, `cargosPRUEBA=${pruebaDeA.length}`);

  // cobros
  const cargoA = pruebaDeA.find(c => c.amount === 50000);
  const cargoB = (await req("GET", "/api/snapshot")).json?.charges?.find(c => c.service === "PRUEBA Agua");
  ok("Cargos PRUEBA localizados", !!cargoA && !!cargoB);
  const c1 = await req("POST", "/api/cobros", { chargeId: cargoA.id, amount: 20000 });
  ok("Cobro parcial 200.00", c1.status === 200, `status=${c1.status}`);
  const c2 = await req("POST", "/api/cobros", { chargeId: cargoB.id, amount: 30000 });
  ok("Cobro total 300.00", c2.status === 200, `status=${c2.status}`);

  // G1: depositos con delta
  const collectorId = (await req("GET", "/api/snapshot")).json?.routes?.find(r => r.id === cliA.routeId)?.collectorId;
  ok("Cobrador del cliente A", !!collectorId, collectorId);
  const depositedNow = async () => (await req("GET", `/api/cuadres/preview?collectorId=${collectorId}&date=${hoy}`)).json?.deposited;
  const d0 = await depositedNow();
  const dep = await req("POST", "/api/depositos", { collectorId, amount: 40000 });
  ok("Registro de deposito 400.00", dep.status === 200, `status=${dep.status}`);
  const depId = dep.json?.movement?.id;
  ok("Cuadre refleja el deposito", (await depositedNow()) === d0 + 40000, `d0=${d0}`);
  const bad = await req("POST", `/api/depositos/${depId}/aceptar`, { desglose: [{ denominacion: 500, cantidad: 10 }] });
  ok("G1 aceptar con desglose que NO cuadra => 422", bad.status === 422, `status=${bad.status}`);
  const good = await req("POST", `/api/depositos/${depId}/aceptar`, { desglose: [{ denominacion: 500, cantidad: 60 }, { denominacion: 100, cantidad: 100 }] });
  ok("G1 aceptar con desglose exacto => 200", good.status === 200, `status=${good.status} ${JSON.stringify(good.json)?.slice(0,120)}`);
  ok("G1 aceptado persiste en cuadre", (await depositedNow()) === d0 + 40000);
  const cancelAccepted = await req("POST", `/api/depositos/${depId}/cancelar`, {});
  ok("G1 cancelar deposito ya aceptado => 422", cancelAccepted.status === 422, `status=${cancelAccepted.status}`);
  const dep2 = await req("POST", "/api/depositos", { collectorId, amount: 15000 });
  const dep2Id = dep2.json?.movement?.id;
  ok("Registro de segundo deposito 150.00", dep2.status === 200, `status=${dep2.status}`);
  const canc = await req("POST", `/api/depositos/${dep2Id}/cancelar`, {});
  ok("G1 cancelar deposito pendiente => 200", canc.status === 200, `status=${canc.status}`);
  ok("G1 deposito cancelado no cuenta en cuadre", (await depositedNow()) === d0 + 40000, `deposited=${await depositedNow()}`);

  // descargos + entrega + pago
  const impP = await req("POST", "/api/descargos/importar", { filas: [
    { identificacion: cliB.code, concepto: "PRUEBA Reembolso", importe: 10000 },
  ]});
  ok("G2 importar descargos: 1 creada", impP.status === 200 && impP.json?.creados === 1, JSON.stringify(impP.json)?.slice(0,100));
  const payouts = (await req("GET", "/api/descargos")).json;
  const payout = payouts?.find?.(p => p.concept === "PRUEBA Reembolso" && p.amount === 10000);
  ok("Descargo localizado", !!payout);
  // entrega de efectivo al cobrador para poder pagar
  const ent = await req("POST", "/api/entregas", { collectorId, amount: 10000 });
  ok("Registro de entrega 100.00", ent.status === 200, `status=${ent.status}`);
  const pago = await req("POST", "/api/pagos", { payoutId: payout.id, amount: 4000 });
  ok("Pago parcial 40.00 sobre descargo", pago.status === 200, `status=${pago.status} ${JSON.stringify(pago.json)?.slice(0,100)}`);

  // G3 recurrentes
  const rec = await req("POST", "/api/descargos-recurrentes", {
    clientId: cliB.id, concept: "PRUEBA Reembolso mensual", amount: 150000,
    frequency: "monthly", nextRunDate: hoy,
  });
  ok("G3 crear plantilla => 200", rec.status === 200, `status=${rec.status}`);
  const recId = rec.json?.id;
  const recUpd = await req("POST", `/api/descargos-recurrentes/${recId}`, { amount: 200000, status: "paused" });
  ok("G3 modificar plantilla => 200", recUpd.status === 200 && recUpd.json?.status === "paused", `status=${recUpd.status}`);
  const recArch = await req("POST", `/api/descargos-recurrentes/${recId}`, { status: "archived" });
  ok("G3 archivar plantilla => 200", recArch.status === 200 && recArch.json?.status === "archived", `status=${recArch.status}`);

  // G6 configuracion
  const cfgGet0 = await req("GET", "/api/configuracion");
  ok("G6 GET configuracion => 200", cfgGet0.status === 200);
  const cfgSet = await req("POST", "/api/configuracion", { config: { "general.empresa": "PRUEBA CyP", "cobros.guardarGps": true } });
  ok("G6 POST configuracion => 200", cfgSet.status === 200, `status=${cfgSet.status}`);
  const cfgGet1 = await req("GET", "/api/configuracion");
  ok("G6 configuracion persiste", cfgGet1.json?.config?.["general.empresa"] === "PRUEBA CyP");
  await req("POST", "/api/configuracion", { config: {} });

  // cierre de dia: pagar pendiente de descargos, depositar efectivo de cobros y cerrar
  const payoutsHoy = ((await req("GET", "/api/descargos")).json ?? []).filter(
    (p) => p.collectorId === collectorId && p.status !== "cancelled" && p.amount > p.paid,
  );
  for (const p of payoutsHoy) {
    const pend = p.amount - p.paid;
    const pagoBal = await req("POST", "/api/pagos", { payoutId: p.id, amount: pend });
    ok(`Pago de balance sobre descargo (${pend / 100}.00)`, pagoBal.status === 200, `status=${pagoBal.status}`);
  }
  const bal = await req("GET", `/api/cuadres/preview?collectorId=${collectorId}&date=${hoy}`).then((r) => r.json);
  const porDepositar = bal?.collected - bal?.deposited;
  if (porDepositar > 0) {
    const balDep = await req("POST", "/api/depositos", { collectorId, amount: porDepositar });
    ok("Deposito de balance", balDep.status === 200, `status=${balDep.status}`);
  }
  const diff = (await req("GET", `/api/cuadres/preview?collectorId=${collectorId}&date=${hoy}`)).json;
  ok("Diferencia en cero tras balanceo", diff?.difference === 0, `difference=${diff?.difference}`);
  const closeDay = await req("POST", "/api/cuadres", { collectorId, date: hoy });
  ok("Cierre de dia => 200", closeDay.status === 200, `status=${closeDay.status} ${JSON.stringify(closeDay.json)?.slice(0,100)}`);
  const diaCerrado = (await req("GET", "/api/snapshot")).json?.settlements?.find?.(s => s.collectorId === collectorId && s.date === hoy);
  ok("Jornada cerrada en settlements", !!diaCerrado);

  // negativos
  ok("Snapshot sin token => 401", (await fetch(BASE + "/api/snapshot")).status === 401);
  const cobroAjeno = await req("POST", "/api/cobros", { chargeId: "chg-inexistente", amount: 100 });
  ok("Cobro sobre cargo inexistente rechazado", cobroAjeno.status >= 400 && cobroAjeno.status < 500, `status=${cobroAjeno.status}`);

  const fails = results.filter(r => !r.pass);
  console.log(`\n===== RESUMEN: ${results.length - fails.length}/${results.length} PASS, ${fails.length} FAIL =====`);
  if (fails.length) fails.forEach(f => console.log("FALLÓ: " + f.name + " | " + f.detail));
})().catch(e => { console.error("ERROR FATAL DEL SCRIPT:", e.message); process.exit(1); });
