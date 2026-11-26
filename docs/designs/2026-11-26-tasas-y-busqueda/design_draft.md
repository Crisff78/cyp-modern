# Búsqueda exacta, y Monedas y Tasas por separado (protocolo 0.9)

Plan escrito por Claude Code (Opus 5.5) el 2026-11-26, en la laptop de Rardiel, sobre `main` `ca2bd8b` (protocolo 0.8).
Esta es la versión que se programó, con lo que cambió la revisión EGM (ver `goldfish_review_report.md`).

## De dónde sale

Mensaje de Rardiel del 2026-11-26, con dos fotos de la otra parte: «Y esto: Quizás por que la búsqueda no es exacta. Y
ahora también él llegó a la parte donde necesita la moneda y la tasa, y ahora él las quiere separadas, que hay que hacer
una url para las tazas y una para las monedas».

- **Foto 1:** `…/cyp_clients?p=<sesión>|0000`. Respuesta con **todos** los clientes, cada uno con su `INT000000xx`
  delante. Hora 08:47 de RD: antes de publicar la 0.8 (09:27 en RD).
- **Foto 2:** la misma respuesta editada a mano, con «ID DE CLIENTE» delante. La 0.8 ya pone el número delante.

## Lo comprobado

- El Listado de Clientes buscaba cada palabra **dentro** del texto unido de código, nombre, cédula e identificación
  interna (`matchingClients`, `remittance-client-search.ts`). `0000` está dentro de todas las `INT000000xx`. Esto explica
  los «varios registros» del audio (el plan de la 0.8 lo atribuyó a Envíos por Entregar; se corrige).
- `listRemittanceClients` solo lo usa el protocolo; la web usa `searchRemittanceClients`.
- Envíos por Entregar busca igual, por trozos, dentro de `ENV…`, `REC…` y el código de operación: `0000` traería todos.
- Monedas: `DOP`, `USD`, `EUR` (`currencies`); nombres en `collector-assignments.ts`.
- Tasas: Cotizar usa `effectiveRate` con `businessDate(now)`: la última tasa con fecha hasta hoy; la moneda de origen se
  compra y la de destino se vende; una tasa de valor único sirve para las dos; el peso es `1.000000`.

## Qué se hace

| Archivo | Cambio |
| --- | --- |
| `app/server/src/remittance-client-search.ts` (modificar) | `protocolMatch` y sus ayudas (`compact`, `hasLetter`, `phoneDigits`, `phoneEnds`); `choosable`. La búsqueda de la web no cambia. |
| `app/server/src/remittance-delivery-search.ts` (modificar) | La misma regla exacta. |
| `app/server/src/remittances.ts` (modificar) | `ratesInForce`, sobre `effectiveRate`. |
| `app/server/src/text-protocol.ts` (modificar) | Comandos `currencies` y `rates`, parámetros, `REQUIRED`. |
| `app/server/src/text-protocol-routes.ts` (modificar) | Las dos peticiones; `exactId` con `clientOf`; una rama explícita por comando. |
| `app/server/test/text-protocol*.test.ts` (modificar) | Pruebas. |
| `docs/protocolo-cyp/Protocolo CYP 0.9.txt` (renombrar desde la 0.8) | 2.1 y 5.1 con la búsqueda nueva; sección 6. |
| `docs/PROTOCOLO-TEXTO-PLANO.md`, `docs/API_CONTRACTS.md` (modificar) | Al día. |

### Búsqueda exacta (Listado de Clientes y Envíos por Entregar)

Viene un cliente si su `idCliente` es el texto (resuelto con `clientOf`, la misma función de toda la central: el
número, la `INT` o el `id`), si su código o su cédula (sin guiones ni espacios, sin mayúsculas) es el texto, o si un
teléfono suyo termina en esas cifras o esas cifras terminan en él (7 cifras o más: con o sin código de país). **Solo
si el texto tiene una letra** (`\p{L}`), también por trozos: cada palabra dentro del código o del nombre. Así `0000`,
`12` o un trozo de cédula no traen a nadie por trozos. Se siguen respetando `Lado`, la ruta del Cobrador y los activos.

En Envíos por Entregar: el `NumEnvio`, el `NumRecibo` o el `CodOperacion` enteros; la cédula del destinatario entera;
su teléfono por el final; y con letras, las palabras en los nombres del destinatario y del remitente.

### Listado de Monedas: `/cyp_currencies?idSesion`

`OK|FechayHora|Monedas`, `MonedaX: idMoneda;Nombre`, en el orden `DOP`, `USD`, `EUR` («Peso Dominicano», «Dólar
Americano», «Euro»). La puede pedir quien puede enviar, ver envíos o entregar (`CURRENCY_ACCESS`).

### Tasas Vigentes: `/cyp_rates?idSesion[|idMoneda]`

`OK|FechayHora|Tasas`, `TasaX: idMoneda;TasaCompra;TasaVenta;Fecha;Actualizada`. Sale de `ratesInForce`, que llama a
`effectiveRate` por cada lado con el día de negocio de Cotizar: lo que enseña es lo que usa Cotizar. `Fecha` es el día de
la tasa (puede ser anterior); `Actualizada`, cuándo se registró o cambió (vacía para el peso sin tasa propia). El peso
viene siempre: la lista nunca está vacía. Con `idMoneda` sin tasa: `TNE` con la moneda en el Dato. Permiso: el de
Cotizar (la web ya le enseña a un Cajero las tasas vigentes en el resumen de remesas; `remittances.rates.view` es para
la ventana que las registra). El contrato dice que las tasas son para mostrar y que los importes salen de Cotizar.

## Lo que cuesta

- Quien buscaba por un trozo de número (cédula, teléfono de menos de 7 cifras, cifras sueltas) ya no encuentra nada, y
  no recibe un error: un listado vacío. Es lo que se pide; el contrato lo dice y el mensaje también.
- Se pierde buscar nombre y cédula en el mismo `Texto`.
- La web y la aplicación dan resultados distintos con el mismo texto.
- Tercera versión del documento en dos días. No consta que la 0.8 llegara a la otra parte: la 0.9 marca con `(NUEVO)`
  todo lo nuevo desde la 0.7, y el mensaje nuevo sustituye al 9.

## Lo que no se hace

- Cambiar la búsqueda de la web, o Cotizar.
- Datos nuevos en el Listado de Clientes.

## Pruebas

- Búsqueda: `0000` y trozos de cédula o de teléfono sin resultado; el número, la `INT`, el código, la cédula con y sin
  guiones o en minúsculas, y el teléfono con y sin código de país traen ese cliente; con letras, por trozos; las pruebas
  de antes. Envíos por Entregar con la misma regla.
- Monedas: las tres, en orden; Supervisión sí, un rol sin acceso `SPE`; sesión inválida `SNE`.
- Tasas: compra, venta, fecha y hora; las mismas que Cotizar; tasa de valor único; moneda sin tasa (`TNE` y fuera de la
  lista); `PIN` con `GBP`, `usd` y datos de más; Supervisión `SPE`.
- `withoutVersion` con `currencies` y `rates`.
- Suite del servidor, tipos, compilación pública y arranque real con PostgreSQL.
- En la demo, después de publicar y solo leyendo: `0000` `CNE`, monedas y tasas `OK`, el número de un cliente lo trae.
