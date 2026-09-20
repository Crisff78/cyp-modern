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
| G8 | Contabilidad legacy (EntidadesContables/MovimientosContables) | sin equivalente nuevo | DECISIÓN (¿fuera de alcance?) — pendiente de Rardiel |
| G9 | ~~Campos de contacto del cliente~~ **IMPLEMENTADO 2026-09-19** (legacy: alias, sector, telefono, celular, direccion, nota, email — validado contra layout A del .bak; el modelo nuevo solo tenia name/code/phone/address) | `006_client_contact.sql`, Client type, store carga/persistencia, formulario de cliente en QuickRecordModal, mock | MEDIA |

Decisiones cerradas que explican diferencias intencionales (no son brechas):
moneda unica DOP (selectores de Moneda del original quedan como pantalla),
cobros sin detalle de lineas (collections→charges), clientes no importados
directo del .bak, credenciales hasheadas.

## 7. Pendientes de verificacion en vivo

**Intento 2026-09-19 (ZCode):** el demo esta CAIDO del lado del servidor —
"Error abriendo conexion con la Base de Datos: Login failed for user ''"; el
enlace "Reiniciar la aplicacion" no lo recupera (falla persistente de la BD de
gdemos.ddns.net, infraestructura externa). Sesion anterior ademas habia
congelado el navegador. Captura en vivo de formularios de alta y ventanas
N/F/Q/P sigue PENDIENTE hasta que el demo vuelva a levantarse.

Validacion estatica realizada en su lugar (2026-09-19):
- Formulario de alta/edicion de CLIENTE: legacy guarda 9 campos de datos
  (id/codigo, nombre, alias, sector, telefono, celular, direccion, nota,
  email — layout A verificado del .bak). El admin nuevo solo tenia
  name/code/phone/address/route → **brecha G9 implementada**: campos alias,
  sector, celular, email y nota añadidos al modelo, store, formulario y mock.
- Formulario de alta de CARGO: `ChargeDataModal` cubre cliente/moneda/
  servicio/concepto/monto/nota (superconjunto razonable de las columnas del
  grid original); falta validacion visual contra el demo cuando vuelva.
- Ventanas N/F/Q/P del demo: contenido nunca observado en vivo; G5 las
  implementa con equivalentes funcionales (facturas=ultimos cobros con recibo,
  novedades, ventana de pagos pendientes).
