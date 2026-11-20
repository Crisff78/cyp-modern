# Quitar el código de invitación de la demo pública

Plan escrito por Claude Code (Fable 5.2) el 2026-11-20, en la laptop de Rardiel, sobre `main` `fbb2b19`. Esta es la
versión corregida tras la revisión EGM (`goldfish_review_report.md`, en esta carpeta) y es lo que se programó.

## De dónde sale

Orden de Rardiel del 2026-11-20: «Mira, también pienso algo, quiero eliminar este codigo de invitación totalmente,
ya está cansado eso y realmente no importa nada de seguridad con eso ahora, ellos se manejan así. A lo que me
refiero es al codigo de invitación que pide antes de entrar a iniciar sesión en la app, eso a nosotros y al equipo
nos frena».

Ese mismo día la otra parte mandó una captura: su aplicación llama a `/cyp_login` sin la cabecera
`X-CyP-Invitacion` y la central de pruebas la rechaza antes de mirar nada más.

## Qué era la invitación

`app/server/src/demo-access.ts`, que solo se registraba en la demo pública (`CYP_PUBLIC_DEMO=true`):

- Un gancho `onRequest` delante de todo. Sin la cookie `__Host-cyp-demo` (8 horas), las páginas redirigían a
  `/demo-access`, la API JSON respondía 401 `DEMO_INVITATION_REQUIRED` y las peticiones `/cyp_*` respondían
  `ER|…|PIN|…|X-CyP-Invitacion`, salvo que trajeran el código en esa cabecera.
- La página `/demo-access`, su guion `/demo-access.js` y el `POST` que entregaba la cookie.
- De paso ponía `X-Robots-Tag: noindex, nofollow` en todas las respuestas, exigía que el origen público fuera HTTPS
  y añadía un lector de `application/x-www-form-urlencoded` para su formulario.

El servidor no arrancaba en modo público sin `DEMO_ACCESS_CODE` (`index.ts`).

## Qué se cambia

Una sola fase: se quita la puerta entera, en un PR propio (volver atrás es revertirlo). No queda apagada detrás de
una variable: Rardiel pidió eliminarla, y un interruptor dejaría código, pruebas y un contrato condicional que
mantener.

| Archivo | Qué |
| --- | --- |
| `app/server/src/demo-access.ts` | **Borrar** |
| `app/server/test/demo-access.test.ts` | **Borrar.** Lo que comprobaba y no era de la puerta pasa a `public-demo.test.ts` |
| `app/server/test/public-demo.test.ts` | **Crear** (ver «Pruebas») |
| `app/server/src/app.ts` | Modificar: fuera el `import`, `demoAccess` de la configuración, su registro y las dos líneas del `preHandler`. `publicOrigin?: string` pasa a ser un dato propio de la configuración (antes salía de `demoAccess.origin`). El gancho `onSend` pone `X-Robots-Tag: noindex, nofollow` cuando `publicWeb` |
| `app/server/src/index.ts` | Modificar: ya no valida ni pasa `DEMO_ACCESS_CODE`. Pasa `publicOrigin: publicWeb ? publicOrigin : undefined`, para que una instalación normal no añada su dirección local a los orígenes de las instalaciones de estaciones |
| `app/server/src/text-protocol.ts` | Modificar: fuera `INVITATION_HEADER` e `isTextProtocolPath` (solo los usaba la puerta); comentario de cabecera |
| `app/server/src/text-protocol-routes.ts` | Modificar: comentario de cabecera (nombre del contrato) |
| `render.yaml` | Modificar: fuera `DEMO_ACCESS_CODE` |
| `app/server/test/auth-restart.test.ts` | Modificar: el arranque de prueba ya no pide invitación ni usa su cookie |
| `app/server/test/text-protocol.test.ts` | Modificar: el ayudante pasa a `open(state, publicWeb = false, demo = true)`; la prueba «public demo» comprueba que no hay puerta |
| `docs/protocolo-cyp/Protocolo CYP 0.2.txt` → `0.3.txt` | Renombrar y modificar (abajo) |
| `docs/DEMO-PUBLICA.md`, `docs/PROTOCOLO-TEXTO-PLANO.md`, `docs/API_CONTRACTS.md`, `docs/LIMITE-POR-VISITANTE.md` | Modificar |

No se toca `scripts/serve-review.mjs`: es una herramienta local para enseñar una compilación de revisión, con su
propio código (`/acceso-demo`); no es la demo ni «la app».

Lo que se conserva a propósito:

- **`X-Robots-Tag: noindex, nofollow`** en la demo pública, para que los buscadores no la indexen ahora que se abre
  sin código. No se añade `robots.txt`: un `Disallow` impediría leer esa cabecera.
- **El inicio de sesión** con usuario y clave, sus 10 intentos por minuto y el límite general de 120 peticiones por
  minuto y dirección.
- **Una cabecera `X-CyP-Invitacion` que alguien siga mandando** se ignora, sin error.
- Las demás cabeceras de seguridad (política de contenido, `Referrer-Policy`, `Cache-Control: no-store`) las pone
  la aplicación, no la puerta: siguen igual.

Sin la puerta, el modo público deja de exigir HTTPS en el arranque. En Render el dominio es HTTPS siempre.

### El documento del protocolo pasa a la 0.3

La 0.2 decía que la central de pruebas pide la cabecera. Cambia el contrato, así que cambia la versión; esperar al
siguiente cambio dejaría la central y el contrato en desacuerdo.

- Cabecera: `Versión: 0.3`, y «Esta es la versión 0.3».
- Notas Generales, 9) «Central de pruebas»: ya no pide código de invitación; su aplicación no manda ninguna
  cabecera; si todavía manda `X-CyP-Invitacion`, la central no la mira. Se quitan las tres viñetas de la cabecera
  (falta, 10 veces mal, «póngala donde sea fácil de quitar»).
- «Modificado»: una entrada de la 0.3, con «no tiene que cambiar nada en su aplicación».
- Punto 4a del final: se quita «(Ya lo hace con X-CyP-Invitacion.)».

## Lo que queda a la vista sin la invitación

Comprobado el 2026-11-20. Esto no estaba a la vista cuando Rardiel dio la orden, y se le avisa antes de que
fusione.

1. **La clave inicial de las cuentas de la demo es pública.** El repositorio es público (API de GitHub:
   `visibility=public`, se lee sin credencial). La clave está en el README (línea 36), en otros documentos, en el
   código y **dentro del programa que la propia demo sirve** (los dos portales la llevan en su paquete compilado).
   Hacer privado el repositorio no la taparía.
2. Por tanto, hasta hoy el código de invitación era **lo único** que separaba a cualquier persona de internet de
   una sesión de Administración en la demo.
3. **Qué puede hacer una sesión de Administración** (rutas de `admin-tools-routes.ts` y de `app.ts`): ver las
   estaciones enteras, con dispositivo y licencia; preguntarle en vivo a RRAA por el código de estación que escriba;
   cambiar su propia clave; desactivar cuentas; inactivar estaciones. Un extraño podría dejar fuera al equipo y a
   la otra parte.
4. **Sin iniciar sesión** se ven, como en cualquier instalación: los dos portales, `/api/health`,
   `/api/openapi.json`, las siete peticiones `/cyp_*` (que piden su propio inicio de sesión), un recibo si se conoce
   su identificador de 32 caracteres, y **la lista de estaciones activas** del formulario de entrada
   (`GET /api/auth/estaciones`: número y nombre). El nombre de una estación es su código; los validados contra RRAA
   son los reales del proveedor (`docs/RRAA-ESTACIONES.md`).
5. La regla de la casa (AGENTS.md de CyP): «Los datos de RRAA nunca van a Git ni se muestran sin tapar». En octubre
   se decidió que la demo valide con el RRAA real. Si la demo tiene estaciones validadas, quitar la invitación las
   deja a la vista: sus códigos, sin iniciar sesión; sus dispositivos y licencias, para quien entre como
   Administración.

Rardiel decidió que la seguridad de la demo no importa ahora y pidió quitar la invitación. Este plan cumple la
orden. El paso que publica (fusionar el PR de la demo) lo da él, con este aviso delante.

**Lo que tapa casi todo sin volver a frenar a nadie, y no necesita código:** que quien administre la demo cambie
la clave de Administración desde su cuenta (Usuarios; 15 caracteres o más). El programa guarda la clave nueva y la
inicial deja de abrir esa cuenta (lo comprueba `auth-restart.test.ts`). Conviene hacerlo antes de fusionar el PR de
la demo. Las cuentas de Cobrador y de Cajero de práctica solo tocan datos ficticios.

Lo que eso no tapa: la lista de estaciones del formulario de entrada. Si Rardiel no la quiere a la vista en la demo,
es otro cambio (ocultar los nombres a quien no ha entrado, o no tener estaciones reales en la demo).

## Pruebas

- `public-demo.test.ts`, con la web pública montada (`registerPublicWeb`):
  - Las páginas (`/`, `/collector/`, un archivo, `/demo-access`) responden 200 o 404 según haya compilación, nunca
    una redirección. `/demo-access.js` responde 404. `POST /demo-access` responde 401 o 404 y no entrega cookie.
  - Sin sesión responden lo de siempre `/api/health`, `/api/openapi.json`, `/api/auth/estaciones` y un recibo
    inexistente (404). Lo demás responde 401 `UNAUTHORIZED`, también por la ruta codificada `/%61pi/snapshot`.
  - El inicio de sesión funciona sin ninguna cookie.
  - `X-Robots-Tag: noindex, nofollow` en una página, un archivo, la API con y sin sesión, una petición `/cyp_*` y
    una dirección que no existe. Fuera de la demo pública no se pone.
  - La política de contenido sigue sin `unsafe-inline` en los guiones y `Referrer-Policy` es `no-referrer`.
- `text-protocol.test.ts`, demo pública: sin cabecera, `/cyp_login` entra y `/cyp_clients` responde; con una
  cabecera `X-CyP-Invitacion` cualquiera, igual; la API JSON sin sesión responde 401 `UNAUTHORIZED`.
- `auth-restart.test.ts`: lo mismo que comprobaba (cuentas y sesiones sobreviven a un reinicio), sin invitación.
- Toda la suite del servidor, tipos de los tres paquetes, `pnpm build`, y las pruebas de interfaz del inicio de
  sesión con `pnpm build:public` (`login-station-flow-ui` arranca la web pública de verdad).

## Después de fusionar

La demo publica la rama `codex/public-browser-demo`: el cambio se ve cuando se fusiona el PR de esa rama.

- `GET /` de la demo debe dar la pantalla de inicio de sesión (200), no una redirección a `/demo-access`.
- `GET /cyp_x` debe responder `ER|…|PNE|…` (petición que no existe), no `PIN` con `X-CyP-Invitacion`.
- Abrir un marcador viejo de `/demo-access`: debe dar el programa, no un error.
- `DEMO_ACCESS_CODE` queda sin uso. **No borrarla de Render todavía:** una vuelta atrás a la versión anterior no
  arrancaría sin ella.

## Para Rardiel (fuera del repositorio)

`Protocolo CYP 0.3.txt` en su carpeta, la 0.2 a `anteriores/`, y `MENSAJES.txt` sin la cabecera de invitación.
