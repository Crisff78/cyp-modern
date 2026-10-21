# Cotizar un envío entre monedas

La tasa de remesas expresa cuántos pesos dominicanos vale una unidad de cada
moneda. DOP vale siempre uno. Para USD y EUR se usa la última tasa registrada
para esa moneda hasta la fecha de la operación, aunque se haya registrado días
antes. Una tasa futura no se aplica. Sin ninguna tasa disponible se bloquea la
cotización y se pide registrarla; no se supone que vale uno.

En Administración → Tasas de cambio, el encargado registra la **Tasa de remesas**.
Compra y Venta siguen siendo campos separados: no se deduce una fórmula
comercial nueva a partir de ellos. Registrar una tasa nueva no recalcula envíos
anteriores. La fecha y los valores aplicados quedan congelados con cada envío.

## Qué ve el operador en Administración y en la app del cobrador

1. Selecciona remitente y destinatario; revisa sus datos y monedas.
2. Elige si va a escribir el monto a enviar o el monto deseado en destino.
3. Pulsa Calcular cotización. El servidor calcula el otro importe y el
   equivalente del principal en pesos.
4. Revisa **Paga el remitente**: principal, comisión y total; y **Recibe el
   destinatario**: importe final en su moneda. La comisión vigente la paga el
   remitente; no se vuelve a descontar al destinatario.
5. La sección **Conversión por pesos dominicanos** muestra origen → DOP →
   destino, ambas tasas y sus fechas reales. Identifica si se conserva una tasa
   anterior. El reparto interno empresa/gestor puede desplegarse por separado.
6. Revisa y confirma solo después de recibir el total. El servidor vuelve a
   comprobar tasas, permisos, comisión y caja. Una tasa que cambió obliga a
   cotizar otra vez. Los avisos de caja anterior abierta siguen vigentes.

El cálculo usa enteros de precisión completa y redondea los importes finales a
centavos. El equivalente DOP mostrado también está redondeado: no se reutiliza
ese valor visual para introducir un segundo redondeo en el importe de destino.

## Ejemplo ficticio de comprobación

Con USD 1 = DOP 60 y EUR 1 = DOP 75:

- Principal USD 1,000 → equivalente DOP 60,000 → destinatario EUR 800.
- Si la política guardada cobra 10%, la comisión es USD 100 y el remitente paga
  USD 1,100. El destinatario sigue recibiendo EUR 800.
- Escribir EUR 800 como importe deseado permite calcular el principal en USD.

Son valores de prueba, no tasas de mercado ni porcentajes aprobados. No se
cambia la configuración comercial ni se inventa un cargo al destinatario.
Si se guardan USD=1 y EUR=1, el resultado será 1:1: la interfaz no puede sustituir
las tasas registradas por otras supuestas.

## Base de datos

Esta versión requiere `037_remittance_effective_rate_dates.sql` antes de arrancar
el servidor conectado a PostgreSQL. Se aplica con el mecanismo habitual de
migraciones (`pnpm db:migrate`) en la base que corresponda al entorno. La
migración añade las fechas reales de las tasas y conserva las restricciones del
libro; no modifica importes ni estados de los envíos. Las fechas históricas solo
se completan cuando existe una referencia inmutable que las acredita.

## Referencias oficiales consultadas

- [Western Union: tarifas y cotización](https://www.westernunion.com/us/es/transfer-fees.html):
  distinguir importe, cambio, tarifa, total y monto recibido.
- [Caribe Express: calculadora](https://caribeexpress.com.do/servicios/calculadora):
  cotizar según monto, moneda y tipo de envío.
- [Wise: enviar un importe exacto](https://wise.com/help/articles/2448314/how-can-i-send-an-exact-amount):
  introducir importe de origen o destino.

Estas referencias orientan la claridad de la pantalla. No establecen las tasas,
comisiones ni reglas comerciales de CyP.
