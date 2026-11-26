# El `idCliente` del protocolo como número entero (protocolo 0.8)

Plan escrito por Claude Code (Opus 5.5) el 2026-11-26, en la laptop de Rardiel, sobre `main` `743d17b` (protocolo 0.7).
Esta es la versión que se programó, con lo que cambió la revisión EGM (ver `goldfish_review_report.md`).

## De dónde sale

Rardiel mandó el 2026-11-26 un audio de WhatsApp de la otra parte (1 min 6 s) con «Me dijeron esto». Se transcribió en
la laptop con Whisper large-v3. La transcripción se queda en la laptop (no va a este repositorio, que es público) y es
salida de máquina: no se cita como palabras literales de nadie. Lo que dice, en resumen de Claude:

- Trabajan con un **ID de cliente que es un número entero**, y eso es lo que quieren mandar al hacer las transacciones.
- No quieren mandar **la identificación** del cliente para las transacciones: «tiene que ser con ID de cliente».
- Al mandar la identificación les llegan **varios registros**, cuando una persona solo tiene una identificación.

## Lo comprobado

- Desde la 0.6, el `idCliente` es la identificación interna del cliente, `INT00000031` (`text-protocol-routes.ts`). En
  la web ese dato se llama «Identificación interna» (`app/client-admin/src/App.tsx`).
- En la 0.7, para entregar, el contrato manda buscar el envío por la cédula del destinatario (`cyp_pend` solo tiene
  `Texto`), y `cyp_pend` trae un registro por envío.
- En el sistema viejo existen `idCliente` y `stpSeleccionarClientePorIdentificacion` (`legacy/database/table_summary.json`).
  No consta el tipo de la columna.
- La identificación interna solo la genera la central (`reserveClientIdentity`, `client-identities.ts`): `INT` y una
  secuencia única con 8 cifras. No se puede escribir a mano y no cambia (`CLIENT_IDENTITY_IMMUTABLE`, `app.ts`). La base
  admite de 8 a 16 cifras y la unicidad es por el texto (migración 029). Ningún camino crea clientes con un `id` de solo
  cifras (`randomUUID`, `cli-N`, `demo-v2-client-…`).
- En la demo, con `cob` y solo leyendo (2026-11-26): 45 clientes, todos con `INT` y 8 cifras; 25 con cédula, ninguna
  repetida. `cyp_clients` por la cédula, con o sin guiones: siempre 1 cliente. **`cyp_pend` por la cédula de un
  destinatario: 9 envíos** (los 52 pendientes son de 6 destinatarios). `cyp_clients` con `31`: 3 clientes.

Lectura de Claude: piden dos cosas. (1) Un `idCliente` numérico. (2) Hacer las transacciones con el `idCliente`, no con
la cédula; donde hoy se usa la cédula es al buscar el envío para entregarlo. Lo de «varios registros» no es un fallo de
la consulta: Envíos por Entregar trae un registro por envío, y esa persona tenía varios.

## Qué se hace

Sin migración y sin tocar la web.

| Archivo | Cambio |
| --- | --- |
| `app/server/src/text-protocol-routes.ts` (modificar) | `clientIds` y `clientOf` por el número; `idDestinatario` en `pend`; la repetición de `pay` vuelve a armar el registro. |
| `app/server/src/text-protocol.ts` (modificar) | El cuarto parámetro de `pend`; cabecera. |
| `app/server/src/client-identities.ts` (modificar) | Una identificación interna nueva no puede tener por número el `id` de un cliente. |
| `app/server/test/text-protocol.test.ts` (modificar) | La prueba de la 0.6 con números; una prueba nueva de la 0.8. |
| `app/server/test/client-identity-assignment.test.ts` (modificar) | La regla nueva de `taken`. |
| `docs/protocolo-cyp/Protocolo CYP 0.8.txt` (renombrar desde la 0.7) | El `idCliente` numérico, `idDestinatario`, los varios registros. |
| `docs/PROTOCOLO-TEXTO-PLANO.md`, `docs/API_CONTRACTS.md` (modificar) | Al día. |

### El número

- **Sale** el número de la identificación interna, como texto y sin ceros delante: `INT00000031` → `31`,
  `INT00000000` → `0`. Se calcula como texto (16 cifras no caben en un `Number`). Sale en `cyp_clients`, `cyp_client`,
  el registro de `recs`, `pend` y `pay`, y el Dato de `CFR` al entregar. El mapa se arma una vez por petición con
  **todos** los clientes (también inactivos y de otras rutas).
- **Entra** (`cyp_client`, `idRemitente` e `idDestinatario` de `cyp_send`, `idDestinatario` de `cyp_pend`):
  1. Un número escrito como sale (`0` o de 1 a 16 cifras sin ceros delante): el único cliente con ese número; si no
     hay ninguno, el cliente con ese `id`. `0031` no es un número: se busca como `id`.
  2. `INT` y cifras: por la identificación interna, como en la 0.6.
  3. Cualquier otra cosa: por el `id` (el largo de antes de la 0.6).
- **Garantía.** El número es único porque la secuencia lo es, y ningún `id` es solo cifras. Por si alguna vez llegaran
  datos que no cumplan (importación, SQL a mano): dos clientes con el mismo número salen con la `INT` entera y el número
  no es de nadie (`CNE`); y `taken` ya no deja crear una identificación interna cuyo número sea el `id` de un cliente.
  Un cliente sin identificación interna sigue saliendo con su `id`: en la demo no hay ninguno (`assignMissingClientIdentities`);
  fuera de la demo es un requisito para una central real («Antes de producción»).
- El Dato de `CNE`, `CIN` y `CFR` de `client` y `send` sigue siendo el texto tal como llegó.
- **`idOperacion`:** la huella no cambia. Repetir un envío con otra forma del id es `OPD`, como en la 0.6.
- **La repetición de `pay`** (mismo `idOperacion` y mismos datos) ya no devuelve el texto guardado: vuelve a armar el
  registro del envío, que no cambia (una entrega no se deshace), con el `idCliente` de hoy. Así una entrega de la 0.7
  repetida después no trae la `INT`.

### Envíos por Entregar con el `idCliente`

`/cyp_pend?idSesion[|Texto[|Pagina[|idDestinatario]]]`: con `idDestinatario`, solo los envíos pendientes a ese cliente.
Se combina con `Texto`. Un `idDestinatario` que no es de nadie: `CNE` con el texto. El contrato cambia el paso 2 de la
entrega: se busca al destinatario en el Listado de Clientes y se piden sus envíos con su `idCliente`; la cédula queda
para comprobar a quién se le entrega.

### El contrato (0.8)

- El `idCliente` es un número entero, sin ceros delante (hoy hasta 8 cifras, nunca más de 16): guárdelo como texto o en
  un entero de 64 bits. `INT00000031` y el largo se siguen aceptando.
- El `idCliente` no es la Identificacion (cédula o pasaporte) ni el Codigo (`CLI00000012` no es el `idCliente` 12).
- Envíos por Entregar: un registro por envío; una persona puede tener varios envíos pendientes, cada uno con su
  remitente. Listado de Clientes: una búsqueda trae todos los que tienen el texto (`31` trae también los que tienen 31
  en el código).
- Frases que cambian: formato de los identificadores, la descripción del `idCliente`, el punto 5 de 2.1, el 3 de 2.2, el
  c de 3.2, el `idRemitente` de 4.1, los pasos de la entrega, «Lo nuevo de esta versión», las preguntas 7 y 11, y todos
  los ejemplos con `INT`.
- `(NUEVO)` solo en lo de la 0.8: la otra parte tiene la 0.7 (Rardiel, 2026-11-25: «Yo le llegué a mandar el 0.7»).
- La palabra «Identificación interna» de la web no va en el contrato: va en el mensaje para Rardiel.

## Lo que cuesta

- Es la segunda vez que cambia la forma del `idCliente`. Lo guardado con `INT…` sigue valiendo; un envío repetido con
  la otra forma da `OPD`.
- Sin la `INT` delante, un número equivocado puede ser otro cliente real (hoy daba `CNE`). El contrato pone el ejemplo
  del Codigo; la aplicación toma el `idCliente` del listado.
- La web copia la `INT` en la cédula al crear un cliente sin cédula (`App.tsx`): la Identificacion de ese cliente puede
  valer `INT00000031`. En la demo no hay ninguno. Anotado.
- Fuera de la demo: clientes sin identificación interna, y cédulas repetidas (la base no las impide y el alta de la web
  no las comprueba): anotado en «Antes de producción».

## Lo que no se hace

- Cambiar la búsqueda del Listado de Clientes o de Envíos por Entregar.
- Datos nuevos en la respuesta de Registrar Envío.
- Acortar `idEnvio` o `idUsuario`.
- Un envío o una entrega reales en la demo.

## Pruebas

- Salida y entrada del número: `31`, `INT00000031` y el largo son el mismo cliente; `0` sale como `0`; `0031` y `99`
  son `CNE`; dos clientes con el mismo número salen con la `INT` y el número es `CNE`; el Codigo no es el `idCliente`.
- `cyp_send` con el número; `OPD` con la otra forma; `MCL` con dos formas del mismo cliente; `recs` con números.
- `cyp_pend` con `idDestinatario`, con `Texto` y `idDestinatario` juntos, por la cédula, y `CNE`.
- La repetición de `pay` vuelve a armar el registro.
- `taken`: un `id` de solo cifras salta ese número.
- Suite del servidor, tipos, compilación pública y arranque real con PostgreSQL.
- Después de publicar, en la demo con `cob` y solo leyendo: 45 clientes con `idCliente` numérico sin repetir; Datos del
  Cliente por el número y por la `INT`; `cyp_pend` con `idDestinatario`.
