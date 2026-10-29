# Entrada de importes

> **Desde el 29-10-2026 los importes se escriben de izquierda a derecha**, como cualquier número. Orden de Rardiel:
> «a la hora de ingresar números en cualquier pestaña de la aplicación debería poder ser de izquierda a derecha y no de
> derecha a izquierda que es como está ahora (porque eso confunde)». Antes (desde el 25-10-2026) los dígitos entraban
> desde los centavos (`1` = `0.01`). El nombre del archivo se conserva para no romper enlaces.

Los importes de administración y del portal del cobrador usan el mismo control (`app/shared/MoneyInput.tsx`).

| Lo que se escribe | Mientras se escribe | Al salir del campo |
| --- | --- | --- |
| `1500` | `1,500` | `1,500.00` |
| `1500.5` | `1,500.5` | `1,500.50` |
| `1500.05` | `1,500.05` | `1,500.05` |
| `.5` | `0.5` | `0.50` |
| `1234567` | `1,234,567` | `1,234,567.00` |

- Las comas de los miles se colocan solas; el punto separa los centavos (hasta dos).
- Un tercer decimal, una letra, un signo o un segundo punto no se aceptan: el campo avisa «Escribe un importe válido.»
  y el importe no cambia. Un segundo punto solo lleva el cursor a los centavos.
- Retroceso y Suprimir borran como en cualquier campo. Con todo seleccionado, lo que se escribe sustituye al importe.
- En el teléfono sale el teclado numérico con punto.

Al pegar, el importe se toma tal como está escrito: `1500` → `1,500.00`; `1000.50` o `1,000.50` → `1,000.50`. Se
rechaza el contenido completo si contiene letras, signos, agrupación incorrecta, más de dos decimales o un valor fuera
del rango seguro. Nunca se recorta un pegado inválido para convertirlo en otro importe.

El teclado de cobros y pagos del cobrador también escribe de izquierda a derecha y vuelve a tener su botón de punto
(«Separador decimal») en lugar de `00`.

Se aplica a envíos y recepción de efectivo, apertura y cierre de caja de remesas, cargos y descargos, sus importes
recurrentes, líneas de cobros y pagos, componentes monetarios de depósitos, devolución de efectivo en cuadres, límites
del cobrador y precios de referencia. Las cantidades de billetes o monedas, cantidades de productos, tasas de cambio,
multiplicadores, porcentajes, identificadores y fechas ya se escribían de izquierda a derecha y no cambian.

La API sigue recibiendo los mismos centavos enteros y aplica los límites, permisos, saldos e idempotencia existentes. El
formato visible no cambia el valor contable ni reemplaza las validaciones del servidor.
