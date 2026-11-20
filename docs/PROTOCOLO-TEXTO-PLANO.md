# Protocolo de texto plano para la aplicación móvil (CYP 0.2)

Siete peticiones `/cyp_*` que responden en texto plano, separadas por `|`, para que una aplicación móvil hecha por
otro equipo haga Envíos de Dinero contra CyP. Orden de Rardiel del 2026-11-19: «Programalo y deja todo listo».

- **El contrato** es [`protocolo-cyp/Protocolo CYP 0.2.txt`](<protocolo-cyp/Protocolo CYP 0.2.txt>): es el documento
  que se le envía a quien programa la aplicación. Si el servidor y ese documento no coinciden, hay un fallo: se
  arregla el servidor o se envía una versión nueva del documento, nunca se deja pasar.
- **El plan** y su revisión están en `designs/2026-11-19-protocolo-texto-plano/`. La versión 0.2 (GET en todas las
  peticiones y `Vence`), en `designs/2026-11-20-protocolo-get-y-vence/`.

## Dónde está cada cosa

| Archivo | Qué hace |
| --- | --- |
| `app/server/src/text-protocol.ts` | Leer una petición, escribir una respuesta, los códigos y sus mensajes. Sin Fastify. |
| `app/server/src/text-protocol-routes.ts` | Las siete peticiones. Cada una llama a la misma lógica de la API JSON. |
| `app/server/src/app.ts` | `authenticate` y `signIn`, que usan por igual la web y el protocolo. |
| `app/server/src/demo-access.ts` | La invitación de la demo pública en una cabecera, solo para `/cyp_*`. |
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
  el SHA-256 de los parámetros ya decodificados, sin el `idSesion`, carácter por carácter (lo mismo por GET que por POST). Misma huella: se devuelve el envío guardado, aunque
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
  del de `/api/auth/login`: entre las dos rutas son 20 intentos de clave por minuto y dirección.

## La demo pública

La demo pide un código de invitación en una cookie que una aplicación móvil no tiene. La puerta no se quita: para
las rutas `/cyp_*` la invitación se acepta también en la cabecera `X-CyP-Invitacion`. Sin ella, la respuesta es
`ER|FechayHora|PIN|…|X-CyP-Invitacion`. Diez cabeceras equivocadas en un minuto desde una dirección bloquean esa
dirección un minuto (`DML`), también para la correcta; ese gancho responde antes de que cuente el límite general,
por eso lleva su propia cuenta. La cabecera no abre la API JSON ni las páginas. Fuera de la demo pública no hay
puerta y la cabecera no se mira. Es el mismo código de la web: cambiarlo corta también a la aplicación.

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

## Antes de producción

Hoy esto solo corre en la central de pruebas, con datos ficticios. Antes de ponerlo con datos reales hay que decidir:

- **La clave por GET.** En un GET la clave viaja en la dirección. El servidor de CyP no escribe direcciones en ningún
  sitio (`Fastify({ logger: false })`, y las trazas guardan la ruta, no la dirección), pero el proxy de la plataforma
  y la red del usuario sí pueden guardarlas. Por eso `passwordByGet` es verdadero solo en modo demo. Según lo que
  responda la otra parte a la pregunta 4a del documento, las salidas son tres: que manden Iniciar Sesión por POST;
  que manden la clave en una cabecera, como ya hacen con `X-CyP-Invitacion`; o aceptar la clave por GET sabiendo
  dónde queda. Es una decisión de Rardiel, no del código.
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
