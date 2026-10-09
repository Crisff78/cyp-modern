# Cotización y reparto de comisiones

Contrato de las etapas 2–4 acordado con Gerencia, 9 de octubre de 2026.

## Estaciones pendientes de RRAA

La consulta del catálogo sigue disponible. El alta, la edición y la activación
manual devuelven `409 STATION_RRAA_REQUIRED`, incluso para Admin. No se emiten
licencias ni se valida un dispositivo con datos digitados. Los registros históricos
se conservan y se muestran como no validados. No se permiten nuevas asociaciones
de estaciones a PCPs; se conservan o retiran las existentes. Este bloqueo se
retirará únicamente al integrar el contrato real de RRAA.

## Cotización

`GET /api/envios/cotizacion` conserva `sourceCurrency`, `destinationCurrency`,
`amount` (centavos seguros), `commissionBps`. Acepta `amountMode=source|destination`
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
`{managerCommissionBps: 0..10000}`. El porcentaje inicial es 0, sin inventar una
tasa comercial. `GET /api/envios/snapshot` devuelve la política actual.
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
