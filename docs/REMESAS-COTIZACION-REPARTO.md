# Cotización y reparto de comisiones

Contrato de las etapas 2–4 acordado con Gerencia, 9 de octubre de 2026.

## Estaciones y contrato de RRAA

El bloqueo anterior a la recepción del contrato de VALSTAT es un antecedente.
El contrato vigente está en [RRAA-ESTACIONES.md](RRAA-ESTACIONES.md): una instalación
configurada consulta al proveedor antes de guardar o activar una estación y antes
de agregarla a un PCP. Un rechazo, timeout o respuesta inválida impide la mutación.
La licencia procede de la respuesta del servidor. Las asociaciones históricas
pueden conservarse o retirarse sin validarlas retroactivamente.

Si la instalación no tiene RRAA configurado, incluido el modo demo público, el
alta, la edición y la activación permanecen bloqueadas con `STATION_RRAA_REQUIRED`.
El catálogo y la inactivación administrativa siguen disponibles. El ID de dispositivo
se introduce según el contrato recibido; VALSTAT no ofrece identificación física
automática del equipo. Esa vinculación requiere un contrato adicional del proveedor
y no queda acreditada por el UUID interno del catálogo.

## Cotización

`GET /api/envios/cotizacion` conserva `sourceCurrency`, `destinationCurrency`,
`amount` (centavos seguros) y `commissionBps` opcional, que solo puede coincidir
con la tasa central. Acepta `amountMode=source|destination`
(por defecto `source`). En modo destino, `amount` es el importe solicitado para
el destinatario. El servidor convierte inversamente con las tasas del día y
redondea al centavo de origen, mitad hacia arriba. Después calcula el importe
real de destino usando el mismo principal de origen. Puede diferir del solicitado
porque no todos los centavos de destino son representables en origen; la UI debe
mostrar ambos valores y la diferencia antes de la confirmación. Nunca se introduce
un ajuste de caja oculto para forzar el importe solicitado.

La respuesta siempre contiene `amount` en origen, `receiveAmount` real en destino,
`amountDop` (principal equivalente DOP, sin comisión), y, en modo destino,
`requestedReceiveAmount` y `receiveRoundingDifference` (real menos solicitado).
Los cálculos usan enteros BigInt y tasas DOP/unidad con seis decimales.
Si el equivalente indicativo DOP excede el entero seguro, queda no disponible;
esto no altera importes válidos de origen/destino ni crea un saldo DOP.
En `POST /api/envios`, `amount` sigue siendo origen; el campo opcional
`requestedReceiveAmount` permite verificar de nuevo el cálculo inverso. La API
rechaza un principal alterado. El comprobante conserva esta intención de entrada.

## Política y devengo

`POST /api/envios/politica-comisiones` es exclusivo de Admin y recibe
`{transactionCommissionBps: 0..10000, managerCommissionBps: 0..10000}`. Ambos
porcentajes iniciales son 0, sin inventar tasas comerciales. La comisión de cada
remesa procede de esta configuración y no se digita manualmente por operación.
`GET /api/envios/snapshot` devuelve la política actual. Ver
[COMISIONES-CONFIGURACION.md](COMISIONES-CONFIGURACION.md) para compatibilidad y
migración 026. La tasa del gestor no puede superar la tasa de la transacción.
La cotización guarda su revisión y porcentaje; cambiar la política requiere
recotizar, también si se cambia A → B → A. Una política con reparto positivo
no permite omitir su revisión al crear una remesa.

La comisión de transacción sigue cobrándose en origen, adicional al principal.
Para repartirla se convierte a destino con las tasas de la cotización. La parte
del gestor es `receiveAmount × managerCommissionBps / 10000`, redondeada a centavos
de destino. La empresa conserva el resto de la comisión convertida. Se rechaza
una cotización si la parte del gestor supera la comisión disponible; no se carga
un importe adicional al cliente ni se permite un resto negativo.

`commissionAllocation` registra versión 1, moneda destino, revisión de política,
porcentaje y base del gestor, comisión total convertida, parte empresa y parte
gestor; al guardar se captura ID y nombre del operador del envío como gestor.
No se infiere un gestor distinto del responsable seleccionado para la remesa.
El registro es inmutable y se devenga al crear la remesa. Los reportes separan
devengos vigentes de importes anulados; cancelar elimina su contribución vigente
sin borrar la evidencia. Pagar no devenga por segunda vez. No crea pagos al gestor
ni mezcla la caja DOP de cobros con la caja multimoneda de remesas.

Los campos manuales históricos `managerCommission` permanecen como información
sin convertirlos retroactivamente en deuda ni mezclarlos con el nuevo reparto.
La migración es aditiva y no recalcula remesas anteriores.

## Reporte consolidado para gerencia (etapa 5)

`GET /api/envios/reportes/comisiones` recibe `from`, `to` (fechas inclusivas de
emisión en America/Santo_Domingo), `grouping=range|day`,
`groupBy=managerCurrency|currency`, `status=all|active|pending|paid|cancelled`,
y opcionalmente `managerId` y `currency=DOP|USD|EUR`. Por defecto agrupa todo el
periodo por gestor y moneda, incluyendo todos los estados. `active` significa
pendientes y pagadas. Los valores desconocidos se rechazan; no amplía el acceso
a remesas fuera del ámbito de la sesión.

Devuelve los filtros aplicados, detalle, grupos y `currencyTotals` de todo el
periodo. Los tres importes vigentes son `transactionAmount`, `companyAmount` y
`managerAmount`, siempre centavos de destino. Se suman en BigInt y se rechaza
un total fuera del entero seguro. Los importes cancelados se informan aparte:
sus tres columnas de saldo vigente son cero, incluso al filtrar Canceladas.
Nunca se suma USD con EUR/DOP. Los gestores se identifican por ID estable;
homónimos no se fusionan. No se recalcula una comisión con tasas o porcentajes
actuales. Las operaciones históricas sin reparto se cuentan como excluidas.

La UI compartida de Admin/PWA muestra las columnas exactas `Comisión Total de la
Transacción`, `Comisión de la Empresa` y `Comisión del Gestor`, agrupación elegible,
filtros de periodo/estado/gestor/moneda, subtotales y totales por moneda.
Pantalla, CSV e impresión consumen las mismas secciones y filtros confirmados.
Editar un filtro invalida el resultado anterior hasta volver a Consultar.
El reporte conserva los registros de la 024. La configuración central de
la comisión de transacción requiere la migración 026 descrita arriba.
