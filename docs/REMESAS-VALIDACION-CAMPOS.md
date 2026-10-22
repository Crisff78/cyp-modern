# Validación de campos de Tasas y Envíos de dinero

La misma captura de remesas se usa en Administración y en la PWA del cobrador.
Las restricciones ayudan a introducir datos correctos; la autorización, los
importes, las tasas y el saldo definitivo siguen validados por la API.

| Campo | Entrada permitida | Validación al continuar |
| --- | --- | --- |
| Compra / Venta | Dígitos ASCII y un punto o una coma decimal; hasta 12 enteros y 6 decimales | Mayor que cero. Se envía punto decimal, sin redondear ni truncar. |
| Fecha de tasa | Solo lectura | Fecha de negocio actual del servidor. |
| Moneda de tasa y del envío | Selección DOP, USD o EUR | Enum en servidor. DOP permanece en 1. |
| Monto a enviar / recibir | Dígitos y un punto; hasta 2 decimales | Positivo y hasta 90071992547409.91; centavos enteros seguros en API. |
| Dinero recibido | El mismo formato monetario | Debe cubrir el total con comisión; el servidor calcula la devuelta. |
| Devuelta, equivalente en DOP, monto convertido y comisión | Solo lectura | Calculados otra vez por el servidor; no se aceptan totales arbitrarios. |
| Efectivo inicial / contado | El mismo formato monetario | Admiten cero; contado debe coincidir con el saldo del libro. |
| Remitente / destinatario / Buscar | Texto mixto, hasta 160 caracteres, una sola línea | Selección de una ficha existente, activa y autorizada. Una búsqueda no es un alta. |
| Cliente nuevo: nombre | Texto Unicode hasta 160 caracteres | Debe contener letras. Se conservan apóstrofos, acentos, guiones y nombres comerciales con números. |
| Cédula o pasaporte | Letras, números, espacios, guiones, puntos y barras; hasta 80 | Obligatorio, con al menos una letra o un número. Se conservan ceros iniciales. |
| Teléfono | Dígitos, + inicial, espacios, guiones y paréntesis; hasta 40 caracteres | Entre 8 y 15 dígitos si se informa. Sin letras, puntos ni extensiones. |
| Dirección | Texto de una línea, hasta 240 caracteres | Sin controles; admite referencias como #12, local B, apóstrofos y barras. |
| Ruta / operador / forma de pago | Opciones disponibles | Entidad y permisos comprobados en la API. |
| Nota / motivo | Texto y puntuación; varias líneas | UI hasta 500 caracteres; la API conserva el contrato de nota de hasta 2000 y motivo de hasta 500. Sin NUL ni controles no textuales. |
| Comprobante, banco/proveedor y referencia de devolución | Texto mixto hasta 160 caracteres en una línea | Sin controles, saltos Unicode ni marcas invisibles, comprobados antes de trim. La referencia es obligatoria para pagos externos y devoluciones; requieren verificación del operador. |

Los importes y las tasas no admiten signos, exponentes, hexadecimal, símbolos
monetarios, espacios ni separadores de miles. El pegado se evalúa completo antes
de que el navegador pueda aplicar `maxLength`. Si se rechaza un importe o una tasa,
el valor previo permanece visible y se señala el campo; hay que corregirlo para
continuar. No se elimina solo la parte inválida de un importe.

No se usa una lista negra de palabras SQL en nombres ni notas. PostgreSQL recibe
los valores separados de la sentencia mediante parámetros; React y la impresión
tratan los datos como texto escapado. Esto permite conservar nombres como
`José O'Connor & Hijos #2` y notas como `saldo < 100`.

## Pruebas

- `remittance-inputs.test.ts`: omite la UI y envía valores mal formados a las
  rutas reales de Fastify, verificando que no se creen clientes, tasas,
  historial, envíos ni movimientos parciales. Comprueba además SQL parametrizado.
- `remittance-field-inputs.test.ts` y `rateInput.test.ts`: límites exactos,
  formatos y conservación de datos legítimos.
- `october-nine-financial-ui.test.ts`: formulario de tasas en Edge, incluyendo
  escritura, pegado, coma decimal, precisión y bloqueo del valor anterior.
- `remittance-quote-allocation-ui.test.ts`: Admin y PWA reales, incluyendo captura,
  dinero recibido, comprobantes, errores, devuelta y cancelación.

Se usan datos ficticios y MemoryStore en loopback; estas pruebas no escriben en
la demo compartida ni en una base de clientes.

Referencias: [Validación de entradas de OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)
y [Prevención de inyección SQL de OWASP](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html).
