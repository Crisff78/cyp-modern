# Estado compartido del proyecto (Claude Code + Codex)

Este archivo es la fuente de verdad del **estado operativo actual** compartido entre
Claude Code, Codex y ZCode. Todos deben leerlo al iniciar, verificar el estado real
del proyecto y actualizarlo antes de terminar. La historia detallada y append-only
vive unicamente en el Superbrain; no seguir aumentando este archivo como cronologia.

La politica global aplicable a este y a todos los proyectos esta en
`C:\Users\Rardiel Ceballo\Documents\VPS-obsidian\VPS\06-Knowledge-Base\Superbrain\System\Knowledge Retention Policy.md`.

---

# Proyecto: CyP Modern (Cobros y Pagos) — Gamera Software

## Objetivo

Backend REST + portal administrativo + PWA de cobrador para operacion de cobros de
servicios, pagos autorizados y cuadre diario. Importes en pesos dominicanos (RD$),
sin impuestos ni amortizacion de prestamos. Proyecto nuevo de Gamera; el jefe esta
haciendo pruebas funcionales sobre el.

**Origen:** repositorio `https://github.com/Crisff78/cyp-modern` clonado el
2026-09-17. El esquema moderno es un diseno nuevo para PostgreSQL, no una extraccion
del respaldo antiguo. No se usa Docker ni SQL Server.

## Contexto de empresa

CyP es un proyecto **separado** de Hermes-BI. El AGENTS.md de
`Documents/ChatGPT/Gamera Software` describe Hermes-BI (modulo BI-IA); sus
decisiones y su alcance no se aplican aqui. No mezclar los dos proyectos.

## Stack tecnico

- Node.js >= 22.12, TypeScript estricto, npm workspaces (3 paquetes).
- `pnpm` es obligatorio para instalar (regla global de Rardiel); nunca npm/yarn.
  `pnpm-workspace.yaml` anade las 3 apps porque pnpm no lee el campo `workspaces`
  de package.json. Si se vuelve a npm, borrar ese archivo.
- Backend: Fastify + PostgreSQL nativo. Sin Docker, sin SQL Server, sin ORM.
- Frontends: Vite + React + Tailwind.
- Puerto API 3001, admin 5173, cobrador PWA 5174.

## Estructura

- `app/server` — API, migraciones (`database/001_initial.sql`,
  `002_accounts_credentials.sql`), seed y tests.
- `app/client-admin` — portal de administracion.
- `app/client-collector` — PWA del cobrador.
- `docs/` — ADR, contratos de API, modelo de datos, logica de negocio, design system.

## Decisiones tomadas (no reabrir sin pedirlo el usuario)

- **Ubicacion 2026-09-17:** el proyecto vive en
  `C:\Users\Rardiel Ceballo\Documents\Codex\2026-09-17\cyp-modern`. Es la fuente de
  verdad; no trabajar en copias dentro del workspace de ZCode.
- **Demo mode:** `DEMO_MODE=true` con FileStore en memoria, sin tocar PostgreSQL.
  Sirve para que el jefe pruebe la interfaz sin instalar base de datos.
- **Modo real:** `DEMO_MODE=false` exige `DATABASE_URL`, `ADMIN_EMAIL`,
  `ADMIN_PASSWORD` de 14+ caracteres y `JWT_SECRET`.
- **Clientes del respaldo (2026-09-17):** Rardiel pidio integrar la base que paso
  su companero (CobrosyPagos-GDemos-2.bak). Es base GDemos (demo): mezcla clientes
  reales con registros de prueba (Jessica Simpson, dfaef, plantilla 123/Cliente/Alias...,
  Cliente 32684). Se importaron los 24 clientes como dataset legacy en
  zona/ruta/cobrador semilla `legacy-import-*`, con dry run previo e IDs estables
  idempotentes. No es verdad de produccion; los registros de prueba se pueden
  borrar desde la pantalla Clientes del admin.

## Current state - ACTUALIZAR ANTES DE CERRAR

**Last updated:** 2026-09-24 por Codex — Cobros incluye cancelación MDI en dos pasos con nota y baja lógica en mock, selector de alcance para imprimir, vista previa térmica imprimible (también desde `Guardar e Imp.`) y selector de alcance para mapa con estilos Hybrid/Roadmap/Satellite/Terrain y marcadores de clientes geolocalizados. La baja lógica simulada guarda la nota y excluye movimientos cancelados de balances mock; el servidor no expone aún una ruta de cancelación de cobros. Se conserva el recibo en memoria sin API de guardado. **Depósitos por Cobradores** usa ahora toolbar legacy y layout MDI de tres paneles con filtros, selección, detalles de denominaciones, alta con desglose, impresión, aceptación y cancelación con motivo. La grilla de denominaciones del modal quedó en solo lectura y vacía hasta pulsar Refrescar; únicamente Fecha, Moneda, Cobrador y Nota son editables. Refrescar carga efectivo disponible en DOP y muestra ceros para monedas sin desglose disponible en el snapshot; los importes se muestran con la moneda seleccionada. La API actual permite crear, aceptar y cancelar depósitos, pero no editar movimientos ni persistir fecha/moneda/nota del formulario o motivo de cancelación; esos campos adicionales de edición/formulario permanecen locales en el frontend. **Descargos** ahora abre una vista MDI compacta con toolbar, filtros, grilla seleccionable y totales; alta e inactivación usan la API existente. No hay endpoint de edición para descargos, por lo que editar y los campos Fecha/Moneda/Servicio/Nota se mantienen locales en la sesión de UI. `npm run check`: TypeScript correcto, 21 tests pass, 1 skip esperado por PostgreSQL no configurado y builds de los tres workspaces correctos; Vite mantiene un aviso de bundle superior a 500 kB.

**Update 2026-09-24 — Pagos MDI:** el módulo usa ahora una vista compacta con toolbar sin Editar, filtros por cliente/cobrador/zona/ruta y fecha, grilla seleccionable con reordenamiento local y totales. El diálogo de alta permite añadir pagos a autorizaciones pendientes, modificar importes sin superar el saldo autorizado y registra cada línea mediante `POST /pagos`; las opciones Fecha/Moneda/Forma/Banco/Número/Nota son solo metadatos locales porque la API no los persiste. La cancelación sigue confirmación y nota; funciona como baja lógica en mock, con reversión del saldo de autorización y exclusión del cuadre, pero el backend no ofrece endpoint de cancelación de pagos y en modo real la acción informa que no se aplicó. `npm run check`: typechecks y builds correctos, 21 pruebas pasan y 1 se omite porque PostgreSQL de integración no está configurado; aviso previo de bundle de Vite >500 kB.

**Update 2026-09-24 — Entregas de Dinero MDI:** el módulo abre ahora una vista compacta con toolbar legacy sin Editar, filtros por cobrador/fecha/estado, grilla seleccionable con orden local y contador. El alta usa `POST /entregas`; el desglose de denominaciones es de solo lectura y se carga al pulsar Refrescar con un importe simulado limitado al margen del tope de pago (solo DOP). Fecha, moneda y nota se conservan como metadatos locales porque la API no los persiste. Guardar e Imp. abre la vista previa térmica de entrega. En el modo demo la inactivación marca el movimiento cancelado y lo excluye del cuadre; en modo real se informa que el backend aún no ofrece una ruta para inactivar entregas. `npm run check`: typechecks y builds de los tres workspaces correctos, 21 pruebas pasan y 1 se omite por PostgreSQL de integración no configurado; Vite mantiene el aviso de bundle >500 kB.

**Update 2026-09-24 — Monitor de Cobradores MDI:** Monitor C usa ahora una hoja compacta con selección visual, límites y métricas financieras, control de moneda, Auto. y contador regresivo que refresca cada 60 segundos por defecto. La acción Monitoreo abre una ventana MDI arrastrable con el espacio reservado para el mapa; seleccionar la fila no abre el diálogo. Monitor Z y Monitor R conservan su vista y mapa previos. `npm run check`: typechecks y builds correctos, 21 pruebas aprobadas y 1 omitida por PostgreSQL de integración no configurado; Vite mantiene el aviso de bundle superior a 500 kB.

### Done so far

- Repositorio clonado y dependencias instaladas con pnpm.
- `pnpm-workspace.yaml` creado (necesario para pnpm; ver Stack).
- **PostgreSQL 17 levantado en modo real** (2026-09-17): rol `cyp` + DB `cyp` (UTF8)
  creados; `pg_hba.conf` puesto en `trust` solo para localhost para crear el rol y
  devuelto a `md5` despues. Migraciones `001_initial.sql` y
  `002_accounts_credentials.sql` aplicadas (17 tablas en `public`).
- `.env` ahora con `DEMO_MODE=false`, `DATABASE_URL`, `ADMIN_EMAIL` y
  `ADMIN_PASSWORD` de 18 caracteres (generados localmente; leerlos del `.env`).
- Servicios arrancados en modo real y verificados: API 3001 responde
  `mode: configured` (`PostgreSQL configured`), admin 5173 y cobrador 5174 ok.
  Login de admin verificado con token; `/api/clientes`, `/api/rutas` y
  `/api/snapshot` responden sobre PostgreSQL.
- **Importacion del respaldo legacy ejecutada** (2026-09-17): parser canonico
  `legacy/database/extract_clients.py` + `clients_extract.json` (24 clientes);
  script `app/server/legacy-import.mjs` con dry run, IDs estables y transaccion
  unica. Resultado: 24 clientes + 24 puntos de cobro en zona/ruta/cobrador
  semilla `legacy-import-*`. La base es GDemos (demo), no verdad de produccion.
- Recorrido del demo del README verificado conceptualmente.
- **Aprovisionamiento de usuarios implementado y verificado** (2026-09-17):
  cuentas reales con correo + contraseña propia (scrypt + sal por cuenta),
  revocacion de sesiones por `credentialVersion`, pantalla Usuarios del portal
  administrativo dada de alta/baja/cambio de clave desde la UI, y login de
  cobrador con cuenta propia verificado en la PWA. Tests del servidor: 15/16
  pass; el skip era por falta de PostgreSQL, que ya no aplica.

- **Verificacion de integracion backend-DB (2026-09-17):** lectura y escritura
  probadas en vivo contra PostgreSQL real. Lectura: `/api/clientes` devuelve los
  24 clientes que hay en la base. Escritura: `POST /api/usuarios` (con
  `Idempotency-Key`) creo una cuenta de prueba, el row aparecio en `public.users`
  verificado por psql directo y la API lo leyo de vuelta; despues se borro la
  prueba y `users` volvio a 0. El store en modo real es `PostgresStore`
  (transacciones con `pg_advisory_xact_lock` y `SET CONSTRAINTS ALL DEFERRED`),
  no FileStore. Conteo real de tablas: 17 (clients, routes, zones, collectors,
  users, charges, payouts, payments, collections, cash_handovers,
  collection_points, daily_settlements, recurring_charges, services,
  delay_reasons, exchange_rates, idempotency). `users` inicia en 0 porque el
  admin de mantenimiento autentica contra `.env`, no contra esa tabla.

- **Limpieza de registros de prueba ejecutada (2026-09-17):** borrado en una
  transaccion unica contra PostgreSQL real, con backup previo en
  `legacy/database/cleanup_backup_20260917_*.json` y guardas que verificaron 0
  cargos/cobros/pagos atados a los borrados. Se eliminaron 24 collection_points
  huerfanos (resto de una pasada vieja del importe con otra convencion de IDs:
  cp-c* y cp-leg-*) y 3 clientes duplicados con sufijo -2 (cl-c00013-2,
  cl-c00016-2, cl-c00032-2) mas sus 3 puntos liberados. Resultado: clientes
  17 -> 14, collection_points 41 -> 14, 0 huerfanos restantes. Verificado luego
  contra la API admin: /api/health mode: configured y /api/clientes devolviendo
  los mismos 14. users sigue en 0 (el usuario de la prueba de integracion se
  borro). Commit ffae2ea + push a origin/main; .gitignore ahora excluye los
  volcados de datos de clientes (.logs/, clients_extract.*, cleanup_backup_*,
  clients_pre_cleanup_*). Quedan pendientes solo los ambiguos del punto 2.

- **Fix runtime admin login (2026-09-18):** corregido `enrichUserRole is not defined`
  en `app/client-admin/src/App.tsx` importando los helpers de rol desde
  `types.ts` como valores runtime. Se reconecto `AccountModal/AccountOperation`,
  se restauro la propagacion de `currentUser`, `onRefresh` y `onAccount` hacia
  `MasterDataView`, y el snapshot mock admin ahora incluye `accounts`.
  Verificacion ejecutada: `npm run check` completo, con typecheck de los 3
  workspaces, 15 tests pass + 1 skip del servidor, y builds de admin/cobrador ok.

- **Verificacion de esquema (2026-09-18):** se confirmo que NO existen tablas
  duplicadas ni esquemas paralelos. public tiene 17 tablas reales en ingles
  (clients, collectors, charges, payouts, collections, payments, cash_handovers,
  daily_settlements, collection_points, routes, zones, users, recurring_charges,
  services, delay_reasons, exchange_rates, idempotency) y 10 VISTAS de
  compatibilidad en espanol (clientes, cobradores, cobros, pagos, cargos,
  cargos_recurrentes, descargos, entregas, depositos, cuadres) definidas en
  `001_initial.sql:223-276` como alias legibles sobre las tablas en ingles.
  `store.ts` y `App.tsx` leen/escriben solo las tablas en ingles. No hay nada
  que limpiar; no borrar las vistas. Conteos reales: clients 14,
  collection_points 14, collectors 1, zones 2, routes 1, users 0 (el admin real
  autentica contra .env, no contra esa tabla);
  charges/collections/payments/payouts/cash_handovers/daily_settlements en 0.
  La base esta limpia y lista para operar.
- **Transcripcion del jefe analizada (2026-09-18):** llego el texto real (audio
  transcrito, fragmentos inaudibles). El pedido central es **observabilidad**:
  ver la peticion (GET query o POST body, con parametros) y la respuesta (casi
  siempre JSON) separadas visualmente, para NO entrar al servidor a leer logs;
  quiere revisar desde la calle o el celular. Caso citado: cobrador llama
  "estoy tardando, no me deja" y el jefe lo ve en el log (ej. DAY_CLOSED).
  **Verificado: CyP NO tiene nada de esto.** `App.tsx:90` crea Fastify con
  `logger: false`; `onSend` (98) solo anade Cache-Control: no-store;
  `preHandler` (142) solo valida JWT; `describe` (188) genera OpenAPI
  (documentacion, NO trazas); el manejador de errores hace console.error sin
  persistir. La unica huella de operacion es `actor_id` y la tabla idempotency.
  **Ambiguedad sin resolver:** el pedido coincide casi dato por dato con el
  visor de trazas de la sesion Hermes-BI; confirmar con Rardiel si es para CyP
  o si callo en la sesion equivocada antes de construir trabajo duplicado.

- **Inventario del original + matriz de paridad (2026-09-19, ZCode):** Rardiel
  activo la meta de incorporar TODAS las funciones del original
  (gdemos.ddns.net/cypdemo) y pedir primero sync con el companero. Sync hecho
  (abbda3a..f0f50f6: modales legacy Cargos/Cobradores, mock.ts, mapAdapter.ts;
  conflicto de AGENTS.md fusionado en b070dd6). `npm run check` completo PASS.
  Inventario en vivo con el navegador (sesion Admin viva): menu completo,
  toolbars/filtros/columnas de los 12 modulos, catalogo de 9 reportes, cuadres
  con Procesar/Cerrar dia, monitores con auto-refresco. Verificacion cruzada
  contra el codigo nuevo: cobertura de modulos 1:1 (incluye Tragamonedas y
  Configuracion General replicada). Brechas reales documentadas y priorizadas
  en `docs/legacy-parity.md`: G1 aceptar/cancelar deposito, G2 importacion
  masiva Cargos/Descargos, G3 Descargos Recurrentes (modulo), G4 estado de
  cuenta del cliente, G5 ventanas auxiliares (Facturas/Que hay de nuevo/
  Ventana de Pagos), G6 persistencia de Configuracion General, G7 reportes de
  Pagos del legacy, G8 contabilidad (decision). El demo se congolo antes de
  capturar formularios de alta campo por campo (pendiente, §7 del doc).

- **G1 implementado: aceptar/cancelar depósito (2026-09-19, ZCode).** Migración
  `003_deposit_lifecycle.sql` (accepted_at/by + cancelled_at/by en
  cash_handovers, excluyentes entre sí); `acceptDeposit`/`cancelDeposit` en
  domain.ts (solo admin, idempotentes, 422 en transición inválida); los
  movimientos cancelados dejan de contar en preview y snapshot; rutas
  `POST /api/depositos/:id/aceptar|cancelar` con Idempotency-Key; store carga y
  persiste el ciclo de vida; admin: columna "Acep." (Pendiente/Aceptado/
  Cancelado), selección de fila y botones Aceptar/Cancelar en la barra (vía
  capa mock, mismo estadio que el resto de las vistas operativas); mock demo
  soporta las acciones; test de integración nuevo (16 pass + 1 skip).
  `npm run check` completo PASS. Pendiente menor G1: desglose de denominaciones
  del Panel de Detalles.

- **G2 implementado: importación masiva de Cargos y Descargos (2026-09-19,
  ZCode).** Rutas `POST /api/cargos/importar` y `POST /api/descargos/importar`
  (Idempotency-Key, máx 1000 filas por llamada). `importCharges`/`importPayouts`
  en domain.ts: cliente por identificación (campo `code`, insensible a
  mayúsculas), importe entero positivo en centavos, verificación de
  cobrador/ruta, fecha opcional (usa fecha de negocio) y reporte por fila
  `{ creados, errores[{fila, mensaje}] }` — las filas válidas se aplican, las
  inválidas se reportan sin abortar. Admin: botones "Subir archivo" (CSV con
  separador ; o , autodetectado y cabecera opcional) + "Importar datos" en las
  vistas Cargos y Descargos, con toasts de resumen y errores por fila; mock
  demo soporta ambas rutas. Test de integración nuevo. `npm run check` PASS
  (17 pass + 1 skip).

- **G3 implementado: Descargos Recurrentes (2026-09-19, ZCode).** Migración
  `004_recurring_payouts.sql` (plantillas con cliente, concepto, importe en
  centavos, frecuencia semanal/mensual/trimestral, próxima fecha y estado
  active/paused/archived). `createRecurringPayout`/`updateRecurringPayout` en
  domain.ts (solo admin; el cobrador debe corresponder a la ruta del cliente);
  snapshot expone `payoutRecurring` solo para administración; store carga y
  persiste con diff. Rutas `POST /api/descargos-recurrentes` y
  `POST /api/descargos-recurrentes/:id` (Idempotency-Key). Admin: página
  "Descargos Recurrentes" en el grupo PAGOS (columnas Nro./Fecha/Frecuencia/
  Identif./Cliente/Concepto/Estado), selección de fila y botón Archivar; mock
  demo con una plantilla de ejemplo. Test de integración nuevo.
  `npm run check` PASS (18 pass + 1 skip). Pendiente menor: formulario de
  alta/edición de plantilla en el admin (operable hoy por API).

- **G4 implementado: Cobros y Pagos del Cliente (2026-09-19, ZCode).**
  `clientStatement` en domain.ts + `GET /api/clientes/:id/estado`: cargos,
  cobros, autorizaciones (descargos) y pagos del cliente con resumen
  (totalCargado/totalCobrado/totalPendiente/totalAutorizado/
  totalPagadoACliente); los cobradores solo acceden a clientes de su ruta
  (403 si no). Admin: selección de cliente en el Listado de Clientes + botón
  "Cobros y Pagos del Cliente" que abre el diálogo con las cuatro tablas y el
  resumen; mock demo soporta el GET; test de integración nuevo.
  `npm run check` PASS (19 pass + 1 skip).

- **G5+G6+G7 implementados: matriz de paridad cerrada salvo decisiones
  (2026-09-19, ZCode).** G5: barra superior con Facturas (últimos cobros con
  recibo), Qué hay de nuevo (novedades) y Ventana de Pagos (autorizaciones
  pendientes + últimos pagos). G6: persistencia real de la Configuración
  General — migración `005_system_config.sql` (jsonb), GET/POST
  `/api/configuracion` solo administración, diálogo controlado que carga al
  abrir y guarda con oK (Cancelar restaura lo guardado), mock demo incluido.
  G7: 7 reportes nuevos de Pagos y Servicios por zona en el lanzador, mismo
  nivel de vista preliminar que los 9 existentes. `npm run check` PASS
  (19 pass + 1 skip). Quedan: G8 contabilidad (decisión de Rardiel), menores
  (desglose de denominaciones, formulario de plantilla recurrente) y captura
  en vivo §7 (formularios de alta y ventanas N/F/Q/P del demo).

- **G9 implementado + captura en vivo bloqueada por infraestructura
  (2026-09-19, ZCode).** El demo original esta caido ("Login failed for user"
  en su BD; reinicio intentado sin exito) — la captura en vivo de formularios
  de alta y ventanas N/F/Q/P sigue pendiente hasta que el demo vuelva. En su
  lugar, validacion estatica contra el layout verificado del .bak: los
  clientes del legacy llevan 9 campos de datos y el modelo nuevo solo tenia
  4 → **G9**: migracion `006_client_contact.sql` (alias, sector, celular,
  email, note en clients), Client type + carga/persistencia en store,
  formulario de cliente en QuickRecordModal con los campos nuevos y ruta
  seleccionable, mock actualizado. `npm run check` PASS (19 pass + 1 skip).

- **Menores implementados: desglose de denominaciones y formulario de
  plantilla recurrente (2026-09-19, ZCode).** Migracion
  `007_deposit_denominations.sql` (jsonb en cash_handovers); acceptDeposit
  valida desglose opcional que debe cuadrar con el importe (422 si no) y lo
  persiste; dialogo "Desglose de denominaciones" (billetes/monedas DOP) al
  aceptar un deposito en el admin. Modal `RecurringPayoutModal` para alta y
  edicion de plantillas en Descargos Rec. (cliente, concepto, monto,
  frecuencia, proxima fecha); mock demo de ambas rutas. Test de integracion
  nuevo. `npm run check` PASS (20 pass + 1 skip). La captura en vivo del demo
  sigue bloqueada: la BD de gdemos.ddns.net esta caida (reinicio probado);
  se requiere ademas login manual de Rardiel cuando vuelva. G8 contabilidad
  sigue esperando decision explicita.

- **Captura en vivo completada y G8 decidida (2026-09-19, ZCode).** Con
  sesion de Rardiel en el demo se capturaron campo por campo "Datos del
  Cliente..." (13 campos, nombre partido en apellidos = diferencia de
  modelado documentada) y "Datos del Cargo..." (cliente/moneda/servicio/
  concepto/importe/nota — ChargeDataModal es superconjunto); las ventanas
  N/F/Q/P del demo estan vacias (dependen de datos) y G5 ya las cubre con
  datos reales; Monitor C confirma Auto./Refrescar/Moneda/paginado. **G8:
  Rardiel decidio FUERA DE ALCANCE** (contabilidad del legacy no se porta;
  excepcion deliberada documentada). Matriz de paridad CERRADA.

- **G10 implementado: detalles de grillas, impresion y respaldo (2026-09-19,
  ZCode).** Ordenamiento por columna (clic en encabezado asc/desc) y selector
  de columnas en todas las grillas legacy; botones Imprimir cableados en
  Cobros, Depositos y Reportes con CSS de impresion; boton "Hacer copia de
  respaldo" en la barra superior que descarga el snapshot JSON con fecha.
  `npm run check` PASS (20 pass + 1 skip). Nota de sync: origin/main no tiene
  commits nuevos del companero todavia (su avance no esta empujado); al
  publicarlo, re-sincronizar y re-auditar la matriz.

- **Captura en vivo segunda pasada completada (2026-09-20, ZCode).** Con
  sesion fresca de Rardiel en el demo se capturaron las ventanas pendientes:
  Notificaciones (grilla Nro./Fecha/Titulo/Registro/Leido/Fecha de Leido),
  Facturas del Soporte Tecnico (Nro./Fecha/Plazo/Trans./Estado/Importe/
  Recibido/Pendiente + Descargar/Refrescar/Ver original), Ventana de Pagos
  ("Pagos al Soporte Tecnico": Nro./Fecha/Importe/Facturas/Registro) y
  Monitor de Cobradores con columnas confirmadas (Cobrador/Lim. de Cob./
  Lim. de Pag./Cobrado/Depositado/Entregado/Pagado/Diferencia, 10 filas,
  cuenta regresiva "Faltan: N seg"). Hallazgo: "Que hay de nuevo" esta ROTO
  en el propio original (error "Invalid column name
  'MostrarQueHayDeNuevo'"). Conclusion: sin brechas nuevas accionables;
  las ventanas F/P son facturacion del vendedor legacy (slot ya cubierto en
  el admin). Documentado en docs/legacy-parity.md §7.

- **Sync del avance del companero completado (2026-09-20, ZCode).** El
  companero publico 2 commits sobre el ultimo push (fast-forward, sin
  conflictos): 88d6f5e limpieza del fondo y renderizado exclusivo en ventanas
  MDI, y ca4b067 telemetria legacy en el topbar del admin (version + fecha/
  hora del servidor en es-DO, conservando herramientas modernas). Verificado
  tras la fusion: los marcadores de G1-G10+G9+menores siguen presentes y
  `npm run check` completo en verde (20 pass + 1 skip); el dev server
  recargo sin problemas. Matriz de paridad: CERRADA.

- **Datos de prueba + E2E en modo real completados (2026-09-20, ZCode).**
  Migraciones 001-008 aplicadas a la BD real. Datos PRUEBA insertados via API
  (cargos, cobros, depositos, entregas, descargos, plantilla recurrente).
  Bateria `e2e-pruebas.mjs` (39 checks) en verde contra PostgreSQL tras
  correcciones: (1) G1 redisenado con eventos append-only en
  `deposit_lifecycle` (migracion 008) — el trigger de inmutabilidad de
  cash_handovers bloqueaba el UPDATE del ciclo de vida (500); (2) login del
  admin ya no precarga credenciales demo cuando /api/health reporta modo real;
  (3) flujo completo verificado INCLUYENDO cierre de dia con cuadre en cero
  (settlement creado). Rechazos del negocio verificados como correctos:
  cobro duplicado 422, deposito sin efectivo 409, pago sin fondos de oficina
  409, cierre descuadrado 409 UNBALANCED. `npm run check` verde
  (20 pass + 1 skip). Decision de Rardiel (2026-09-20): los datos
  PRUEBA SE QUEDAN en la BD real como dataset demo (no borrar).

- **Onboarding para agentes nuevos (2026-09-20, ZCode):** se creo
  `docs/ONBOARDING-AGENTES.md` — traspaso completo del proyecto (que es,
  donde esta todo, mapa del Superbrain, estado, decisiones cerradas,
  pendientes, convenciones) + plantilla de 16 agentes para Hermes/AutoClaw
  con nombres, areas y descripciones. Cualquier modelo/agente nuevo debe
  leer ese documento Y este AGENTS.md antes de tocar codigo.

### Aprovisionamiento (como usarlo)

1. Entrar al admin (modo real: `ADMIN_EMAIL`/`ADMIN_PASSWORD` del `.env`; `Demo-CyP-2026!` solo vale con `DEMO_MODE=true`) > Archivos >
   Usuarios > **Nueva cuenta**.
2. Cobrador: elegir el cobrador asignado (vincula la cuenta a su ruta y sus
   clientes). Administracion: sin cobrador asignado.
3. Contrasena de 12+ caracteres. Entregarla personalmente; el cobrador puede
   cambiarla y eso cierra sus sesiones abiertas.
4. API: `POST /api/usuarios`, `POST /api/usuarios/:id/clave`,
   `POST /api/usuarios/:id/estado`, `GET /api/usuarios` (admin). Las tres
   mutaciones requieren `Idempotency-Key`.
5. Restricciones: correo unico; rol cobrador exige cobrador existente; un admin
   no puede desactivar su propia cuenta; la sesion muere al cambiar clave o
   estado. Las identidades demo (`admin@cyp.local`, `collector@cyp.local`)
   siguen funcionando solo con `DEMO_MODE=true`.

### Pendiente

1. Dar de alta al jefe y a cada cobrador real desde la pantalla Usuarios (con
   `DEMO_MODE=false` las identidades demo ya no sirven; el admin real esta en
   el `.env`).
2. Confirmar con Rardiel si son de prueba o reales los clientes legacy ambiguos
   que quedaron: mendez (cl-leg-rodrigo), los dos PORFIRIO (cl-c00019 Porfirio
   de leon y cl-leg-1721 PORFIRIO), NOEL USA, MAYITO YO y PRESTAMO DE LA 149.
   No borrarlos sin su decision.
3. **Sincronizar con el companero (2026-09-18):** el lleva la parte de diseno por su lado; Rardiel avisara cuando tocar sincronizar. Sincronizacion base aplicada 2026-09-19 (pull abbda3a..f0f50f6: modales legacy Cargos/Cobradores, flujos Z/L/R, mock.ts y mapAdapter.ts). Hasta el proximo aviso, no avanzar UI/diseno desde este clone.
4. Decidir si los clientes legacy se quedan en la ruta semilla
   `legacy-import-route` o se redistribuyen a rutas/zonas reales.

### Next step

- Alta del jefe y los cobradores reales en la pantalla Usuarios del admin
  (http://127.0.0.1:5173). Lo segundo es decidir con Rardiel los clientes legacy
  ambiguos (mendez, PORFIRIO x2, NOEL USA, MAYITO YO, PRESTAMO DE LA 149).

### Blockers / decisiones pendientes

- El shim de `pnpm` falla en shells no interactivas (the global target of the
  pnpm shim points back at the shim); usar `node node_modules/tsx/dist/cli.mjs` y
  `node node_modules/vite/bin/vite.js` directo, como en Notas operativas.
- El sandbox de Codex bloquea abrir el navegador por comando y computer-use no
  tiene token; Rardiel abre 5173/5174 a mano.

## Notas operativas

- Arrancar todo: `cd app/server && pnpm dev` desde la raiz ejecuta los 3 servicios.
  `pnpm dev` puede fallar por el shim en shells no interactivas; alternativa probada:
  Si se usa el tsx/vite directo: server en `app/server` con
  `node node_modules/tsx/dist/cli.mjs watch --env-file-if-exists=../../.env src/index.ts`,
  frontends con `node node_modules/vite/bin/vite.js`.
- Cerrar jornada: la API rechaza un cobro nuevo con `DAY_CLOSED` si la jornada
  ya cerro. Cada cobrador mantiene su jornada independiente.
- El cuadre exige cero: `(Cobrado - Depositado) + (Entregado - Pagado) = 0`.
