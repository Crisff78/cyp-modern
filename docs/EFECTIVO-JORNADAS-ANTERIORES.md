# Efectivo pendiente de jornadas anteriores

Las entregas del libro de Cobros y Pagos son fondos de oficina al cobrador para
pagos autorizados. La caja de Envíos de Dinero sigue siendo independiente.

## Cómo continuar una prueba

1. En **Entregas de Dinero**, pulsar **Agregar** y seleccionar el cobrador.
2. Si tiene efectivo anterior, pulsar **Resolver saldo anterior**.
3. Revisar las jornadas y monedas. Se separan los cobros pendientes de devolver
   y el dinero entregado que todavía no se usó para pagos.
4. La administración recibe ese efectivo, escribe el importe recibido en cada
   moneda, el motivo y confirma la recepción. En la demo puede simularlo con
   **Usar importes ficticios de prueba**; este botón solo aparece en modo demo.
5. Pulsar **Registrar devolución**. Una vez guardada, continuar con la entrega
   actual. Esta operación no cierra la jornada de hoy, por lo que se pueden
   realizar más pruebas durante el día mientras exista capacidad de pago.

Una entrega de hoy que no se haya usado puede cancelarse desde la X roja y
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

- `GET /api/cuadres/pendientes?collectorId=<id>`: consulta sin efectos secundarios.
  Devuelve las filas por fecha/moneda, los totales en centavos enteros, incidencias,
  el historial y una `revision` del estado revisado. `canReconcile` solo es cierto
  si todos los pendientes pueden recibirse sin inconsistencias.
- `POST /api/cuadres/regularizar`: requiere sesión Admin e `Idempotency-Key`.
  Cuerpo estricto: `collectorId`, `revision`, `amounts` con `DOP`, `USD` y `EUR`
  en centavos enteros, `note` de 1–2000 caracteres y `confirmReceived: true`.
  Los importes deben coincidir exactamente con el saldo del servidor en **todas**
  las monedas; no se convierten ni se mezclan. Registra todas las filas en una
  sola transacción y devuelve los registros y totales confirmados.
- Un saldo cambiado devuelve `CASH_RECONCILIATION_CHANGED` (409); una diferencia
  requiere `CASH_RECONCILIATION_REVIEW_REQUIRED` (409). Importes distintos se
  rechazan con `CASH_RECONCILIATION_AMOUNT_MISMATCH` (422).
- Una respuesta perdida se recupera repitiendo la misma clave y cuerpo; no se
  duplica el asiento. Si falla el refresco después de confirmar, solo se repite
  la lectura, no la recepción.

Migración aditiva **032_collector_cash_reconciliations.sql**. No modifica las
migraciones anteriores ni relaja el constraint del cuadre original. En el
despliegue de la demo el arranque aplica las migraciones a la base dedicada.

Las pruebas automáticas usan datos sintéticos, MemoryStore/FileStore y un
PostgreSQL desechable en loopback. No acreditan una entrega física de efectivo
ni realizan recepciones sobre registros compartidos.
