# `idSesion` corto en el protocolo de texto plano

Plan escrito por Claude Code (Opus 5.5) el 2026-11-23, en la laptop de Rardiel, sobre `main` `12564ec`. Esta versión
describe lo construido, con los hallazgos de la revisión resueltos (`goldfish_review_report.md`).

## De dónde sale

Orden de Rardiel del 2026-11-23: «Mira, ellos me dicen que la sesión mía es muy grande, que debería ser más pequeña como
por ejemplo la de ellos en sus programas que son más pequeñas, como por ejemplo la de la otra imagen en la que lo
resaltado en amarillo ya es la sesión, solo eso resaltado que aparece en la imagen».

Lo resaltado en su imagen son 32 caracteres hexadecimales en mayúsculas. Hoy `idSesion` es un token JWT de unos 370
caracteres, con el nombre del usuario y su rol legibles dentro.

## Lo comprobado en el código

- `signIn` (`app/server/src/app.ts:504`) crea una fila en `auth_sessions` con `id = randomUUID()` y firma un JWT con el
  usuario, `authVersion`, `sid` y `channel: "cyp"`. El protocolo devuelve ese JWT.
- **El `sid` no puede ser el `idSesion`:** Administración lo ve en la lista de sesiones
  (`admin-tools-routes.ts:175-180`) y queda en las trazas (`createAuthSession`, `session.started`). Quien lo leyera
  podría hacerse pasar por esa sesión.
- `authVersion` de las identidades sin cuenta guardada (`app.ts:186`) va dentro de sus JWT, que se leen sin clave: no
  sirve como secreto.
- Las tres rutas que suben `credentialVersion` (`touch`, `app.ts:711`, `:754`, `:783`) revocan además las sesiones de
  la cuenta en la misma transacción.
- `assertAuthSession` ya comprueba en cada petición que la fila existe, es de ese usuario, rol y cobrador, no está
  revocada y no ha vencido.

## Qué se hace

`idSesion` pasa a ser el `sid` cifrado: **32 caracteres hexadecimales en mayúsculas**, sin tabla ni migración.

1. Archivo nuevo `app/server/src/text-protocol-session.ts`:
   - Clave: `hkdfSync("sha256", config.secret, authVersion, "cyp-text-protocol-session-v1", 32)`. `config.secret` es el
     secreto; `authVersion` va de sal para que un cambio del acceso configurado invalide estas sesiones, como hoy
     invalida los JWT de esas identidades.
   - `seal(sid)`: los 16 bytes del UUID, un solo bloque AES-256 sin relleno, en hexadecimal mayúscula.
   - `open(idSesion)`: exige `/^[0-9A-F]{32}$/`, descifra y exige forma de UUID v4 (versión y variante); si no, nada.
     Un solo bloque de datos aleatorios y sin repetir es el uso directo del cifrado como permutación. Sin la clave no se
     puede fabricar un `idSesion` que abra una sesión existente, ni sacarlo del `sid`.
2. `Store`: método obligatorio `readSessionIdentity(id)`, también en `request-store.ts` (el compilador avisa si falta).
   En PostgreSQL, una consulta de una fila: `auth_sessions` con `LEFT JOIN users` por `id` y, en el `ON`,
   `email IS NOT NULL`; pasa por `clean` para quitar los NULL. En memoria, desde `read()`.
3. `app.ts`: `claimsOfSession(sid)` rehace los datos de la sesión desde esa fila: `id`, `name`, `role`, `collectorId`,
   `sid` y `authVersion` (la `credentialVersion` actual de la cuenta, o la `authVersion` global si no hay cuenta), más
   el `channel` del protocolo, que es una constante. Después, Cerrar Sesión comprueba la fila con `assertAuthSession` y
   las demás peticiones pasan por `authenticate`, como hoy. `touch` y `revokeUserSessions` se unen en
   `rotateCredentials`, para que no se pueda subir la versión sin cerrar las sesiones.
4. `text-protocol-routes.ts`:
   - El inicio de sesión devuelve `seal(sid)` en vez del JWT. `Vence` es el final de la fila de la sesión.
   - `sessionOf` es asíncrona. Si el texto tiene forma de `idSesion` corto, lo abre; si no se puede abrir o no hay fila,
     `SNE`. Una fila vencida o cerrada sigue dando `SNA`. La lectura va fuera de todo `catch`: si falla la base, `EIC`.
   - **Un JWT se sigue aceptando**, para que quien ya tenga una sesión abierta al publicar no se quede fuera, y porque
     hoy un token de la web sirve en el protocolo. Un JWT lleva puntos: nunca se confunde con el corto.
5. Un `idSesion` corto no sirve en la API JSON: no es un JWT y `jwtVerify` lo rechaza.

## El documento del protocolo

El contrato dice hoy que `idSesion` es «un texto largo» de 300 a 450 caracteres, y deja de ser cierto. Pasa a la
**versión 0.5**, con lo que Rardiel pidió el 2026-11-23 para la próxima versión («Ok, eso tomalo en cuenta para cuando
tengamos que hacer una nueva versión del protocolo, ya que lo mandé ya»):

- Se borra de la introducción el bloque desde «que usted nos mandó de ejemplo. Donde hicimos algo distinto de LSAN…»
  hasta «…Si además algo no se entiende, díganos y lo aclaramos.». Se quedan el título, la versión, la fecha, la primera
  frase y «Usamos el mismo formato del protocolo LSAN (versión 1.14).».
- Se quitan las marcas `(NUEVO)` de la 0.4 y se marca solo lo nuevo desde la 0.4: el `idSesion`.
- «Lo nuevo de esta versión» pasa a decir solo eso.
- Se corrige «(hoy, la 0.1)» en `docs/PROTOCOLO-TEXTO-PLANO.md`.

## Lo que cuesta

- Cambiar `ADMIN_EMAIL` o `ADMIN_PASSWORD` cierra las sesiones del protocolo de **todas** las cuentas, con `SNE`, y esas
  filas siguen como activas en Administración hasta vencer. Se acepta: es raro y el efecto es cerrar de más.
- Una sesión sin fila responde `SNE`; con un JWT respondía `SNA`. El contrato admite los dos.
- Si alguien borrara a mano la cuenta inicial ya guardada, su `idSesion` seguiría valiendo hasta vencer. Ninguna ruta
  de la app borra cuentas.
- Cambiar `JWT_SECRET` cierra estas sesiones, igual que hoy los JWT.
- Una consulta más por petición, de una fila.

## Lo que no se hace

- **Usar el `sid` tal cual**, ni acortar el JWT.
- **Tabla o columna nueva:** no hace falta.
- **Tocar la sesión de la web**, ni dejar de aceptar sus tokens en el protocolo: queda en «Antes de producción».
- **Cambiar la duración, los códigos o los permisos.**

## Pruebas

- `seal`/`open`: 32 caracteres en mayúsculas; ida y vuelta; otro secreto u otra sal no devuelven esa sesión; minúsculas
  y largo distinto no abren. Un bloque al azar puede tener forma de UUID: la prueba exige `SNE` en la petición.
- Con la app: `cyp_login` devuelve 32 caracteres y funciona con `p=` y `3.0` en las siete peticiones.
- Cerrar sesión, sesión vencida, cambio de clave, cambio de rol y desactivar la cuenta: el corto deja de valer.
- El `sid` de la lista de sesiones no sirve como `idSesion`.
- El corto en `Authorization` da 401; un JWT anterior sigue funcionando.
- Toda la suite del servidor, tipos, compilación pública y arranque real con PostgreSQL, con peticiones de Cajero,
  Administración y Cobrador, cierre de sesión y cambio de clave.
- Después de publicar, en la demo: `GET /cyp_login?p=cob|cob|3.0` devuelve 32 caracteres y sirve para listar clientes.
