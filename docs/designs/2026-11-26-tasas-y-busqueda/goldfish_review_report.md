# Revisión EGM del plan: búsqueda exacta, Monedas y Tasas (protocolo 0.9)

Dos revisores nuevos sobre la primera versión del plan, el 2026-11-26: `egm-codebase-details` y `egm-design`. Ninguno
encontró bloqueantes. Resolución de Claude Code (Opus 5.5).

## Importantes

- **El `idCliente` exacto se resuelve en las rutas** (los dos). Resuelto: la búsqueda recibe `exactId`, el cliente que
  da `clientOf` para el texto; no se reescriben sus reglas (número único, `0031` no es número, `INT` exacta).
- **Con solo cifras, el usuario puede estar pensando en el Codigo** (diseño). Resuelto: el código exacto también entra
  con solo cifras, y el contrato dice que pueden venir dos clientes y se elige por el nombre.
- **El teléfono por el final, mal definido** (los dos). Resuelto: «uno termina en el otro», 7 cifras o más, con el mismo
  corte por números de `phoneMatches` (`phoneEnds`). Probado con y sin código de país en los dos sentidos. Las 7 últimas
  cifras sí encuentran; menos, no. En la semilla todos los clientes tienen el mismo teléfono: con él vienen todos.
- **Envíos por Entregar tenía el mismo fallo** (diseño). Resuelto: la misma regla exacta en `pendingDeliveries`.
- **Las peticiones nuevas caerían en `recs`** (código). Resuelto: una rama por comando, `recs` explícito y `PNE` al final.
- **Reglas de las palabras** (código). Resuelto: solo con una letra (`\p{L}`), cada palabra dentro del texto unido de
  código y nombre. Se pierde buscar nombre y cédula juntos: dicho en el plan.
- **`ratesInForce` sobre `effectiveRate`** (código). Resuelto: llama a `effectiveRate` por cada lado, con
  `businessDate(now)` como Cotizar, seis decimales y la fecha en `YYYYMMDD`. Se omite la moneda sin `latestRate`. Una
  tasa guardada inválida daría `ORC` en la lista entera, igual que en Cotizar.
- **`TNE` con Dato y mensaje propios; `idMoneda` opcional** (los dos). Resuelto: `ProtocolError("TNE", "No hay tasa
  vigente de USD", "USD")`; vacío es «todas»; `usd` y `GBP` son `PIN` con `idMoneda`. El contrato añade `TNE` a la lista
  de errores con Dato.
- **Lo que necesita quien programa la aplicación de las tasas** (diseño). Resuelto en el contrato: son para mostrar y
  los importes salen de Cotizar (si no, `CCA`); pueden cambiar durante el día, y por eso se añadió `Actualizada`; se
  llaman «Tasas Vigentes» porque la fecha puede ser anterior; el orden; el peso siempre; con valor único, compra y venta
  iguales; solo las que tienen tasa se pueden cotizar.
- **Permisos** (diseño). Resuelto: Tasas con el permiso de Cotizar, explicado (la web ya enseña al Cajero las tasas
  vigentes; `remittances.rates.view` es para la ventana de registro). Monedas para quien puede enviar, ver envíos o
  entregar.
- **El cambio es silencioso y no consta qué versión tiene la otra parte** (diseño). Resuelto: la 0.9 marca todo lo
  nuevo desde la 0.7 (la última confirmada), «Lo nuevo» dice que una búsqueda por un trozo de número ya no encuentra
  nada, y el mensaje nuevo sustituye al 9 y le pide a la otra parte que, para traer a todos, deje el Texto vacío.
- **Frases del contrato que quedaban falsas** (los dos): índice, viñetas de 2.1 y 5.1, puntos 6 y 7, `PuedeEnviar`,
  «Lo nuevo», el Dato de `TNE`, `TNE` en Errores, la pregunta 1 y el nombre del dólar. Corregidas.

## Menores

- «Dólar Americano», el nombre de `collector-assignments.ts`, también en el formato de los datos.
- «cl» trae todos los `CL-…`: dicho en 2.1, punto 7.
- La cédula sin mayúsculas: también para un pasaporte (`compact`).
- La web sigue trayendo a todos con `0000`: dicho en el documento interno.
- Cabeceras y enlaces a la 0.8: corregidos.
- Pruebas de formato de `withoutVersion` con `currencies` y `rates`, `p=`, datos de más y `SNE`: añadidas.

## No comprobado por los revisores

Las fotos (las vio Claude); si para la otra parte `0000` quería decir «todos» (el mensaje se lo aclara); si la 0.8 le
llegó; el formato de monedas de LSAN.
