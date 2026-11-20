# Protocolo de texto plano para la aplicación móvil (CYP 0.1)

Autor: Claude Code (Fable 5.2). Revisión EGM, etapa 1 (tres revisores; hallazgos resueltos, ver
`goldfish_review_report.md`). Base: `main` `510e2fb`. Fecha: 2026-11-19.

Orden de Rardiel del 2026-11-19: «Programalo y deja todo listo, y los textos con los mensajes que debo mandar».
El contrato es `docs/protocolo-cyp/Protocolo CYP 0.1.txt`: la copia del documento que se envía a la persona que
programa la aplicación móvil. Este plan dice cómo se programa ese contrato.

## 1. Qué se construye

Siete peticiones de texto plano delante de la lógica que ya existe. La API JSON no cambia de comportamiento, salvo
que no acepta los tokens que da el protocolo (punto 4).

| Petición | Método | Equivale a |
| --- | --- | --- |
| `/cyp_login` | solo POST | `POST /api/auth/login` |
| `/cyp_logout` | GET o POST | `POST /api/auth/logout` |
| `/cyp_clients` | GET o POST | búsqueda de clientes de envíos, con páginas |
| `/cyp_client` | GET o POST | `GET /api/envios/clientes/:id/contacto` |
| `/cyp_quote` | GET o POST | `GET /api/envios/cotizacion` |
| `/cyp_send` | solo POST | `POST /api/envios` |
| `/cyp_recs` | GET o POST | `GET /api/envios` (envíos visibles), con filtros y páginas |

Sin migración: la repetición por `idOperacion` usa la tabla `idempotency` que ya existe.

## 2. Archivos

| Archivo | Qué |
| --- | --- |
| `app/server/src/text-protocol.ts` | **Crear.** Sin Fastify: partir parámetros, importes, fechas, páginas, limpiar separadores, FechayHora, `ProtocolError`, los mensajes y la traducción de errores a códigos. |
| `app/server/src/text-protocol-routes.ts` | **Crear.** `registerTextProtocol(app, deps)` con las rutas y las siete peticiones. |
| `app/server/src/app.ts` | **Modificar.** (1) El cuerpo del `preHandler` posterior a `req.jwtVerify()` pasa a `authenticate(claims, method, path)`; el `preHandler` la llama. (2) El cuerpo de `POST /api/auth/login` pasa a `signIn(login, password, channel?)`. (3) El `preHandler` deja pasar las rutas del protocolo (por `req.routeOptions.url`) y rechaza con 401 los tokens que llevan `channel`. (4) `systemOperators` pasa a una constante compartida y se registra el protocolo, después de todos los ganchos. (5) `registerDemoAccess` recibe `clientAddress`. |
| `app/server/src/remittance-client-search.ts` | **Modificar.** El filtro pasa a `matchingClients`; `searchRemittanceClients` devuelve lo mismo que antes; `listRemittanceClients` nueva (los mismos clientes ordenados; sin texto, todos los que el usuario puede elegir para ese lado). |
| `app/server/src/demo-access.ts` | **Modificar.** La invitación en una cabecera para `/cyp_*` (punto 6). |
| `app/server/test/text-protocol-format.test.ts` | **Crear.** Unidades de `text-protocol.ts`. |
| `app/server/test/text-protocol.test.ts` | **Crear.** Las siete peticiones con `app.inject`. |
| `docs/protocolo-cyp/Protocolo CYP 0.1.txt` | **Crear.** El contrato, tal como se envía. Respecto al borrador anterior a programar: ya no dice «todavía no está programado»; sección «Central de pruebas»; código `ORC`; qué trae el Dato de `PIN`; tope de 3 reintentos con `EIC`; tres aclaraciones (búsqueda, permisos especiales, no buscar con cada letra). |
| `docs/PROTOCOLO-TEXTO-PLANO.md` | **Crear.** Para quien mantenga CyP. |
| `docs/DEMO-PUBLICA.md` | **Modificar.** La cabecera de invitación. |

`remittances.ts` no se toca: la comprobación de la ruta del Cobrador reutiliza `remittanceClientContact`.

## 3. Fases

Cada una deja el árbol compilando y con sus pruebas en verde.

1. `text-protocol.ts` y sus pruebas de formato.
2. `authenticate` y `signIn` extraídas en `app.ts`, con la suite del servidor entera en verde (prueba de que la API
   JSON no cambió).
3. `listRemittanceClients` y las peticiones de lectura (`login`, `logout`, `clients`, `client`, `quote`, `recs`).
4. `cyp_send` con su `idOperacion`.
5. La puerta de la demo pública.
6. Documentos, plan al día y los dos PR.

## 4. Rutas, transporte y sesión

- Un complemento encapsulado de Fastify (`app.register(async scope => …)`), registrado después de los ganchos de la
  raíz (el ámbito los copia al cargarse), con:
  - un gancho `onRequest` que fija `content-type: text/plain` en todo POST, `removeAllContentTypeParsers()` y un
    analizador `*` de texto: el cuerpo llega tal cual venga la cabecera `Content-Type`, también si falta o no es
    válida. El límite de 65 536 bytes sigue valiendo;
  - `setErrorHandler` propio: todo error de estas rutas, también los de los ganchos heredados (429 del límite, 413,
    400 y 415), sale como `ER|FechayHora|Código|Mensaje|Dato`, HTTP 200, `text/plain; charset=utf-8`, sin salto final;
  - `POST|GET /cyp_login`, ruta propia con `config.rateLimit` de 10 por minuto (contador aparte del de
    `/api/auth/login`: entre las dos rutas son 20 intentos por minuto y dirección; se acepta);
  - `POST|GET /cyp_:cmd` para lo demás. Las dos rutas con `exposeHeadRoute: false`. Un `cmd` desconocido responde
    `PNE`; en la demo pública esto evita además que `GET /cyp_loquesea` devuelva la página de Administración.
- «Siempre HTTP 200» vale para las rutas resueltas. Otro método, `/cyp_x/y` o una dirección mal formada responden lo
  que ya respondía el servidor (401, 404, 400); el contrato lo trata como fallo de comunicación.
- **Parámetros.** GET: lo que sigue al primer `?` de `req.url`, entero, pasa por `decodeURIComponent` (si falla,
  `PIN`) y después se parte por `|`; `+` no es espacio. POST: el cuerpo, sin decodificar; la consulta no se mira.
- Un salto de línea en cualquier parámetro, también en el `idSesion`, responde `PIN` con el nombre del parámetro
  **antes** de mirar la sesión (el fallo típico es un salto al final del cuerpo). En `cyp_login` el Dato es `Clave`.
- Los datos que escribe el usuario (`Texto`, `Referencia`, `Banco`, `Nota`) pasan por `typedText`: los caracteres de
  control y las marcas invisibles se cambian por un espacio antes de medir y validar. La huella del `idOperacion` se
  calcula sobre el cuerpo crudo.
- Respuesta: cada dato pasa por `clean()`, que cambia `| ! ; @`, los caracteres de control y los separadores de
  línea por un espacio. También el Mensaje y el Dato de un error.
- **Sesión.** `idSesion` es un token de sesión como el de la web (8 h), firmado con `channel: "cyp"`. El
  `preHandler` de la API JSON rechaza con 401 todo token que lleve `channel`: un `idSesion` puede viajar en una
  dirección, y uno filtrado solo abre las siete peticiones. Un token de la web sí sirve en el protocolo.
- En cada petición con `idSesion`: vacío → `PIN` (Dato `idSesion`); `app.jwt.verify` falla → `SNA` si el error es
  `FAST_JWT_EXPIRED`, `SNE` en lo demás; después `authenticate(claims, método, ruta equivalente)`, que es la
  comprobación de toda petición de la web, y además `requireRemittancePermission` con el permiso por su nombre.
  - `clients`, `client`, `quote`, `send` → `POST /api/envios` y `remittances.create` (es `PuedeEnviar`).
  - `recs` → `GET /api/envios` y `remittances.view` (es `PuedeVerEnvios`).
  - `logout` no pasa por `authenticate`: verifica el token y cierra la sesión con `endOwnAuthSession` en una
    transacción, con traza `/cyp_logout`. Solo puede responder `SNE` o `SNA`.
- `cyp_login`: `signIn` y, con el token recién firmado (lleva `authVersion` y `sid`), `authenticate` para las dos
  rutas equivalentes; un `DomainError` cuenta como 0 y cualquier otro error se propaga.
- Orden: límite (gancho) → comando conocido (`PNE`) → método (`PIN`) → una sola línea (`PIN`) → `idSesion` presente
  (`PIN`) → sesión y permisos (`SNE`, `SNA`, `CBI`, `SPE`) → parámetros (`PIN`) → reglas.

## 5. Peticiones

Validación común: identificadores con `boundedId`; importes `^\d{1,13}\.\d{2}$`; monedas exactamente `DOP`, `USD` o
`EUR`; páginas de 1 a 999 999 999 (una página que ya no existe es una lista vacía). `Monto` `0.00` responde `MIN`.
Dato de `PIN`: el nombre del parámetro, o `Parametros` si es la petición entera (datos de más o de menos, demasiado
grande, `%` que no se decodifica, GET en una que es solo POST).

- **cyp_login.** Cuerpo partido solo por el primer `|`. `loginBody.safeParse`; si falla, `PIN` con `Usuario` o
  `Clave`. `INVALID_CREDENTIALS` → `UCI`; `COLLECTOR_INACTIVE` → `CBI`; `ACCESS_REVOKED` → `UCI` con mensaje propio
  (el contrato no da `SPE` al iniciar sesión). Respuesta: `OK|FechayHora|token|id;nombre;rol;PuedeEnviar;PuedeVerEnvios`.
- **cyp_logout.** `OK|FechayHora`.
- **cyp_clients** `idSesion[|Texto[|Pagina[|Lado]]]`. `listRemittanceClients`; orden por nombre (`Intl.Collator`
  en español, sin distinguir mayúsculas ni acentos), después código, después id; 100 por página. Sin clientes en la
  página: `CNE` con Dato vacío. Un Cobrador con Lado 0 solo recibe su ruta, también sin Texto.
- **cyp_client** `idSesion|idCliente[|Lado]`. `remittanceClientContact`; `CLIENT_NOT_FOUND` → `CNE`,
  `CLIENT_INACTIVE` → `CIN`, `FORBIDDEN` → `CFR`, los tres con el `idCliente` en el Dato. La moneda no viene en el
  contacto: es `preferredCurrency` de la ficha, o `DOP`.
- **cyp_quote** `idSesion|idMonedaOrigen|idMonedaDestino|Monto[|Modo]`. `quoteRemittance` con `amountMode`
  `source`, `total` o `destination`. Respuesta: principal, comisión, total, `calculation.payoutAmount`, el
  porcentaje con dos decimales fijos (500 → `5.00`), `calculation.deliveryCommissionAmount` y las dos tasas.
  `RATE_MISSING` → `TNE`; `AMOUNT_TOO_SMALL` e `INVALID_AMOUNT` → `MIN` (en Modo 2 un monto mínimo deja el principal
  en cero).
- **cyp_send**, los 16 datos siempre:
  1. `PIN`: exactamente 16 datos; `idOperacion` `^[A-Za-z0-9-]{8,64}$`; `Modo` `0`, `1` o `2`; `idForma_Pago` `1`,
     `3` o `4`; con Efectivo, `Referencia`, `Banco` y `Verificado` vacíos y `Recibido` vacío o importe; con
     Transferencia y Depósito, `Recibido` vacío, `Referencia` obligatoria, `Verificado` vacío, `0` o `1`; textos
     hasta 160, 160 y 2000.
  2. Dentro de `store.transaction`, como `mutate`: `assertAuthSession`, `currentAccessUser`, `authorizeRequest` y
     `requireRemittancePermission`.
  3. `idOperacion`: clave `cyp:{idUsuario}:{idOperacion}` en `state.idempotency`; huella = SHA-256 del cuerpo desde
     el primer `|`. Misma huella: `OK` con el texto guardado. Otra huella: `OPD` con el `NumEnvio`.
  4. Reglas: `MCL` → remitente (`CNE`, `CIN`, `CFR`) y destinatario (`CNE`, `CIN`) con `remittanceClientContact` →
     `quoteRemittance` (`TNE`, `MIN`) → `totalAmount` y `calculation.payoutAmount` iguales a `TotalAPagar` y
     `MontoARecibir` (si no, `CCA`) → `guardCatalogChanges` → `createRemittance` con el mismo `now`, el `quote`
     recién calculado, **`amount: cotización.amount`** (no el Monto) y `requestedTotalAmount` (Modo 1) o
     `requestedReceiveAmount` (Modo 2). De `createRemittance`: `QUOTE_CHANGED` → `CCA`, `INSUFFICIENT_TENDERED` →
     `EIS`, `PAYMENT_NOT_VERIFIED` → `PNV`, `CASH_NOT_OPEN` → `CNA`, `OPERATOR_FORBIDDEN` y `FORBIDDEN` → `SPE`,
     `OPERATOR_INACTIVE` → `CBI`.
  5. Pago: Efectivo `{ method: "cash", tenderedAmount? }`; Transferencia y Depósito `{ method, reference, bank?,
     verified: true }` solo si `Verificado` es `1`.
  6. Al registrar: `recordMutationTrace` con recurso `/cyp_send` y la fila de `idempotency` con
     `{ protocol, transferId, envioReference, envio }`; `envio` es el texto de los 10 campos.
- **cyp_recs** `idSesion[|FechaInicial[|FechaFinal[|idEstado[|Pagina]]]]`. Por defecto hoy y la misma inicial; final
  anterior o más de 31 días contando los dos extremos → `PIN` (Dato `FechaFinal`). Envíos con `canSeeOutgoing`,
  filtrados por `businessDate(new Date(createdAt))`, del más reciente al más antiguo, 100 por página. Vacío: `RNE`.
  Las fechas pasan por la misma función de la FechayHora (hora de República Dominicana; vacío si no hay). Teléfono:
  el del destinatario, o su celular. Total: `totalPaidForTransfer`. Recibe: `payoutOf`.

## 6. La demo pública pide invitación

En la demo pública, `demo-access.ts` corta en `onRequest` toda petición sin la cookie de invitación (401 JSON bajo
`/api/`, redirección en lo demás). Una aplicación móvil no tiene esa cookie.

La puerta se queda. Para las rutas `/cyp_*` la invitación se acepta también en la cabecera `X-CyP-Invitacion`,
comparada con `timingSafeEqual`. Sin ella o con una equivocada: `ER|FechayHora|PIN|…|X-CyP-Invitacion`, HTTP 200.

Ese gancho responde antes de que cuente el límite general, así que lleva su propia cuenta por dirección: tras 10
cabeceras equivocadas en un minuto no se mira ninguna, ni la correcta, y responde `DML`. Las peticiones sin cabecera
no cuentan. La cookie también vale. La cabecera no abre la API JSON ni las páginas. Fuera de la demo pública no hay
puerta y la cabecera no se mira. Es el mismo código de invitación de la web: cambiarlo corta a los dos.

## 7. Errores

`DomainError` → código: `SESSION_EXPIRED` `SNA`; `INVALID_CREDENTIALS` `UCI`; `COLLECTOR_INACTIVE` y
`OPERATOR_INACTIVE` `CBI`; `FORBIDDEN`, `PERMISSION_REQUIRED`, `ACCESS_REVOKED`, `OPERATOR_FORBIDDEN` `SPE`;
`CLIENT_NOT_FOUND` `CNE`; `CLIENT_INACTIVE` `CIN`; `SAME_CLIENT` `MCL`; `RATE_MISSING` `TNE`; `AMOUNT_TOO_SMALL` e
`INVALID_AMOUNT` `MIN`; `QUOTE_CHANGED` `CCA`; `CASH_NOT_OPEN` `CNA`; `INSUFFICIENT_TENDERED` `EIS`;
`PAYMENT_NOT_VERIFIED` `PNV`; `MONEY_RANGE` `PIN` (Dato `Monto`); `INVALID_PAYMENT` `PIN` (Dato `idForma_Pago`).

Cualquier otro `DomainError` → **`ORC`** (Operación Rechazada por la Central), con mensaje propio para los de
configuración y el del propio error en los demás. No va en `EIC` porque `EIC` le dice a la aplicación que repita, ni
en `PIN` porque ningún parámetro está mal. HTTP 429 → `DML`; 413, 400 y 415 → `PIN` (Dato `Parametros`). Lo que no
es un `DomainError` → `EIC` con la referencia de soporte; la causa queda en el registro del servidor y no sale.

Los mensajes son propios del protocolo, de usted, uno por código (`MESSAGES` en `text-protocol.ts`); los dos
ejemplos del contrato quedan iguales.

## 8. Pruebas

Con `MemoryStore`, `seed()` y `app.inject`: cada petición con su ejemplo del contrato y cada código; los tres modos
en `quote` y en `send`; repetición idéntica (también a la vez, con otra sesión, tras cambiar una tasa y con la caja
cerrada); `OPD`; páginas de más de 100 en clientes y recibos; día de República Dominicana en `recs`; permisos por
rol y por cuenta personalizada; Cobrador inactivo; `EIC` sin detalles internos; cualquier `Content-Type`; el token
del protocolo rechazado por la API JSON; la puerta de la demo con su bloqueo; y la suite entera del servidor.

No hay prueba con PostgreSQL: el protocolo no añade SQL y guarda con las mismas funciones que la API JSON, pero no
se ha ejecutado contra una base real.

## 9. Fuera de alcance

Tarjeta, alta de clientes, entregar, cancelar y abrir caja desde la aplicación. El protocolo no entra en
`openapi.json`. CORS no cambia: una aplicación que corra en un navegador o WebView no podría leer las respuestas.
