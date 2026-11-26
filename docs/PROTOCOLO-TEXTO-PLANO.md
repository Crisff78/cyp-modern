# Protocolo de texto plano para la aplicación móvil (CYP 0.9)

Once peticiones `/cyp_*` que responden en texto plano, separadas por `|`, para que una aplicación móvil hecha por
otro equipo haga Envíos de Dinero contra CyP y los entregue. Orden de Rardiel del 2026-11-19: «Programalo y deja todo
listo».

- **El contrato** es [`protocolo-cyp/Protocolo CYP 0.9.txt`](<protocolo-cyp/Protocolo CYP 0.9.txt>): es el documento
  que se le envía a quien programa la aplicación. Si el servidor y ese documento no coinciden, hay un fallo: se
  arregla el servidor o se envía una versión nueva del documento, nunca se deja pasar. El documento describe solo
  lo que existe hoy: no cuenta lo que se cambió o se quitó. Lo nuevo desde la última versión que tiene esa persona
  (hoy, la 0.7: Rardiel dijo el 2026-11-25 «Yo le llegué a mandar el 0.7») va marcado con `(NUEVO)` y resumido en «Lo
  nuevo de esta versión». El historial por versión está en git y en los planes de `designs/`.
- **El plan** y su revisión están en `designs/2026-11-19-protocolo-texto-plano/`. La versión 0.2 (GET en todas las
  peticiones y `Vence`), en `designs/2026-11-20-protocolo-get-y-vence/`; la 0.3 (sin código de invitación), en
  `designs/2026-11-20-sin-invitacion/`; la 0.4 (`p=` y la versión de la aplicación), en
  `designs/2026-11-20-protocolo-p-y-version/`; el documento 0.4 limpio, con lo nuevo marcado, en
  `designs/2026-11-23-protocolo-04-limpio/`; la 0.5 (`idSesion` de 32 caracteres), en
  `designs/2026-11-23-sesion-corta/`; la 0.6 (teléfono y dirección en el listado e `idCliente` corto), en
  `designs/2026-11-24-clientes-telefono-id-corto/`; la 0.7 (entregar un envío: `pend` y `pay`), en
  `designs/2026-11-25-protocolo-entregar/`; la 0.8 (el `idCliente` como número e `idDestinatario` en `pend`), en
  `designs/2026-11-26-id-cliente-numero/`; y la 0.9 (búsqueda exacta, Monedas y Tasas), en
  `designs/2026-11-26-tasas-y-busqueda/`. No consta que la 0.8 se le mandara: la 0.9 marca con `(NUEVO)` todo lo
  nuevo desde la 0.7.

## Dónde está cada cosa

| Archivo | Qué hace |
| --- | --- |
| `app/server/src/text-protocol.ts` | Leer una petición, escribir una respuesta, los códigos y sus mensajes. Sin Fastify. |
| `app/server/src/text-protocol-routes.ts` | Las once peticiones. Cada una llama a la misma lógica de la API JSON. |
| `app/server/src/remittance-delivery-search.ts` | Los envíos pendientes que una cuenta puede entregar, con su búsqueda (`pend`). |
| `app/server/src/text-protocol-session.ts` | El `idSesion` de 32 caracteres: cifrar y descifrar el id de la sesión. |
| `app/server/src/app.ts` | `authenticate` y `signIn`, que usan por igual la web y el protocolo. |
| `app/server/test/text-protocol*.test.ts` | Cada ejemplo del documento y cada código de error. |

No hay reglas del negocio nuevas ni migración. Lo propio del protocolo es su `idCliente` (ver «Clientes») y, al entregar, el orden de las comprobaciones y el `idOperacion` (ver «Entregar»). El protocolo no aparece en `openapi.json` porque no es JSON.

## Cómo funciona

- **Rutas.** `POST|GET /cyp_login` (con su límite de 10 por minuto) y `POST|GET /cyp_:cmd` para lo demás. Un comando
  que no existe responde `PNE`. Viven en un complemento encapsulado de Fastify con su propio manejador de errores:
  todo sale con HTTP 200, `text/plain; charset=utf-8`, en una línea y sin salto final. El cuerpo de un POST se toma
  tal cual, venga con el `Content-Type` que venga.
- **GET o POST.** Desde la 0.2 todas las peticiones llegan por GET (los parámetros después del `?`, decodificados
  enteros y después partidos por `|`) o por POST. Una dirección de más de 8000 caracteres responde `PIN`
  (`MAX_ADDRESS_LENGTH`): más larga, Node o el proxy la rechazarían sin el formato del protocolo. **Excepción:**
  fuera del modo demo, Iniciar Sesión sigue siendo solo por POST (`passwordByGet`; ver «Antes de producción»).
- **`p=` y la versión de la aplicación (0.4).** La aplicación de la otra parte llama `…/cyp_login?p=Usuario|Clave|3.0`.
  `rawParameters` quita un `p=` literal y en minúscula justo después del `?` (solo en GET; un cuerpo que empiece
  por `p=` responde `PIN`). `withoutVersion` quita el último dato si tiene forma de versión
  (`/^\d{1,3}(\.\d{1,3}){1,2}$/`) **y** la petición ya tiene sus datos obligatorios (`REQUIRED`): así un importe
  al final (`100.00`) sigue siendo el importe y en `send` solo puede ser el dato 17. La central no usa la versión.
  En `login`, `Usuario|Clave|3.0` se lee de dos maneras (la clave con y sin el último dato) y entra con la que valga;
  solo se prueba la segunda si la primera dio `INVALID_CREDENTIALS`. Lo que eso cuesta, a sabiendas: un `Texto`
  que sea solo un número con punto y vaya el último se toma por la versión; `Modo`, `Pagina`, `Lado` o `idEstado`
  escritos `2.0` al final dejan de ser `PIN` y se toman por la versión; con 15 datos y la versión, `send` guarda la
  versión como `Nota`; y una `Nota` con un pipe sin limpiar que termine en `|2.5` pierde ese final.
- **`Vence`.** El inicio de sesión devuelve cuándo se vence la sesión: el final de su registro (`expiresAt`). No hay
  otro «8 horas» escrito en el protocolo.
- **Sesión.** Desde la 0.5, `idSesion` son 32 caracteres hexadecimales en mayúsculas: el `id` de su fila de
  `auth_sessions`, cifrado en un bloque AES-256 (`text-protocol-session.ts`). Ese `id` se ve en Administración y en las
  trazas, así que por sí solo no abre nada. La clave sale de `JWT_SECRET` y de `authVersion`: cambiar `JWT_SECRET`,
  `ADMIN_EMAIL` o `ADMIN_PASSWORD` cierra todas las sesiones del protocolo (`SNE`). Cada petición lo descifra, lee la
  fila y rehace la identidad con la `credentialVersion` actual; por eso `rotateCredentials` sube la versión y revoca
  las sesiones en un solo paso. Los `idSesion` largos de antes siguen valiendo hasta vencer. Cerrar Sesión solo
  comprueba la fila; las demás peticiones pasan por `authenticate`, la comprobación de toda petición de la web, con
  una ruta equivalente para los permisos: `POST /api/envios` para `clients`, `client`, `quote` y `send` (es `PuedeEnviar`) y `GET /api/envios`
  para `recs` (es `PuedeVerEnvios`); desde la 0.7, `GET /api/envios/recibos` para `pend` y `POST /api/envios/x/pagar`
  para `pay` (es `PuedeEntregar`). Después pide el permiso también por su nombre (`remittances.create`,
  `remittances.view`, `remittances.receipts` o `remittances.pay`; la tabla `ACCESS`), para que un cambio en la tabla de
  rutas de `access.ts` nunca deje abiertas estas peticiones. Desde la 0.9, `rates` pide lo mismo que Cotizar (la web ya le
  enseña a un Cajero las tasas vigentes en el resumen de remesas; `remittances.rates.view` es para la ventana que las
  registra y las lista todas), y `currencies` vale con cualquiera de `PuedeEnviar`, `PuedeVerEnvios` o `PuedeEntregar`
  (`CURRENCY_ACCESS`).
- **Un `idSesion` no sirve en la API JSON.** Puede viajar en una dirección (GET) y acabar en un registro. El corto no
  es un token, y `jwtVerify` lo rechaza con 401; a los largos de antes los rechaza el `preHandler` porque llevan
  `channel`. Al revés sí: un token de la web sirve en el protocolo.
- **Clientes (0.6 y 0.8).** El `idCliente` del protocolo es, desde la 0.8, el número de la identificación interna del
  cliente, como texto y sin ceros delante: `INT00000031` es `31` (lo pidió la otra parte el 2026-11-26: trabajan con un
  ID de cliente entero). La identificación interna la recibe todo cliente creado en la web; solo la genera la central,
  con una secuencia única y 8 cifras (`reserveClientIdentity`), y no cambia: en PostgreSQL la unicidad del texto la
  garantiza la migración 029. Por eso el número es único y siempre es un número para quien la tiene. `clientIds` arma
  una vez por petición el `idCliente` de **todos** los clientes; solo si dos tuvieran el mismo número (datos que hoy no
  pueden existir) sale la identificación interna entera. Un cliente sin ella conserva su `id`. `clientOf` resuelve lo
  que manda la aplicación: un número escrito como sale (sin ceros delante) es el único cliente con ese número; `INT` y
  cifras, por identificación interna; lo demás, por `id` (el `INT…` de la 0.6 y el largo de antes siguen entrando).
  Ninguna identificación interna nueva repite el `id` de un cliente ni tiene por número el `id` de uno (`taken`).
  Ningún camino crea clientes con un `id` de solo cifras. `MCL` se decide después
  del `idOperacion` y con los clientes ya resueltos. El Dato de `CNE`, `CIN` y `CFR` es el texto que llegó. La huella
  del `idOperacion` no se toca: repetir un envío con la otra forma del id es `OPD`. El Listado de Clientes trae además
  el teléfono que enseña la web (`phone || cellular`) y la dirección: lo pidió la otra parte el 2026-11-24. La búsqueda
  de la web sigue devolviendo solo ids. **En la demo pública**, cada arranque da identificación interna a los clientes
  que no la tengan (`assignMissingClientIdentities`), para que todos salgan con el número. Ojo: en la web, el
  formulario de clientes llama a la identificación interna «Identificación interna» y, al crear un cliente sin cédula,
  la copia en la cédula (`App.tsx`): la Identificacion de ese cliente puede valer `INT00000031`. En la demo no hay
  ninguno (2026-11-26).
- **`idOperacion`.** Se guarda en la tabla `idempotency` con la clave `cyp:{idUsuario}:{idOperacion}`. La huella es
  el SHA-256 de los parámetros ya decodificados, sin el `idSesion` ni la versión de la aplicación, carácter por carácter (lo mismo por GET que por POST, con `p=` o sin él). Misma huella: se devuelve el envío guardado, aunque
  haya cambiado una tasa o esté cerrada la caja. Otra huella: `OPD` con el `NumEnvio`. Solo se guarda cuando el envío
  se registró. No caduca. **El documento promete 7 días como mínimo:** si algún día se depura la tabla `idempotency`,
  las filas `cyp:` de menos de 7 días no se tocan. (La clave supone que ninguna cuenta tiene el id literal `cyp`.)
- **Entregar (0.7).** `pend` lista los envíos pendientes que la cuenta ve en Entregas de dinero (`canSeeReceipt`), de
  cualquier fecha, con búsqueda sobre la copia de los contactos guardada en el envío (`remittance-delivery-search.ts`).
  `pay` es un adaptador delante de `payRemittance`, la función de `POST /api/envios/:id/pagar`, con tres cosas suyas:
  (1) nombra el envío por su `NumEnvio` (`envio_reference`, única) y no por el `idEnvio`; (2) compara el
  `MontoARecibir` que manda la aplicación con `payoutOf` y responde `MNC` si no es el del envío; (3) lleva
  `idOperacion`, en la misma tabla y con la misma clave que `send`, con la huella precedida de `pay`: la misma petición
  repetida devuelve la respuesta guardada sin tocar la caja, y otro `idOperacion` sobre un envío ya entregado es `ENP`.
  `ENE` solo cuando el envío no existe o la cuenta no lo vería ni pendiente (`deliverableByReference`): así un Cajero
  que intenta entregar lo que otro ya entregó recibe `ENP` y no «no existe». **Orden:** sesión → permiso (`SPE`) →
  datos (`PIN`) → `idOperacion` (`OK` u `OPD`) → `ENE` → `MNC` → `ENP` → `CFR` → `CNA` → `CSF`. La caja es la de quien
  entrega **en la moneda de destino**, abierta ese día y con fondos. El registro de un envío (el de `recs`, `pend` y
  `pay`) gana el dato 20: la identificación del destinatario guardada en el envío. Una entrega deja traza (`/cyp_pay`)
  y su evento `paid`; una repetición respondida con la respuesta guardada no deja nada.
- **Importes.** El texto `1500.00` es `150000` centavos. El servidor vuelve a cotizar al registrar y compara
  `TotalAPagar` y `MontoARecibir` con lo que mandó la aplicación; si no coinciden, `CCA`.
- **Orden de los errores al registrar:** datos mal escritos (`PIN`) → `idOperacion` ya usada → mismo cliente (`MCL`)
  → remitente (`CNE`, `CIN`, `CFR`) → destinatario (`CNE`, `CIN`) → tasa o monto (`TNE`, `MIN`) → cotización
  cambiada (`CCA`) → pago (`EIS`, `PNV`) → caja (`CNA`).
- **Lo que escribe el usuario** (`Texto`, `Referencia`, `Banco`, `Nota`): los caracteres de control y las marcas
  invisibles se cambian por un espacio antes de validar. Un salto de línea en cualquier parámetro es `PIN`.
- **Límites.** 120 peticiones por minuto y dirección, como toda la API. `/cyp_login` tiene su contador de 10, aparte
  del de `/api/auth/login`: entre las dos rutas son 20 peticiones de clave por minuto y dirección (hasta 30
  comprobaciones, porque un inicio de sesión con versión al final puede probar dos lecturas de la clave).

## La demo pública

Desde el 2026-11-20 la demo no pide código de invitación (orden de Rardiel; ver `DEMO-PUBLICA.md`). Hasta la versión
0.2 lo pedía en una cookie y, para las rutas `/cyp_*`, en la cabecera `X-CyP-Invitacion`. Una aplicación que siga
mandando esa cabecera no nota nada: no se mira. Las peticiones se protegen como en cualquier instalación: con el
inicio de sesión, sus 10 intentos por minuto y el límite general.

Una aplicación que corra dentro de un navegador o un WebView no podría leer las respuestas: CORS solo admite los
orígenes de CyP. El protocolo está pensado para una aplicación nativa.

## Códigos

| Lo que pasa en CyP | Código |
| --- | --- |
| `idSesion` que no se puede abrir o sin su fila; token que no se puede verificar | `SNE` |
| Token vencido, `SESSION_EXPIRED` | `SNA` |
| `INVALID_CREDENTIALS`; `ACCESS_REVOKED` al iniciar sesión | `UCI` |
| `COLLECTOR_INACTIVE`, `OPERATOR_INACTIVE` | `CBI` |
| `FORBIDDEN`, `PERMISSION_REQUIRED`, `ACCESS_REVOKED`, `OPERATOR_FORBIDDEN` | `SPE` |
| Parámetro que falta, sobra o está mal escrito; `MONEY_RANGE`, `INVALID_PAYMENT`; petición demasiado grande o que no se puede leer | `PIN` |
| Límite de peticiones (HTTP 429) | `DML` |
| Comando que no existe | `PNE` |
| `CLIENT_NOT_FOUND`; listado de clientes vacío | `CNE` |
| `CLIENT_INACTIVE` | `CIN` |
| Remitente fuera de la ruta del Cobrador; al entregar, el destinatario | `CFR` |
| `SAME_CLIENT` | `MCL` |
| `RATE_MISSING`; en `rates`, la moneda pedida no tiene tasa vigente | `TNE` |
| `AMOUNT_TOO_SMALL`, `INVALID_AMOUNT`; monto `0.00` | `MIN` |
| `QUOTE_CHANGED`; los importes no coinciden con la cotización | `CCA` |
| `CASH_NOT_OPEN` | `CNA` |
| `INSUFFICIENT_TENDERED` | `EIS` |
| `PAYMENT_NOT_VERIFIED` | `PNV` |
| Misma `idOperacion` con otros datos | `OPD` |
| Listado de recibos vacío; ningún envío por entregar | `RNE` |
| `TRANSFER_NOT_FOUND`; al entregar, el envío no existe o la cuenta no lo vería ni pendiente | `ENE` |
| `TRANSFER_NOT_PENDING`; al entregar, el envío ya está entregado o cancelado | `ENP` |
| Al entregar, el `MontoARecibir` no es el del envío | `MNC` |
| `INSUFFICIENT_CASH` | `CSF` |
| Otra regla del negocio sin código propio (por ejemplo, de configuración) | `ORC`, con su mensaje |
| Cualquier otro fallo | `EIC`, con la referencia de soporte; la causa queda en el registro del servidor |

Una regla sin código propio va en `ORC` y no en `EIC` a propósito: `EIC` le dice a la aplicación que repita la
petición, y repetir no arregla una configuración. El Dato de un `PIN` es el nombre del parámetro, o `Parametros`
cuando lo que está mal es la petición entera.

## Lo que se sabe de la aplicación de la otra parte

Visto en una captura suya del 2026-11-20 y comprobado contra un servidor local, byte a byte:

- Llama por GET, con `p=` delante y un `3.0` al final, y el `|` sin codificar (pasa por Render sin problema).
- No se sabe qué es el `3.0` ni si lo manda en todas las peticiones; la central sirve en los dos casos.
- Su ejemplo (LSAN) dice que las respuestas son `Estado|FechayHora|Versión|Otros Datos`, pero ninguno de sus
  ejemplos trae la Versión, y las de CyP tampoco. **Si su aplicación lee mal el `idSesion`, es lo primero que hay
  que mirar:** puede estar esperando una Versión en el tercer lugar.
- Una letra con acento o un espacio **sin codificar** en la dirección no llegan al protocolo: Node responde 400.
  `%ED` (una í en Latin-1) responde `PIN`: los datos van en UTF-8. `+` es un signo de más, no un espacio.
  Comprobado también en la demo el 2026-11-23, con una sesión que no existe y la dirección escrita byte a byte: con
  el acento o el espacio sin codificar llega un 400 sin cuerpo (no llega al servidor de CyP); codificados, la
  petición llega (`SNE`). Por eso el documento dice que un 400 no se repite tal cual.
- El 2026-11-24 pidió el teléfono y la dirección en el Listado de Clientes y un `idCliente` más corto (0.6). El
  `idEnvio` y el `idUsuario` pueden seguir teniendo 36 caracteres: no los ha pedido y ninguna petición los recibe. Si
  algún día hay una petición sobre un envío, que use el `NumEnvio` (11 caracteres): así lo hace `pay`. Acortar el
  `idEnvio` más adelante dejaría las repeticiones ya guardadas con la forma vieja.
- El 2026-11-25 Rardiel contó que la otra parte, mientras prueba, pide «lo del procesamiento de pago vía url» para
  cuando llegue a ese punto; preguntado a cuál de los dos pagos que el contrato dejaba fuera se refería, Rardiel
  eligió «Pagarle al destinatario» (0.7). La otra parte no dio formato para esa petición: el de `pend` y `pay` lo puso
  CyP, y puede que pida cambios cuando lo vea.
- El 2026-11-26 Rardiel mandó un audio de la otra parte («Me dijeron esto»; transcrito por máquina en la laptop, no
  en este repositorio): trabajan con un ID de cliente entero y es lo que quieren mandar en las transacciones, no la
  identificación; y al mandar la identificación les llegan varios registros. Lo comprobado en la demo: en `cyp_clients`
  una cédula da siempre un cliente; en `cyp_pend`, la cédula de un destinatario da un registro por envío (en la demo,
  los 52 pendientes eran de 6 destinatarios). De ahí la 0.8: el `idCliente` como número e `idDestinatario` en `pend`.
  Después llegaron dos fotos suyas: la búsqueda era `cyp_clients` con `Texto` `0000` (de antes de la 0.8), y traía a
  todos porque `0000` está dentro de cada `INT000000xx`, que entraba en la búsqueda por trozos. De ahí la 0.9.
- **Entregar con el `idCliente` (0.8).** `cyp_pend` acepta un cuarto dato, `idDestinatario`, resuelto con `clientOf`:
  solo los envíos pendientes a ese cliente, y se combina con `Texto`; si no es de nadie, `CNE`. La repetición de `pay`
  (mismo `idOperacion` y datos) vuelve a armar el registro del envío, que no cambia, para que traiga el `idCliente` de
  hoy y no el texto guardado la primera vez.
- **Búsqueda exacta (0.9).** El Listado de Clientes del protocolo ya no usa la búsqueda de la web: `listRemittanceClients`
  con `protocolMatch` encuentra el cliente cuyo `idCliente` es el texto (resuelto con `clientOf`), cuyo código o cuya
  cédula (sin guiones) es el texto, o cuyo teléfono termina en él (7 cifras o más, `phoneEnds`); solo un texto con letras
  busca por trozos, en el nombre y el código. Envíos por Entregar (`pendingDeliveries`) sigue la misma regla con los
  números del envío y los datos del destinatario. **La búsqueda de la web no cambia**: con el mismo texto puede traer
  otros clientes (con `0000` sigue trayendo a todos).
- **Monedas y Tasas (0.9).** Las pidió la otra parte el 2026-11-26, separadas. `currencies` da las tres monedas con los
  nombres de `collector-assignments.ts`. `rates` sale de `ratesInForce` (`remittances.ts`), que usa `effectiveRate` con
  el día de negocio de Cotizar: lo que enseña es lo que usa Cotizar. Trae compra, venta, el día de la tasa (puede ser
  anterior) y cuándo se cambió; el peso, siempre. Con `idMoneda` y sin tasa, `TNE` con la moneda en el Dato. Las tasas
  son para mostrar: los importes salen de Cotizar.

## Antes de producción

Hoy esto solo corre en la central de pruebas, con datos ficticios. Antes de ponerlo con datos reales hay que decidir:

- **La clave por GET.** En un GET la clave viaja en la dirección. El servidor de CyP no escribe direcciones en ningún
  sitio (`Fastify({ logger: false })`, y las trazas guardan la ruta, no la dirección), pero el proxy de la plataforma
  y la red del usuario sí pueden guardarlas. Por eso `passwordByGet` es verdadero solo en modo demo. Según lo que
  responda la otra parte a la pregunta 4a del documento, las salidas son tres: que manden Iniciar Sesión por POST;
  que manden la clave en una cabecera; o aceptar la clave por GET sabiendo
  dónde queda. Es una decisión de Rardiel, no del código. Hay que tomarla antes de una central real: la aplicación
  de la otra parte entra por GET, y fuera del modo demo eso responde `PIN`.
- **Teléfonos y direcciones en el listado.** Desde la 0.6 el Listado de Clientes trae el teléfono y la dirección de
  hasta 100 clientes por petición; un Cobrador, con `Lado` 1, los de clientes de otras rutas. Los mismos usuarios ya
  podían pedirlos uno a uno, pero así se sacan cien veces más rápido, y en la web un Cajero no ve ninguna lista de
  clientes con esos datos. Antes de una central real hay que decidir si se queda así; una salida barata es dejarlos
  vacíos para un Cobrador cuando el cliente no es de su ruta.
- **Clientes sin identificación interna.** Desde la 0.8 el contrato dice que el `idCliente` es un número. Fuera de la
  demo, un cliente importado o anterior a la migración 029 saldría con su `id` de siempre, que puede ser largo y no ser
  un número: **antes de una central real hay que darles identificación interna a todos** (como hace la demo con
  `assignMissingClientIdentities`). Y si alguna vez se importan clientes, que la identificación interna la siga dando la
  central: dos con el mismo número (`INT00000031` e `INT000000031`) saldrían con la `INT` entera.
- **Cédulas repetidas.** La base no impide que dos clientes tengan la misma cédula y el alta de la web no lo comprueba
  (solo el alta desde un envío). Con datos reales, buscar por una cédula puede traer varios clientes.
- **El `idSesion` en una dirección.** Vale 8 horas y no sirve en la API JSON, pero quien lo tenga puede registrar
  envíos con esa cuenta. Si se filtra uno, se cierra con `/cyp_logout?idSesion`. Antes de una central real hay que
  decidir si Registrar Envío queda solo por POST, si la sesión dura menos o vence por inactividad, y si el protocolo
  deja de aceptar tokens de la web (uno filtrado en una dirección abre toda la API).

- **Entregar por GET.** `pay` saca dinero de una caja, y la dirección de un GET queda en registros ajenos. No puede
  entregar dos veces, pero quien tenga un `idSesion` vivo puede dar por entregados los envíos pendientes que esa cuenta
  ve (un Cajero, todos los de la empresa), mientras su caja esté abierta y con fondos. No se lleva efectivo: inutiliza
  envíos y descuadra cajas. `MNC` no lo frena, porque `pend` da el `NumEnvio` y el importe. Dejar `pay` solo por POST
  tampoco lo cierra (el `idSesion` se filtra igual por el GET de un listado): la salida es sacar el `idSesion` de las
  direcciones o acortar la sesión, lo mismo que para Registrar Envío. `pay` no tiene límite propio: comparte el de 120
  por minuto.
- **La caja de quien entrega.** El protocolo no abre ni cierra cajas. Para entregar hace falta la de ese día en la
  moneda de destino, con fondos; si quien entrega no la tiene, toda entrega responde `CNA` o `CSF`. Hay que decidir
  quién se la abre cada día a los usuarios de la aplicación (en la web la abre Administración; un Cajero, la suya).
- **Lo que no hay.** La aplicación no puede ver lo que el usuario ya entregó (solo la respuesta de cada entrega), ni
  saber antes del error si la caja está abierta y con fondos, ni imprimir el recibo de quien recibe. Una entrega no se
  deshace (la central no tiene «anular una entrega»), y la central no guarda qué documento enseñó quien recibió. Si
  entre una página y otra de `pend` se entrega un envío, la página siguiente se salta una fila.

## Para probarlo a mano

Con el servidor local en modo demo (`pnpm dev`):

```bash
curl -s -X POST http://127.0.0.1:3001/cyp_login -H "Content-Type: text/plain; charset=utf-8" --data-binary "USUARIO|CLAVE"
```

En modo demo también vale por GET: `curl -s "http://127.0.0.1:3001/cyp_login?USUARIO|CLAVE"` (la clave, codificada
con `%`). La respuesta trae el `idSesion` en el tercer dato y `Vence` en el quinto. Con el `idSesion`:

```bash
curl -s "http://127.0.0.1:3001/cyp_quote?ID_SESION|USD|DOP|100.00"
```

Para registrar un envío, ese usuario tiene que tener abierta su Caja de Remesas de hoy en la moneda de origen. Para
entregarlo (`/cyp_pend?ID_SESION` y `/cyp_pay?ID_SESION|ID_OPERACION|ENV00000001|5806.50`), la de la moneda de destino.
