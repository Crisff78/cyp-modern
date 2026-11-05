# Confirmación de envíos en moneda extranjera

El fallo se reprodujo en PostgreSQL local con un envío de USD 100, comisión de envío del 10%, compra a 63 y venta a 64: el destinatario recibe USD 98.44 y el remitente paga USD 110. La API calculaba ambas operaciones cambiarias correctamente según la regla vigente, pero la función SQL de la migración 044 rechazaba las ganancias cambiarias cuando origen y destino eran iguales. La restricción `remittance_calculation_valid` provocaba un error interno, tanto en efectivo como con tarjeta.

La migración aditiva **049_same_currency_remittance_calculation.sql** actualiza únicamente esa función: permite la compra y venta de la misma moneda extranjera a través de DOP. Conserva las comprobaciones matemáticas de ganancias, comisión de entrega, redondeo e importe a entregar, y los disparadores que vinculan las tasas a sus revisiones inmutables. No reescribe envíos ni sus importes históricos. La migración 044 permanece intacta.

La regresión real de PostgreSQL prueba USD→USD y EUR→EUR, en efectivo y crédito, lectura del envío guardado y rechazo de ganancias o importes a entregar manipulados. El caso USD/efectivo falló antes de aplicar 049 y los cuatro casos pasan después. La comprobación pública `sameCurrencyRecordsReady` de `/api/health` ejecuta consultas sintéticas de solo lectura para ambas monedas, sin crear envíos ni alterar cajas. `false` señala un validador incompatible y `null` una comprobación que no pudo realizarse.

Después de publicar, una operación que quedó con resultado incierto debe usar **Reintentar misma operación**. Se conserva su referencia de idempotencia: si ya existía, devuelve su resultado; si fue rechazada y no se guardó, puede registrarse tras la corrección. No crear otro envío con una referencia nueva antes de comprobar el anterior.

No se ejecutaron transacciones financieras en la demo compartida para acreditar este arreglo. Las pruebas con escrituras se realizaron únicamente en la base local aislada con datos ficticios.
