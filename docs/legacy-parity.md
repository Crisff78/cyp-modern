# Paridad con el original (cyp10_front) — inventario y brechas

**Fecha:** 2026-09-19 · **Fuente:** navegación en vivo del original
(`http://gdemos.ddns.net/cypdemo/cyp10_front.dll?CID=cypdemo`, sesión Admin),
inventario del respaldo `legacy/database/table_summary.json` (44 tablas, 136
procedimientos) y codigo actual de `app/client-admin`.

Objetivo: que la version modernizada tenga **todas** las funciones y elementos
del original. Este documento es la lista maestra de verificacion.

## 1. Mapa completo del menu original

- **Archivos:** Admin. (Panel de Control), Clientes
- **Cobros:** Cargos, Cargos Rec., Cobros, Depósitos
- **Pagos:** Descargos, Descargos Rec., Pagos, Entregas
- **Reportes:** Monitor C, Cuadres, Reportes, Monitor Z
- **Cerrar:** Cambiar clave, Hacer copia de respaldo, Ayuda del sistema,
  Soporte Técnico
- **Barra superior:** M (menu), N (Notificaciones), F (Facturas),
  Q (Que hay de nuevo), P (Ventana de Pagos), A (ventana auxiliar oculta en demo)

## 2. Panel de Control (Admin.)

Configuración General, Tasas de cambio, Usuarios, Zonas, Cobradores, Estaciones,
PCPs, Grupos (de PCPs), Servicios y Prods., Sesiones, Rutas, Trazas,
secciones "Codificadores" y "Herramientas" (Solicitudes de Autoriz., Motivos
Atraso). **Cobertura nueva:** 1:1 en `pageTitles` (incluye Monitor de Rutas,
que el demo no muestra en menu). La Configuración General nueva replica las
pestañas del original (General, Clientes, Cargos y Descargos, Cobros y Pagos,
Interfaz, GPS) **pero con `defaultValue`: falta persistirla** (gap G7).

## 3. Inventario por modulo (toolbar / filtros / columnas del original)

| Modulo | Toolbar | Filtros | Columnas |
|---|---|---|---|
| Clientes | filtros, navegacion, agregar, modificar, inactivar/activar y/o borrar, refrescar, **Cobros y Pagos del Cliente**, **Ubicación Geográfica**, **Tragamonedas** | Todos, Identificación, Nombre, Estado, Zona, Ruta + Cantidad | (demo sin filas) |
| Cargos | filtros, navegacion, **Agregar cobro**, **Modificar cobro**, guardar, cancelar cambios, **Cancelar cobro**, refrescar, **Subir archivo**, **Importar datos**, **Buscar cliente** | Todos, Cliente, Fechas, Estado, Zona, Ruta, **Relación de Pago** | Nro., Fecha, Cód., Identif., Cliente, Abrev, Servicio, Importe, Recibido, Pendiente, Act. |
| Cargos Rec. | idem + **Borrar registro**, Buscar cliente | Todos, Cliente, Fechas, Estado | Nro., Fecha, **Frecuencia**, Identif., Cliente, Servicio, Importe, Activo, Fecha de Registro |
| Cobros | idem + **Cancelar cobro**, **Imprimir**, **Mapa de Cobros**, Buscar cliente | Todos, Cliente, Fechas, Estado, Cobrador, Zona, Ruta | Nro., Identif., Cliente, Fecha, Linea, Central, Importe, Activo, Registro, Modificacion, Cancelacion |
| Depósitos | idem + **Aceptar depósito**, **Cancelar depósito**, **Imprimir datos** + **Panel de Detalles** (desglose) | Todos, Cobrador, Fechas, Estado | Nro., Fecha, Cobrador, Moneda, Importe, Cheq., Imp. Cheques, Activo, **Acep.** |
| Descargos | idem Cargos (agregar/modificar/guardar/cancelar/borrar) + **Subir archivo/Importar datos** | Todos, Cliente, Fechas, Estado, Zona, Ruta | Nro., Identificacion, Cliente, Fecha, Moneda, Servicio, Importe, Activo |
| Descargos Rec. | idem Cargos Rec. | Todos, Cliente, Fechas, Estado | idem Cargos Rec. |
| Pagos | idem + Buscar cliente | Todos, Cliente, **Cobrador**, Fechas, Estado, Zona, Ruta | Nro., Identif., Cliente, Fecha, **EnLinea, EnCentral**, Importe, Nota, Act., Registro, Modificacion, Cancelacion |
| Entregas | idem + borrar | Todos, Cobrador, Fechas, Estado | Nro., Fecha, Cobrador, Moneda, Importe, Cheques, Imp. Cheques, Activo, Acep. |
| Monitor C / Z | **Auto.** (refresco periodico), Refrescar, Moneda, paginado | — | RDM (Cobrado/Depositado/Entregado/Pagado; demo sin filas) |
| Cuadres | filtros, navegacion, **Procesar Día**, **Editar Procesamiento**, guardar, **Cerrar día**, refrescar, **Imprimir cuadre** | Fecha Inicial/Final, Moneda | Fecha, Total, Efectivo, Cheque, Balance_Cheque |
| Reportes | lanzador agrupado | — | Ver §4 |

Grillas: paginacion (primera/anterior/siguiente/ultima/actualizar, "de N"),
menu de columna (ordenar asc/desc, elegir columnas visibles).

## 4. Catalogo de reportes

Visible en el demo: **-- Cargos --** pendientes de clientes (detallado),
pendientes de clientes por rutas/zonas (resumidos), pendientes por rutas,
pendientes por zonas, y por zona por servicio; **-- Cobros --** resumido,
general, por servicio (resumido). El nuevo admin replica estos 9 exactamente
(`ReportPageId`). El respaldo legacy define ademas 7 reportes de **Pagos** y
ServiciosXZona (`stpReporte_Pagos*`, `stpReporte_ServiciosXZona`) que el demo
no muestra — extension opcional (G8).

## 5. Funciones del respaldo legacy (136 procs) cubiertas o no

Cubiertas por diseno nuevo: cuadre `(Cobrado-Depositado)+(Entregado-Pagado)=0`,
cierre de jornada por cobrador (`closeDay` + DAY_CLOSED), aceptar entrega,
cancelaciones de cobro/cargo/pago, solicitudes de autorizacion, sesiones,
trazas, usuarios/roles, limites de cobrador, motivos de atraso, frecuencias
(recurrentes), GPS de cliente, recibos/imprenta.

## 6. Matriz de brechas (priorizada)

| # | Brecha | Evidencia | Prioridad |
|---|---|---|---|
| G1 | ~~Aceptar / Cancelar depósito~~ **IMPLEMENTADO 2026-09-19** (flujo pendiente→aceptado/cancelado; falta solo el desglose de denominaciones del Panel de Detalles) | `003_deposit_lifecycle.sql`, `acceptDeposit`/`cancelDeposit` en domain.ts, rutas `/api/depositos/:id/aceptar|cancelar`, botones+y columna Acep. en el admin, test de integración | ALTA |
| G2 | ~~Importar datos / Subir archivo~~ **IMPLEMENTADO 2026-09-19** (CSV con separador autodetectado, cabecera opcional, reporte por fila) | rutas `/api/cargos/importar` y `/api/descargos/importar`, `importCharges`/`importPayouts` en domain.ts, botones Subir archivo/Importar datos en el admin, mock demo, test de integración | ALTA |
| G3 | ~~Descargos Recurrentes~~ **IMPLEMENTADO 2026-09-19** (tabla `recurring_payouts`, rutas crear/modificar/archivar, página admin con frecuencia y estado, alcance admin-only, mock demo). Pendiente menor: formulario de alta/edición de plantilla en el admin (hoy vía API) | `004_recurring_payouts.sql`, `createRecurringPayout`/`updateRecurringPayout`, spec en App.tsx, test de integración | ALTA |
| G4 | ~~Cobros y Pagos del Cliente~~ **IMPLEMENTADO 2026-09-19** (GET `/api/clientes/:id/estado` con cargos/cobros/autorizaciones/pagos + resumen; botón en Clientes con diálogo estado de cuenta; alcance por ruta para cobradores) | `clientStatement` en domain.ts, diálogo en MasterDataView, mock demo, test de integración | MEDIA |
| G5 | ~~Ventanas auxiliares~~ **IMPLEMENTADO 2026-09-19** (barra superior: Facturas = últimos cobros con recibo; Qué hay de nuevo = novedades de la modernización; Ventana de Pagos = autorizaciones pendientes + últimos pagos) | App.tsx, diálogos legacy sobre snapshot | MEDIA |
| G6 | ~~Configuración General persistente~~ **IMPLEMENTADO 2026-09-19** (tabla `system_config` jsonb, GET/POST `/api/configuracion` admin-only, diálogo controlado con carga y guardado, mock demo) | `005_system_config.sql`, `saveSystemConfigData`, LegacyCodifierView controlado | MEDIA |
| G7 | ~~Reportes legacy de Pagos + ServiciosXZona~~ **IMPLEMENTADO 2026-09-19** (7 definiciones nuevas en el lanzador: Pagos detallado, pendientes clientes/rutas/zonas, x servicio detallado/resumido, Servicios por zona — al mismo nivel de vista preliminar que los 9 existentes) | reportDefinitions + ReportPageId | BAJA |
| G8 | Contabilidad legacy (EntidadesContables/MovimientosContables) | sin equivalente nuevo | **DECIDIDA 2026-09-19 (Rardiel): FUERA DE ALCANCE** — excepción deliberada; el cuadre diario por cobrador cubre el control operativo |
| G9 | ~~Campos de contacto del cliente~~ **IMPLEMENTADO 2026-09-19** (legacy: alias, sector, telefono, celular, direccion, nota, email — validado contra layout A del .bak; el modelo nuevo solo tenia name/code/phone/address) | `006_client_contact.sql`, Client type, store carga/persistencia, formulario de cliente en QuickRecordModal, mock | MEDIA |

Decisiones cerradas que explican diferencias intencionales (no son brechas):
moneda unica DOP (selectores de Moneda del original quedan como pantalla),
cobros sin detalle de lineas (collections→charges), clientes no importados
directo del .bak, credenciales hasheadas.

## 6b. Menores del deposito y plantillas — IMPLEMENTADOS 2026-09-19

- **Desglose de denominaciones (Panel de Detalles):** al aceptar un deposito
  el admin pide el desglose por billetes/monedas DOP (2000..1); el servidor
  valida que el desglose cuadre exactamente con el importe (422 si no) y lo
  guarda en `cash_handovers.denominations` (jsonb, migracion 007). Aceptar sin
  desglose sigue permitido (compatibilidad).
- **Formulario de plantilla de Descargo Recurrente:** modal nuevo
  (`RecurringPayoutModal`) en la pantalla Descargos Rec. para alta y edicion
  (cliente, concepto, monto, frecuencia, proxima fecha); mock demo incluido.
  El boton Archivar ya existia.

## 6c. Detalles de grillas, impresion y respaldo — IMPLEMENTADOS 2026-09-19 (G10)

- **Ordenar por columna:** clic en cualquier encabezado alterna ascendente/
  descendente con indicador (equivalente del menu Ordenar del original).
- **Selector de columnas:** boton "Columnas" sobre cada grilla para
  mostrar/ocultar columnas (equivalente del menu Columnas del original).
- **Imprimir cableado:** botones Imprimir en Cobros, Depositos y Reportes
  ejecutan la impresion del panel de resultados (CSS de impresion oculta
  filtros, barras y paneles laterales).
- **Hacer copia de respaldo:** boton en la barra superior que descarga el
  snapshot completo del sistema como JSON con fecha (equivalente moderno del
  respaldo del menu Cerrar).

## 6d. Pruebas E2E con datos en modo real — 2026-09-20 (G11)

- Migraciones 001-008 aplicadas a la BD real; datos de prueba insertados via
  API (cargos, cobros, depositos, entregas, descargos, plantilla recurrente).
- Bateria `e2e-pruebas.mjs` (39 checks): login real, G1 aceptar con desglose
  exacto/cancelar/transiciones 422, G2 importacion con reporte por fila,
  G3 recurrentes CRUD+archivo, G4 estado de cuenta, G6 configuracion
  persistente, cobros/entregas/pagos, cierre de dia con cuadre en cero
  (settlement creado) y negativos de autenticacion.
- Correcciones aplicadas durante las pruebas:
  1. G1 persistia el ciclo de vida via UPDATE sobre cash_handovers, violando
     el trigger `Cash handovers are immutable` (001_initial.sql:207) =>
     500 en modo PostgreSQL (en FileStore pasaba). REDISENO: eventos
     append-only en `deposit_lifecycle` (migracion 008), accept/cancel crean
     eventos, loadState los mezcla en los movimientos, saveState solo anade
     filas nuevas. `cash_handovers` vuelve a ser INSERT-only puro.
  2. Hallazgo operativa: `npm run dev` puede caer en fallback demo silencioso
     (MemoryStore) si PostgreSQL no conecta al arrancar — el login real da 401
     y los datos van a memoria. Mitigado: el login ya no precarga credenciales
     demo cuando /api/health reporta modo != demo.
  3. Dato faltante: el cobrador legacy-import necesitaba entrega de efectivo
     en oficina antes de poder pagar descargos (409 correcto del negocio) y
     el cierre exige diferencia exacta en cero (409 UNBALANCED correcto).
- Rechazos observados y CORRECTOS del negocio: cobro sobre cargo ya pagado
  (422), deposito que excede efectivo en mano (409), pago sin fondos de
  oficina (409), cierre con diferencia (409 UNBALANCED).

## 7. Pendientes de verificacion en vivo

**CAPTURA EN VIVO COMPLETADA 2026-09-19 21:26-21:31 (Rardiel logged in).**
Tras caerse la BD del demo y reiniciarse, Rardiel inicio sesion y se capturo:

- **"Datos del Cliente..." (alta/edicion de cliente):** Cliente (nombre),
  1er apellido, 2do apellido, Conocido por (alias), Direccion, Telefono,
  Celular, Identificacion, EMail, Nota, Ubicacion, Zona, Codigo + oK/Cancelar
  y boton "G" (GPS). El admin nuevo cubre todos los datos con G9
  (alias=Conocido por, sector=Zona, celular, email, nota); DIFERENCIA DE
  MODELADO: el original parte el nombre en Cliente + 1er/2do apellido y el
  moderno usa un campo unico de nombre completo (equivalente en datos);
  "Ubicacion" del cliente se cubre con la vista Ubicacion Geografica (GPS).
- **"Datos del Cargo..." (Agregar cobro de Cargos):** Cliente, Moneda,
  Servicio, Concepto, Importe, Nota + oK/Cancelar. `ChargeDataModal` del admin
  es superconjunto (cliente/moneda/servicio/concepto/monto base x tasa/nota).
- **Ventanas N/F/Q/P (Notificaciones, Facturas, Que hay de nuevo, Ventana de
  Pagos):** clics reales por coordenadas no abren contenido en el demo — son
  ventanas dependientes de datos (vacias en este estado). G5 las cubre con
  datos reales del sistema moderno (facturas=ultimos cobros con recibo,
  novedades, pagos pendientes/ultimos pagos).
- **Monitor C:** grilla vacia en el demo incluso tras Refrescar; su estructura
  (Auto./Refrescar/Moneda/paginado) ya esta replicada, y el monitor nuevo
  anade columnas RDM completas.

CONCLUSION: verificacion campo por campo completada; sin brechas nuevas
pendientes (la unica diferencia estructural es el nombre partido en
apellidos, documentada arriba como decision de modelado).

**SEGUNDA PASADA DE CAPTURA 2026-09-20 (con sesion fresca de Rardiel):**
- **Notificaciones (N):** grilla paginada Nro./Fecha/Titulo/Registro/Leido/
  Fecha de Leido, 0 filas en el demo. El admin nuevo ya tiene notificaciones
  (campana con contador).
- **Facturas del Soporte Tecnico (F):** "Facturas del Soporte Tecnico" con
  Nro./Fecha/Plazo/Trans./Estado/Importe/Recibido/Pendiente + Descargar/
  Refrescar/Ver original + filtro Estado, 0 filas. Es facturacion del VENDEDOR
  del software hacia Gamera; en el sistema moderno interno no aplica como
  modulo, y el slot de Facturas ya esta cubierto en el admin.
- **Que hay de nuevo (Q):** ROTO en el propio original — abre error
  "Invalid column name 'MostrarQueHayDeNuevo'" (falta una columna en su BD).
  Nuestro dialogo de novedades cumple el slot con contenido real.
- **Ventana de Pagos (P):** "Pagos al Soporte Tecnico" con Nro./Fecha/Importe/
  Facturas/Registro + Refrescar/Descargar/Ver original, 0 filas. Pagos hacia
  el vendedor; misma consideracion que Facturas.
- **Monitor de Cobradores:** columnas confirmadas Cobrador/Lim. de Cob./
  Lim. de Pag./Cobrado/Depositado/Entregado/Pagado/Diferencia con 10 filas y
  cuenta regresiva "Faltan: N seg"; coincide con el monitor nuevo (RDM +
  limites + Auto-refresh).
CONCLUSION 2: sin brechas nuevas accionables; las ventanas F/Q/P del original
son dependientes del vendedor del software legacy o estan rotas en el demo.; sin brechas nuevas
pendientes (la unica diferencia estructural es el nombre partido en
apellidos, documentada arriba como decision de modelado).
