# Configuración central de comisiones de remesas

Las tasas se registran una vez en Administración → Remesas → Tasas → Reparto
de comisiones. Solo Admin puede modificarlas. Admin y la PWA del cobrador toman
la configuración guardada automáticamente; el formulario de una remesa muestra
la comisión como solo lectura. Ambos porcentajes empiezan en 0% hasta que
Gerencia indique los valores comerciales. No se modifica el libro DOP de cobros.

## Contrato

- `GET /api/envios/snapshot` incluye `commissionPolicy` con `revision`,
  `transactionCommissionBps`, `managerCommissionBps`, `updatedAt?` y `updatedBy?`.
  Los porcentajes son enteros de 0 a 10000 BPS (100 BPS = 1%).
- `POST /api/envios/politica-comisiones`, exclusivo de Admin, recibe
  `{transactionCommissionBps, managerCommissionBps}` y devuelve la configuración
  persistida. Requiere `Idempotency-Key`. El porcentaje del gestor no puede
  superar el de la transacción. Para compatibilidad, omitir
  `transactionCommissionBps` conserva el porcentaje ya configurado; nunca lo
  toma de una remesa individual.
- `GET /api/envios/cotizacion` ya no necesita `commissionBps`. El servidor toma
  la tasa central y devuelve el porcentaje e importes aplicados, junto con la
  revisión de configuración.
- `POST /api/envios` tampoco necesita `commissionBps`. La cotización confirma
  la revisión vigente y el servidor recalcula los importes al guardar.
- Si un cliente anterior envía `commissionBps`, solo se acepta si coincide
  exactamente con la tasa configurada. Un valor distinto devuelve
  `409 COMMISSION_POLICY_MISMATCH`, sin registrar una remesa ni mover la caja.
  Una cotización de una configuración anterior devuelve `409 QUOTE_CHANGED`.

La comisión total se cobra sobre el principal en origen. Se convierte a destino
para repartirla: gestor = importe final de destino × tasa del gestor; empresa =
comisión total convertida − comisión del gestor. Se mantienen los redondeos del
servidor y el control de reparto disponible. La cancelación excluye el devengo
de los totales vigentes, conservando su evidencia.

## Persistencia y compatibilidad

Aplicar la migración aditiva `026_remittance_transaction_commission.sql` antes
de iniciar esta versión con PostgreSQL. Agrega la tasa de transacción a la
configuración; no cambia ni recalcula remesas, comisiones o anotaciones anteriores.
Si una instalación antigua tenía un porcentaje del gestor positivo, el Admin
debe configurar una tasa de transacción suficiente antes de crear nuevas remesas.
Los registros históricos permanecen consultables. Cambiar la configuración
solo afecta operaciones futuras. Un reintento idempotente recupera el recibo
original aunque entretanto haya cambiado la configuración.

Pantalla, exportación e impresión usan los importes guardados en cada remesa,
incluyendo las tres comisiones del reporte consolidado; no consultan las tasas
actuales para recalcular la historia. Esto no implementa pagos o liquidaciones
al gestor ni elige un porcentaje comercial por Gerencia.
