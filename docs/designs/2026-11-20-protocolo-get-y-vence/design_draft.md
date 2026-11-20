# Protocolo de texto plano 0.2: GET en todas las peticiones y cuándo vence la sesión

Plan escrito por Claude Code (Fable 5.2) el 2026-11-20, en la laptop de Rardiel, sobre `main` `cbe5be5`. Esta es la
versión corregida tras la revisión EGM (`goldfish_review_report.md`, en esta carpeta) y es lo que se programó.

## De dónde sale

La otra parte probó el protocolo (PR #175) y, según contó Rardiel el 2026-11-20: funciona, ellos trabajan con GET y
al iniciar sesión les falta saber «cuál es la sesión ni en qué momento está». La IA propuso aceptar GET también en
Iniciar Sesión y Registrar Envío, sin quitar el POST, y añadir a la respuesta del inicio de sesión cuándo vence;
avisó de que en un GET la clave viaja en la dirección y de que habría que volver a mirarlo antes de producción.
Rardiel respondió: «Hazlo». Es su permiso para cambiar esas dos rutas públicas.

En la 0.1 (`app/server/src/text-protocol-routes.ts`) `login` y `send` respondían por GET
`ER|…|PIN|Esta petición solo se acepta por POST|Parametros`. Las otras cinco ya aceptaban GET y POST. El inicio de
sesión devolvía `OK|FechayHora|idSesion|DatosUsuario`, sin decir cuándo vence.

## Qué cambia

Una sola fase: es un cambio pequeño y cada parte se comprueba con su prueba.

### 1. Las siete peticiones se aceptan por GET y por POST

Se quita la comprobación «solo POST». Las dos rutas ya estaban registradas con los dos métodos, y `rawParameters`
ya saca los parámetros de lo que sigue al `?` (decodificado entero con `decodeURIComponent`) o del cuerpo.

- **Iniciar Sesión por GET:** `/cyp_login?Usuario|Clave`. Se parte por el primer `|`, igual que el cuerpo. La clave
  va codificada con `%` (`%25` para `%`, `%23` para `#`, `%20` para el espacio); el `+` se toma tal cual.
- **Registrar Envío por GET:** los mismos 16 datos después del `?`.

**Una excepción, decidida en la revisión: la clave por GET solo en modo demo.** `TextProtocolDeps.passwordByGet`
vale `config.demo`. Fuera del modo demo, Iniciar Sesión por GET sigue respondiendo `PIN` («En esta central, Iniciar
Sesión solo se acepta por POST»). La central de pruebas es modo demo, así que allí funciona como pidió la otra
parte. Por qué: la clave es la misma de la central web y no vence; el `idSesion`, en cambio, dura 8 horas y no sirve
en la API JSON. Así la decisión de producción no se puede olvidar: el día que haya una central real, o la otra
parte manda Iniciar Sesión por POST, o manda la clave en una cabecera, o Rardiel decide aceptar la clave por GET
(una línea). El documento se lo pregunta a la otra parte (punto 4a).

**Tope de una dirección: 8000 caracteres** (`MAX_ADDRESS_LENGTH`, en `rawParameters`). Más larga responde `PIN` con
`Parametros` y el mensaje «Mande esta petición por POST». Sin el tope, una Nota larga codificada con `%` pasaría el
máximo de cabeceras de Node (16 KiB) y la respuesta sería un 431 sin el formato del protocolo. Medido por HTTP real:
12 521 caracteres responden `PIN`; 20 000 responden 431.

### 2. El inicio de sesión dice cuándo vence

`OK|FechayHora|idSesion|DatosUsuario|Vence`

`Vence` tiene el formato de `FechayHora`. Es el primero de los dos finales que tiene una sesión: el de su registro
(`expiresAt`) y el de su token (`exp`). `signIn` devuelve ahora `expiresAt` (el del registro que acaba de crear) y
el protocolo lee `exp` del token ya firmado; no se escribe otro «8 horas», ni se lee el estado otra vez.

```ts
const claims = deps.verifyToken(session.token);                       // una vez; lo usa también `can`
const ends = Math.min(Date.parse(session.expiresAt), ...(claims.exp ? [claims.exp * 1000] : []));
return okLine(now, session.token, record(id, name, role, await can(SEND), await can(VIEW)), protocolStamp(new Date(ends)));
```

`POST /api/auth/login` (la web) sigue devolviendo solo `token` y `user`.

Va como una parte nueva al final, no dentro de `DatosUsuario`: quien ya lee las cuatro primeras partes por su
posición no nota el cambio. Es una marca de tiempo y no una duración, y solo una de las dos, para que no haya dos
verdades. El documento dice cómo usarla: compararla con la `FechayHora` de la central, no con el reloj del teléfono.

No se añade el estado de la Caja de Remesas: se espera a que la otra parte aclare qué pide.

### 3. El documento pasa a la versión 0.2

`docs/protocolo-cyp/Protocolo CYP 0.1.txt` se renombra a `Protocolo CYP 0.2.txt` (con `git mv`): quien reciba el
archivo tiene que poder saber cuál tiene. Cambios en el texto:

| Dónde | Cambio |
| --- | --- |
| Cabecera | `Versión: 0.2`, `Fecha: 20/11/2026`, y una frase que manda a «Agregado» y «Modificado» |
| «Agregado» y «Modificado» | Las secciones que ya existían, con lo de la 0.2 |
| Notas, 2) «Cómo se manda» | Las siete por GET y por POST; el tope de 8000; y un consejo, no una obligación: en un GET la Clave viaja en la dirección. En la central de pruebas se acepta; para la central real se decide con la otra parte |
| Notas, 3) signos | El `+` no es espacio, con un ejemplo; `%` va como `%25`; vale también para la Clave |
| Notas, 4) respuestas | Regla nueva: en versiones nuevas pueden venir datos de más al final; hay que ignorarlos |
| 1.1 Iniciar Sesión | `Pet:` por GET; `Res:` con `Vence`; qué es `Vence` y cómo compararla; «se parte por el primer \|» vale para GET y POST; ejemplo |
| 3.2 Registrar Envío | `Pet:` sin «solo POST»; en las reglas del `idOperacion`, «los 16 datos» en vez de «el cuerpo»; un ejemplo por GET con espacio y ñ |
| Errores, `PIN` | Se quita «o llegó por GET una que es solo por POST» |
| Punto 4 del final | 4a sigue siendo pregunta, otra: «¿puede mandar POST, aunque sea solo en Iniciar Sesión? Si no, ¿puede poner una cabecera propia en un GET?». 4b pregunta además por el espacio como `+`. Siguen siendo 12 puntos |

También: `docs/PROTOCOLO-TEXTO-PLANO.md` (título, enlace, «GET o POST», `Vence`, la huella del `idOperacion` y una
sección nueva «Antes de producción»), `docs/API_CONTRACTS.md` (enlace) y el comentario de cabecera de
`text-protocol.ts` y `text-protocol-routes.ts`. Los documentos de `docs/designs/2026-11-19-protocolo-texto-plano/`
son historia y no se tocan (su enlace al archivo 0.1 queda muerto).

## Archivos

| Archivo | Qué |
| --- | --- |
| `app/server/src/text-protocol-routes.ts` | Modificar: GET en `login` (con `passwordByGet`) y en `send`; `Vence`; `exp` en `Claims` |
| `app/server/src/text-protocol.ts` | Modificar: `MAX_ADDRESS_LENGTH` y su comprobación en `rawParameters` |
| `app/server/src/app.ts` | Modificar: `signIn` devuelve `expiresAt`; la ruta de la web sigue devolviendo `token` y `user`; `passwordByGet: config.demo` |
| `app/server/test/text-protocol.test.ts` | Modificar: ver «Pruebas» |
| `docs/protocolo-cyp/Protocolo CYP 0.1.txt` → `Protocolo CYP 0.2.txt` | Renombrar y modificar |
| `docs/PROTOCOLO-TEXTO-PLANO.md`, `docs/API_CONTRACTS.md` | Modificar |

Sin migración. No cambia la API JSON, ni la demo ni su invitación (sigue en la cabecera `X-CyP-Invitacion`).

## Riesgos, y qué los cubre

1. **La clave en la dirección (GET de Iniciar Sesión).**
   - Solo se acepta en modo demo (arriba).
   - El servidor de CyP no escribe direcciones en ningún sitio: `Fastify({ logger: false })`; los `console.error`
     escriben un identificador y el mensaje; las trazas guardan la ruta literal; la fila de idempotencia, un hash;
     las claves del límite, la IP. Comprobado además en la prueba real: el registro del servidor quedó con una
     línea, la de arranque.
   - Toda respuesta lleva `Cache-Control: no-store`, errores incluidos.
   - Lo que no se controla: los registros de la plataforma (Render y su proxy) y los de la red o el teléfono del
     usuario.
   - El límite de 10 intentos por minuto es uno solo para GET y POST (Fastify registra la ruta una vez con los dos
     métodos, y el plugin crea un contador por registro). Hay prueba.
2. **Un envío repetido por abrir dos veces la misma dirección (GET de Registrar Envío).** Era el motivo del «solo
   POST». Lo cubre `idOperacion`: la misma petición devuelve el envío ya registrado y nunca registra otro. La huella
   se calcula sobre los datos ya decodificados, así que repetir por POST lo que se mandó por GET (o al revés) es la
   misma petición. Además, sin el `idSesion` nadie puede provocar un GET.
3. **HEAD.** Las rutas llevan `exposeHeadRoute: false`: un HEAD no ejecuta nada. Hay prueba con `send` y `login`.
4. **Quien ya probó con la 0.1.** POST sigue igual. La respuesta del inicio de sesión tiene una parte más al final.
5. **El espacio como `+`.** Algunas librerías codifican así el espacio. La regla no cambia (el `+` es un `+`): la
   Clave daría `UCI` y una Nota se guardaría con `+`. El documento lo avisa con un ejemplo y lo pregunta (4b).

## Pruebas (`app/server/test/text-protocol.test.ts`)

- Iniciar sesión: 5 partes; `Vence` igual al primero de `exp` y `expiresAt`, leídos del token y del registro;
  posterior a `FechayHora`; 8 horas después del inicio.
- Iniciar sesión por GET: la sesión sirve en otra petición; clave con signos, codificada (la cuenta `pipes` y una
  nueva con `% + # & ?` y espacio); el espacio como `+` da `UCI`; sin nada (`PIN`, `Usuario`); sin clave (`PIN`,
  `Clave`); un `%` roto (`PIN`, `Parametros`).
- Fuera del modo demo: Iniciar Sesión por GET da `PIN` con `Parametros`; por POST entra; las demás van por GET.
- Límite: 5 intentos por POST y 5 por GET, y el siguiente responde `DML` por los dos.
- Registrar envío por GET: registra uno; la misma dirección otra vez y los mismos datos por POST devuelven ese
  envío (se compara la parte del envío, no la línea entera: la `FechayHora` puede cambiar de segundo); otro dato con
  el mismo `idOperacion` da `OPD`.
- HEAD sobre `/cyp_send` y `/cyp_login`: no responde 200, no registra envío ni abre sesión.
- Dirección de más de 8000 caracteres: `PIN` con `Parametros`, no registra; por POST entra.

## Cómo se comprobó

1. Las 29 pruebas del protocolo y toda la suite del servidor.
2. Tipos de los tres paquetes y `pnpm build`.
3. Por HTTP real, con `curl`, contra un servidor local en modo demo: iniciar sesión, clientes, cotizar, registrar,
   repetir, recibos y cerrar sesión, todo por GET; el mismo envío por POST; direcciones de 12 521 y de 20 000
   caracteres; HEAD; y que `POST /api/auth/login` sigue devolviendo solo `token` y `user`.
4. Después de que Rardiel fusione: `/api/health` de la demo. Con la invitación delante, la IA no puede iniciar
   sesión en la demo; eso lo prueba la otra parte.

## Para Rardiel (fuera del repositorio)

En `protocolo-cyp-movil/`: `Protocolo CYP 0.2.txt` (igual al del repositorio), la 0.1 pasa a `anteriores/`, un
mensaje nuevo en `MENSAJES.txt` para mandar con la 0.2, y `NOTAS-INTERNAS.md` al día.
