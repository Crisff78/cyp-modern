# Protocolo de texto plano para la aplicación móvil (CYP 0.4)

Siete peticiones `/cyp_*` que responden en texto plano, separadas por `|`, para que una aplicación móvil hecha por
otro equipo haga Envíos de Dinero contra CyP. Orden de Rardiel del 2026-11-19: «Programalo y deja todo listo».

- **El contrato** es [`protocolo-cyp/Protocolo CYP 0.4.txt`](<protocolo-cyp/Protocolo CYP 0.4.txt>): es el documento
  que se le envía a quien programa la aplicación. Si el servidor y ese documento no coinciden, hay un fallo: se
  arregla el servidor o se envía una versión nueva del documento, nunca se deja pasar.
- **El plan** y su revisión están en `designs/2026-11-19-protocolo-texto-plano/`. La versión 0.2 (GET en todas las
  peticiones y `Vence`), en `designs/2026-11-20-protocolo-get-y-vence/`; la 0.3 (sin código de invitación), en
  `designs/2026-11-20-sin-invitacion/`; la 0.4 (`p=` y la versión de la aplicación), en
  `designs/2026-11-20-protocolo-p-y-version/`.

## Dónde está cada cosa

| Archivo | Qué hace |
| --- | --- |
| `app/server/src/text-protocol.ts` | Leer una petición, escribir una respuesta, los códigos y sus mensajes. Sin Fastify. |
| `app/server/src/text-protocol-routes.ts` | Las siete peticiones. Cada una llama a la misma lógica de la API JSON. |
| `app/server/src/app.ts` | `authenticate` y `signIn`, que usan por igual la web y el protocolo. |
| `app/server/test/text-protocol*.test.ts` | Cada ejemplo del documento y cada código de error. |

No hay reglas del negocio nuevas ni migración. El protocolo no aparece en `openapi.json` porque no es JSON.

## Cómo funciona

- **Rutas.** `POST|GET /cyp_login` (con su límite de 10 por minuto) y `POST|GET /cyp_:cmd` para lo demás. Un comando
  que no existe responde `PNE`. Viven en un complemento encapsulado de Fastify con su propio manejador de errores:
  todo sale con HTTP 200, `text/plain; charset=utf-8`, en una línea y sin salto final. El cuerpo de un POST se toma
  tal cual, venga con el `Content-Type` que venga.
- **GET o POST.** Desde la 0.2 las siete peticiones llegan por GET (los parámetros después del `?`, decodificados
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
- **`Vence`.** El inicio de sesión devuelve cuándo se vence la sesión: el primero de sus dos finales, el de su
  registro (`expiresAt`) y el de su token (`exp`). No hay otro «8 horas» escrito en el protocolo.
- **Sesión.** `idSesion` es un token de sesión como el de la web, marcado con `channel: "cyp"`. Cada petición lo
  verifica y pasa por `authenticate`, la comprobación de toda petición de la web, con una ruta equivalente para los
  permisos: `POST /api/envios` para `clients`, `client`, `quote` y `send` (es `PuedeEnviar`) y `GET /api/envios`
  para `recs` (es `PuedeVerEnvios`). Después pide el permiso también por su nombre (`remittances.create` o
  `remittances.view`), para que un cambio en la tabla de rutas de `access.ts` nunca deje abiertas estas peticiones.
- **Un `idSesion` no sirve en la API JSON.** Puede viajar en una dirección (GET) y acabar en un registro; por eso el
  `preHandler` rechaza con 401 todo token que lleve `channel`. Al revés sí: un token de la web sirve en el protocolo.
- **`idOperacion`.** Se guarda en la tabla `idempotency` con la clave `cyp:{idUsuario}:{idOperacion}`. La huella es
  el SHA-256 de los parámetros ya decodificados, sin el `idSesion` ni la versión de la aplicación, carácter por carácter (lo mismo por GET que por POST, con `p=` o sin él). Misma huella: se devuelve el envío guardado, aunque
  haya cambiado una tasa o esté cerrada la caja. Otra huella: `OPD` con el `NumEnvio`. Solo se guarda cuando el envío
  se registró. No caduca. **El documento promete 7 días como mínimo:** si algún día se depura la tabla `idempotency`,
  las filas `cyp:` de menos de 7 días no se tocan. (La clave supone que ninguna cuenta tiene el id literal `cyp`.)
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
| Token que no se puede verificar | `SNE` |
| Token vencido, `SESSION_EXPIRED` | `SNA` |
| `INVALID_CREDENTIALS`; `ACCESS_REVOKED` al iniciar sesión | `UCI` |
| `COLLECTOR_INACTIVE`, `OPERATOR_INACTIVE` | `CBI` |
| `FORBIDDEN`, `PERMISSION_REQUIRED`, `ACCESS_REVOKED`, `OPERATOR_FORBIDDEN` | `SPE` |
| Parámetro que falta, sobra o está mal escrito; `MONEY_RANGE`, `INVALID_PAYMENT`; petición demasiado grande o que no se puede leer | `PIN` |
| Límite de peticiones (HTTP 429) | `DML` |
| Comando que no existe | `PNE` |
| `CLIENT_NOT_FOUND`; listado de clientes vacío | `CNE` |
| `CLIENT_INACTIVE` | `CIN` |
| Remitente fuera de la ruta del Cobrador | `CFR` |
| `SAME_CLIENT` | `MCL` |
| `RATE_MISSING` | `TNE` |
| `AMOUNT_TOO_SMALL`, `INVALID_AMOUNT`; monto `0.00` | `MIN` |
| `QUOTE_CHANGED`; los importes no coinciden con la cotización | `CCA` |
| `CASH_NOT_OPEN` | `CNA` |
| `INSUFFICIENT_TENDERED` | `EIS` |
| `PAYMENT_NOT_VERIFIED` | `PNV` |
| Misma `idOperacion` con otros datos | `OPD` |
| Listado de recibos vacío | `RNE` |
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

## Antes de producción

Hoy esto solo corre en la central de pruebas, con datos ficticios. Antes de ponerlo con datos reales hay que decidir:

- **La clave por GET.** En un GET la clave viaja en la dirección. El servidor de CyP no escribe direcciones en ningún
  sitio (`Fastify({ logger: false })`, y las trazas guardan la ruta, no la dirección), pero el proxy de la plataforma
  y la red del usuario sí pueden guardarlas. Por eso `passwordByGet` es verdadero solo en modo demo. Según lo que
  responda la otra parte a la pregunta 4a del documento, las salidas son tres: que manden Iniciar Sesión por POST;
  que manden la clave en una cabecera; o aceptar la clave por GET sabiendo
  dónde queda. Es una decisión de Rardiel, no del código. Hay que tomarla antes de una central real: la aplicación
  de la otra parte entra por GET, y fuera del modo demo eso responde `PIN`.
- **El `idSesion` en una dirección.** Vale 8 horas y no sirve en la API JSON, así que el daño de que se filtre es
  limitado; la clave no vence.

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

Para registrar un envío, ese usuario tiene que tener abierta su Caja de Remesas de hoy en la moneda de origen.
