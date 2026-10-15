# Cuadres Diarios y devolución de efectivo

Las entregas del libro de Cobros y Pagos son fondos de oficina al cobrador para
pagos autorizados. La caja de Envíos de Dinero sigue siendo independiente.

## Dónde se realiza el cierre

El cierre y la devolución se realizan exclusivamente en **Cuadres Diarios**.
Entregas de Dinero registra las entregas; si encuentra un pendiente anterior,
indica que debe completarse el cuadre y no ofrece otro lugar para conciliar.

1. Abrir **Cuadres Diarios** con una cuenta Admin. La grilla incluye jornadas
   **Pendientes**, **Cerradas** y **Conciliadas**, por cobrador y moneda.
2. Seleccionar una jornada pendiente y pulsar **Revisar cuadre**, o hacer doble
   clic. **Generar cuadre** permite elegir directamente cobrador y fecha.
3. Revisar todas las monedas. Si hay pendientes anteriores, completar primero
   la jornada más antigua. El sistema no mezcla sus saldos con días posteriores.
4. Si las cuentas ya están en cero, pulsar **Cerrar jornada**. Si queda efectivo,
   pulsar **Registrar devolución y cerrar**. Se separan los cobros pendientes de
   devolver y el dinero entregado que todavía no se usó para pagos.
5. La administración recibe ese efectivo, escribe el importe recibido en cada
   moneda, el motivo y confirma la recepción. En la demo puede simularlo con
   **Usar importes ficticios de prueba**; este botón solo aparece en modo demo.
6. Pulsar **Registrar devolución y cerrar**. La devolución y el cierre quedan
   guardados; la jornada pasa a **Conciliado** y se puede volver a consultar,
   imprimir o exportar. Los cierres sin devolución figuran como **Cerrado**.

También se puede cerrar el día actual. Al hacerlo, se bloquean nuevos movimientos
de ese cobrador en esa fecha; debe hacerse al terminar su trabajo. Conciliar una
jornada anterior permite continuar con las entregas del día actual.

Una entrega de hoy que no se haya usado y cuya jornada siga abierta puede cancelarse desde la X roja y
registrando el motivo. Los fondos usados en pagos deben revisarse junto con esos
pagos. Si se conserva efectivo hasta otro día, repetir la devolución administrativa.
Un saldo negativo o una jornada cerrada inconsistente requiere revisión de sus
movimientos y no puede marcarse como resuelto automáticamente.

## Registro y protección

La devolución conserva el libro original y añade un registro inmutable con
cobrador, jornada, moneda, desglose, importe, responsable, motivo y hora real de
recepción. No borra, cancela ni cambia de fecha los movimientos originales.
Los saldos disponibles descuentan ese efectivo, manteniendo separados DOP, USD
y EUR. Cuadres y monitores conservan los importes históricos y muestran el saldo
neto; Cuadres identifica el importe devuelto/conciliado.
La campana descuenta las devoluciones confirmadas de los cobros pendientes. Si
un depósito anterior estaba pendiente de aceptación, todavía puede aceptarse:
eso reconoce su recepción y no cambia el importe ni reabre el saldo conciliado.

Solo Admin puede registrar la recepción. Los permisos de lectura administrativa
se conservan. No existe una acción para saltarse la validación de caja ni resetear
los datos compartidos de la demo.

## Contrato de API

- `GET /api/cuadres/pendientes?collectorId=<id>&date=YYYY-MM-DD`: consulta sin efectos secundarios.
  Con `date` revisa exclusivamente esa jornada, incluyendo el día actual, y
  rechaza fechas futuras. Sin `date` conserva la consulta compatible de todas
  las jornadas anteriores. La interfaz usa siempre la fecha del cuadre elegido.
  Devuelve las filas por fecha/moneda, los totales en centavos enteros, incidencias,
  el historial y una `revision` del estado revisado. `canReconcile` solo es cierto
  si todos los pendientes pueden recibirse sin inconsistencias.
- `POST /api/cuadres/regularizar`: requiere sesión Admin e `Idempotency-Key`.
  Cuerpo estricto: `collectorId`, `date` opcional, `revision`, `amounts` con `DOP`, `USD` y `EUR`
  en centavos enteros, `note` de 1–2000 caracteres y `confirmReceived: true`.
  Los importes deben coincidir exactamente con el saldo del servidor en **todas**
  las monedas; no se convierten ni se mezclan. Registra todas las filas en una
  sola transacción y devuelve los registros y totales confirmados.
- `POST /api/cuadres`: cierre sin devolución, con `collectorId`, `date` e
  `Idempotency-Key`. Requiere cada bolsillo en cero y ningún efectivo anterior
  pendiente. El formulario conserva la operación original si se pierde la respuesta.
- Un saldo cambiado devuelve `CASH_RECONCILIATION_CHANGED` (409); una diferencia
  requiere `CASH_RECONCILIATION_REVIEW_REQUIRED` (409). Importes distintos se
  rechazan con `CASH_RECONCILIATION_AMOUNT_MISMATCH` (422).
- Una respuesta perdida se recupera repitiendo la misma clave y cuerpo; no se
  duplica el asiento. Si falla el refresco después de confirmar, solo se repite
  la lectura, no la recepción.

Migraciones aditivas **032_collector_cash_reconciliations.sql** y
**033_same_day_cash_settlement.sql**. La 033 permite recibir efectivo de la
misma fecha operativa; conserva la inmutabilidad y las comprobaciones de importes.
No modifica las migraciones anteriores ni el constraint del cuadre original. En el
despliegue de la demo el arranque aplica las migraciones a la base dedicada.

Las pruebas automáticas usan datos sintéticos, MemoryStore/FileStore y un
PostgreSQL desechable en loopback. No acreditan una entrega física de efectivo
ni realizan recepciones sobre registros compartidos.
