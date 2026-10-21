# Confirmación, pago y recibo del envío de dinero

La misma captura se usa en Administración y en la app del cobrador. Cotizar y
abrir **Confirmar envío** no crean un envío. **Cancelar** cierra esa revisión sin
registrar la operación ni las fichas de clientes nuevas. **Aceptar** vuelve a
validar todo en el servidor y registra una única operación idempotente.

## Formas de pago

El POST `/api/envios` admite `payment`:

- Efectivo: `{method:"cash",tenderedAmount:100000}`. Los números son centavos de
  la moneda de origen, no un valor en otra moneda. El servidor calcula la
  devuelta sobre `totalAmount`, que incluye la comisión. No admite un cambio
  digitado ni dinero insuficiente. Ejemplo: principal 900 y comisión 10% → total
  990; recibido 1,000 → devuelta 10. Con comisión 0% → devuelta 100.
- Tarjeta, Transferencia, Depósito: `{method:"card"|"transfer"|"deposit",
  reference:"COMPROBANTE",bank?:"Banco o proveedor",verified:true}`. Referencia
  obligatoria de 1–160 caracteres, sin controles; no se introduce efectivo ni se
  genera cambio. El operador comprueba el pago recibido antes de aceptar.
- Por compatibilidad, omitir `payment` en un consumidor anterior registra
  efectivo exacto. Los registros históricos sin método se muestran como método
  no registrado, sin inventar uno.

CyP **no cobra tarjetas ni ejecuta transferencias bancarias**. No hay contrato de
pasarela ni credenciales de un proveedor. No se piden número de tarjeta, CVV ni
claves. La pantalla advierte expresamente que registra un pago verificado fuera
del sistema. La referencia y la confirmación del operador no acreditan por sí
solas el procesamiento por un banco; ese control es responsabilidad de caja.

Los cuatro métodos necesitan la jornada del operador abierta en la moneda de
origen. El evento `sent` incrementa el efectivo solo para cash y por el total
neto, nunca por recibido más cambio. Los otros métodos generan evento de importe
físico cero. Los reportes de ventas/comisiones siguen incluyendo la operación.

Cancelar un envío pendiente por banco/tarjeta requiere `refund:{reference,
verified:true}`. Se guarda actor, fecha, medio y comprobante; no se ejecuta un
reembolso bancario ni se resta efectivo. El efectivo devuelve total neto y exige
saldo suficiente. Los importes de la comisión se anulan en los reportes como antes.

## Recibo para el cliente

El recibo se obtiene del detalle del envío, también después de registrarlo:

1. Referencia REC, fecha/hora, referencia ENV y estado.
2. Empresa, dirección y contacto, remitente y destinatario congelados.
3. Principal, equivalente DOP, total pagado y monto final a recibir.
4. Medio de pago y, según corresponda, recibido/devuelta o referencia bancaria.
5. Tasas exactas, tipo compra/venta y fechas de registro aplicadas.
6. Entrega/cancelación si existe, nota y pie de empresa configurable.

El recibo público usa una lista explícita de datos: no contiene el porcentaje,
importe ni reparto de comisiones de la empresa o del gestor. Estos permanecen en
la revisión interna y en los reportes autorizados. El total sí incluye lo que se
cobró. No se cambia el total para ocultar un cargo.

La empresa y el pie quedan guardados con los envíos nuevos. Una reimpresión usa
esas copias, aunque luego cambien la ficha, empresa o tasas. Para envíos anteriores
sin copia de empresa se usa la configuración disponible; no acredita un dato
histórico. El documento se imprime aislado de menús, adaptable al papel elegido
en el diálogo nativo del navegador/sistema, sin fijar modelo de impresora.
La prueba automatizada de la ventana no acredita impresión física.

## Tasas y límites comerciales

Se aplica Compra al recibir moneda extranjera y Venta al convertir DOP a la
moneda de destino. Se mantiene la última fecha vigente por moneda; nunca se usa
una tasa futura. El audio aportado explica compra 59/venta 61 como ejemplo, no
como tasas aprobadas para publicar ni como nuevos porcentajes comerciales.
La operación aceptada conserva ambas tasas. No se vuelve a convertir el envío
con la tasa de otro día al entregarlo.

El audio también menciona una posible comisión de entrega. No establece un valor
ni autoriza descontarlo: no se inventa un cargo adicional. La política comercial
central vigente sigue siendo la única comisión, sumada al total del remitente.

## Prueba manual con datos ficticios

1. Configuración de administración → Tasas de Cambio: registra USD Compra 59 y
   Venta 61; EUR Compra 69 y Venta 75. Son valores ficticios. No hace falta
   repetirlos al día siguiente para que sigan vigentes.
2. Cuadres Diarios → Caja de remesas: abre la jornada del operador y moneda de
   origen. Resuelve/cierra la jornada anterior si el sistema lo requiere.
3. Remesas → Envíos de dinero: selecciona dos clientes distintos; USD 1,000 hacia
   EUR debe cotizar DOP 59,000 y EUR 786.67. Revisa el total con la comisión central.
4. Prueba modo Destino con EUR 786.67: debe proponer USD 1,000 y mostrar cualquier
   diferencia de redondeo antes de aceptar.
5. Revisa el envío y pulsa Cancelar: no debe aparecer registro nuevo. Reabre,
   elige Efectivo e introduce más que el total: revisa Devuelta, acepta y abre el recibo.
6. Para cada otro método, intenta aceptar sin referencia/confirmación: debe
   impedirlo. En una prueba ficticia, completa comprobante y marca la verificación;
   al aceptar, el recibo muestra el medio y no cambia el efectivo físico.
7. Imprime o guarda en PDF. Comprueba referencia/fecha primero, empresa, partes,
   montos, pago, cambio solo en efectivo, tasas y pie; sin comisiones internas.
8. Repite en la app del cobrador y cambia después una tasa: el recibo guardado
   conserva la anterior. Cancelar un pago bancario requiere registrar su devolución.

Migraciones aditivas requeridas: 037–039, con el mecanismo habitual del proyecto.
Las verificaciones automáticas usan datos sintéticos, no pagos ni bancos reales.

## Referencias de operación consultadas

- [Western Union: métodos disponibles en agentes](https://www.westernunion.com/us/en/locations.html).
- [Western Union: envío y pago](https://www.westernunion.com/es/es/send-money-online.html).

Estas referencias distinguen pago en oficina y pago procesado por un proveedor.
No sustituyen un contrato bancario de CyP ni definen sus tasas o comisiones.
