# Configuración central de comisiones de envíos

> **Desde el 29-10-2026** el gestor cobra un porcentaje **de la comisión** (no del monto), la ventana
> tiene además el redondeo de lo que recibe la persona y los conceptos de comisión de entrega, y el
> reparto va en la moneda de quien envía. Las reglas y ejemplos vigentes están en
> [CALCULO-ENVIOS.md](CALCULO-ENVIOS.md); lo de abajo describe la versión anterior y sigue valiendo
> para los envíos hechos antes de esa fecha.

Los porcentajes se registran una vez en Archivos → Admin. → Comisiones de envíos
(ventana «Comisiones de Envíos»; antes «Comisiones de remesas»).
Solo Admin con permiso de administrar comisiones puede modificarlos. Admin y la PWA del cobrador toman
la configuración guardada automáticamente; el formulario de un envío muestra
la comisión como solo lectura. Ambos porcentajes empiezan en 0%; Admin los
introduce manualmente y puede cambiarlos cuando lo necesite. No se modifica el
libro DOP de cobros.

Rardiel confirmó este alcance el 10 de octubre de 2026: no hay porcentajes fijos
que deba elegir el asistente ni una aprobación externa pendiente para dar por
implementada la configuración. Un valor inicial de 0% es válido; los valores
comerciales quedan bajo control de Admin, dentro de las validaciones de la API.

## Contrato

- `GET /api/envios/snapshot` incluye `commissionPolicy` con `revision`,
  `transactionCommissionBps`, `managerCommissionBps`, `updatedAt?` y `updatedBy?`.
  Los porcentajes son enteros de 0 a 10000 BPS (100 BPS = 1%).
- `POST /api/envios/politica-comisiones`, exclusivo de Admin, recibe
  `{transactionCommissionBps, managerCommissionBps}` y devuelve la configuración
  persistida. Requiere `Idempotency-Key`. El porcentaje del gestor no puede
  superar el de la transacción. Para compatibilidad, omitir
  `transactionCommissionBps` conserva el porcentaje ya configurado; nunca lo
  toma de un envío individual.
- `GET /api/envios/cotizacion` ya no necesita `commissionBps`. El servidor toma
  la tasa central y devuelve el porcentaje e importes aplicados, junto con la
  revisión de configuración.
- `POST /api/envios` tampoco necesita `commissionBps`. La cotización confirma
  la revisión vigente y el servidor recalcula los importes al guardar.
- Si un cliente anterior envía `commissionBps`, solo se acepta si coincide
  exactamente con la tasa configurada. Un valor distinto devuelve
  `409 COMMISSION_POLICY_MISMATCH`, sin registrar un envío ni mover la caja.
  Una cotización de una configuración anterior devuelve `409 QUOTE_CHANGED`.

La comisión total se cobra sobre el principal en origen. Se convierte a destino
para repartirla: gestor = importe final de destino × tasa del gestor; empresa =
comisión total convertida − comisión del gestor. Se mantienen los redondeos del
servidor y el control de reparto disponible. La cancelación excluye el devengo
de los totales vigentes, conservando su evidencia.

## Persistencia y compatibilidad

Aplicar la migración aditiva `026_remittance_transaction_commission.sql` antes
de iniciar esta versión con PostgreSQL. Agrega la tasa de transacción a la
configuración; no cambia ni recalcula envíos, comisiones o anotaciones anteriores.
Si una instalación antigua tenía un porcentaje del gestor positivo, el Admin
debe configurar una tasa de transacción suficiente antes de crear nuevos envíos.
Los registros históricos permanecen consultables. Cambiar la configuración
solo afecta operaciones futuras. Un reintento idempotente recupera el recibo
original aunque entretanto haya cambiado la configuración.

Pantalla, exportación e impresión usan los importes guardados en cada envío,
incluyendo las tres comisiones del reporte consolidado (Reportes & Monitoreo →
Reportes → «Reporte consolidado de comisiones»); no consultan las tasas
actuales para recalcular la historia. Esto no implementa pagos o liquidaciones
al gestor ni elige un porcentaje comercial por Gerencia.
