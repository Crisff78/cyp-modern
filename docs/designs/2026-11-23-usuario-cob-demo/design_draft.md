# Usuario `cob` en la central de pruebas

Plan escrito por Claude Code (Opus 5.5) el 2026-11-23, en la laptop de Rardiel, sobre `main` `b05cab3`. Esta versión
describe lo construido, con los hallazgos de la revisión ya resueltos (`goldfish_review_report.md`).

## De dónde sale

Quien programa la aplicación móvil prueba con `…/cyp_login?p=cob|cob|3.0` y la central responde `UCI`.

Órdenes de Rardiel del 2026-11-23: «Crea este usuario, que él está probando con este usuario, creale ese a él» y «Y la
contraseña cob también, no hay problema en que lo sepas, no hay problema de seguridad en eso».

## Lo comprobado

- En la demo (`version: c669d13`) hay 6 cuentas y ninguna tiene el usuario `cob`: por eso responde `UCI`. La cuenta
  `cob` que se ve en las capturas es de la base vieja de SQL Server, que CyP Modern no usa.
- La API no deja crearla: `passwordField` (`app/server/src/app.ts:575`) exige 15 caracteres en toda clave nueva, y
  `cob` tiene 3. La pantalla de Usuarios tampoco.
- Ya hay un caso igual: el Cajero de práctica. `enrichCashierDemo` (`app/server/src/demo-cashier-scenarios.ts`) añade
  una cuenta con clave publicada una sola vez, con una marca en `idempotency`; no la restaura si se edita o se borra; y
  fuera del modo demo la API rechaza esa identidad (`app.ts:320` y `app.ts:528`).

## Qué se hace

Lo mismo que con el Cajero de práctica, solo en la demo pública. No cambia la regla de los 15 caracteres.

1. `app/server/src/demo-cashier-scenarios.ts`: `enrichMobileTestDemo` añade una vez la cuenta (usuario `cob`, clave
   `cob`, nombre «Usuario de pruebas (cob)», rol `cashier`, `permissionMode: "role"`, id `demo-mobile-test`) y escribe
   la marca `__demo_seed__:mobile-test-v1`. Compara `id` y `email` en minúsculas. Si ya existe una cuenta con ese
   usuario no la toca, pero escribe la marca igual. Si después se edita o se borra, no se restaura.
   `isPublishedDemoAccount` reúne las dos cuentas con clave publicada.
2. `app/server/src/index.ts`: se llama dentro de `if (publicWeb)`, junto a `enrichPublicDemo` y `enrichCollectorDemo`.
   Así no entra en una instalación normal ni en una demo local.
3. `app/server/src/app.ts` (import, `:320` y `:528`): `account.id === DEMO_CASHIER_ID` pasa a
   `isPublishedDemoAccount(account.id)`. Si esa base se usara algún día fuera del modo demo, `cob` no podría entrar.
4. `docs/DEMO-PUBLICA.md` y `README.md`: dicen que la cuenta existe, con qué clave, y quién abre su caja.

No se toca el documento del protocolo: la cuenta no cambia ninguna petición.

## Por qué Cajero

En la base vieja `cob` es Supervisor, pero en CyP un Supervisor no puede listar clientes, cotizar ni registrar envíos
(responde `SPE`), y eso es justo lo que la aplicación tiene que probar. Cajero puede todo eso y no necesita cobrador ni
ruta. Decisión de Claude: se avisa a Rardiel; el rol se cambia en Usuarios.

## Lo que cuesta

- Queda en un repositorio público una clave de 3 letras para una cuenta de Cajero de la demo. Rardiel dijo que no hay
  problema. La demo ya tiene otra clave publicada para Administración y Cajero. Ojo: la demo no es solo ficticia, porque
  `docs/DEMO-PUBLICA.md` avisa de que algunos datos de estaciones son los reales del proveedor; un Cajero no administra
  estaciones ni licencias.
- Para registrar envíos, `cob` necesita su Caja de Remesas abierta ese día; si no, responde `CNA`. No se abre sola ni
  desde el protocolo: se entra en la web con `cob` y se abre en Cuadres Diarios → Caja de remesas.

## Lo que no se hace

- **Bajar la regla de los 15 caracteres**, ni en la demo: afectaría a todas las cuentas.
- **Escribir directo en la base de Render:** no hay acceso, y no quedaría registrado en el código.
- **Traer las claves de la base vieja.**

## Pruebas

- `app/server/test/demo-mobile-test-account.test.ts`: se añade una sola vez; no toca una cuenta `COB` que ya exista; no
  se restaura si se borra.
- Con la app en modo demo y la forma de llamar de la aplicación: `GET /cyp_login?p=cob|cob|3.0` responde `OK`, rol
  `cashier`, `PuedeEnviar` 1; clientes y cotizar `OK`; registrar `CNA` sin caja y `OK` con la caja abierta por la web.
- Fuera del modo demo: `POST /cyp_login` responde `UCI` (por GET respondería `PIN` antes de mirar la cuenta), la web
  responde 401 y la sesión abierta en demo no vale.
- `demo-bootstrap.test.ts`: el primer arranque deja 4 marcas y el segundo no cambia nada.
- Toda la suite del servidor, tipos de los tres paquetes y compilación pública.
- Arranque real local en modo demo pública con una base PostgreSQL de prueba llamada `cyp_demo`: nueva, y ya usada sin
  la cuenta (el caso de Render).
- Después de publicar, en la demo: `GET /cyp_login?p=cob|cob|3.0` debe responder `OK`.
