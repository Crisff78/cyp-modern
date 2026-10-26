# Entrada de importes desde los centavos

Los importes contables de administración y del portal del cobrador usan el mismo
control. Los dígitos entran desde la derecha, con dos decimales fijos:

| Dígitos escritos | Importe mostrado |
| --- | --- |
| `1` | `0.01` |
| `10` | `0.10` |
| `100` | `1.00` |
| `1000` | `10.00` |
| `100000` | `1,000.00` |
| `123456789` | `1,234,567.89` |

Para sustituir un importe, selecciona su contenido y escribe. Retroceso quita
un dígito; con todo seleccionado, Retroceso deja el campo vacío. Las comas y el
punto se colocan automáticamente. En un teclado físico, el punto también permite
editar directamente las dos posiciones decimales del importe mostrado.

Al pegar, los dígitos sin separadores siguen la misma regla (`100000` →
`1,000.00`). Un importe que ya incluye punto decimal o agrupación de miles
conserva su significado (`1000.50` o `1,000.50` → `1,000.50`). Se rechaza el
contenido completo si contiene letras, signos, agrupación incorrecta, más de dos
decimales o un valor fuera del rango seguro. Nunca se recorta un pegado inválido
para convertirlo en otro importe. Hay que corregir el campo antes de confirmar.

Se aplica a envíos y recepción de efectivo, apertura y cierre de caja de remesas,
cargos y descargos, sus importes recurrentes, líneas de cobros y pagos, componentes
monetarios de depósitos, devolución de efectivo en cuadres, límites del cobrador
y precios de referencia. El teclado de cobros y pagos del cobrador también
introduce centavos; su botón `00` escribe dos ceros.

Las cantidades de billetes o monedas, cantidades de productos, tasas de cambio,
multiplicadores, porcentajes, identificadores y fechas mantienen su forma de
entrada. El valor por moneda de las máquinas conserva su precisión de cuatro
decimales. Los importes ya guardados se muestran con miles y dos decimales sin
volver a desplazarlos. Los totales de solo lectura conservan sus cálculos.

La API sigue recibiendo los mismos centavos enteros y aplica los límites,
permisos, saldos e idempotencia existentes. El formato visible no cambia el valor
contable ni reemplaza las validaciones del servidor.
