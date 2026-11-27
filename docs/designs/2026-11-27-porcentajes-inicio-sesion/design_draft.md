# Porcentajes en el inicio de sesión (protocolo 0.14)

Plan escrito por Claude Code (Opus 5.5) el 2026-11-27, en la laptop de Rardiel, sobre `main` `a46aa18` (protocolo 0.13).
Una etapa de revisión EGM con dos revisores (ver `goldfish_review_report.md`). Esta es la versión que se programó.

## De dónde sale

La otra parte pidió a Rardiel, de palabra, «cuánto se va a cobrar por transferencia» en el inicio de sesión, para tenerlo
en cuenta al hacer el envío («los porcientos o algo así», contado por Rardiel). La 0.13 los da con una petición aparte,
`/cyp_fees`. Rardiel, 2026-11-27: «Sí, hazlo como él lo pide, el último mensaje que le mandé fue este y el protocolo
0.12. Dame el mensaje que tengo que darle pero super resumido y super llano completamente». «Este» es su mensaje de
WhatsApp que explica los cargos de Cotizar (3.1). La otra parte tiene, entonces, la 0.12: no la 0.13 ni el mensaje 14.

## Lo comprobado (en `main`)

- `login` (`text-protocol-routes.ts`) responde `OK|FechayHora|idSesion|DatosUsuario|Vence` y no lee el estado. Los
  permisos salen de `can()`, que solo pregunta `deps.authenticate` por la ruta. El despachador pregunta además por el
  nombre del permiso (`ACCESS` y `requireRemittancePermission`).
- `fees` responde `Por_Comision;Por_CargoEntrega;Por_RecargoTarjeta` con `getCommissionPolicy` y `percentText`, con
  `ACCESS.fees = [SEND, "remittances.create"]`. Sin política guardada, los tres son `0.00`.
- El contrato, desde la 0.2, dice que una respuesta o un registro pueden traer datos de más al final y hay que ignorarlos.
- En la web, el supervisor ve los porcentajes (`commissions.view`) pero no puede cotizar; `/cyp_fees` le da `SPE`.

## Qué se hace

1. **Iniciar Sesión trae una sexta parte, `Porcentajes`**, al final:
   `OK|FechayHora|idSesion|DatosUsuario|Vence|Por_Comision;Por_CargoEntrega;Por_RecargoTarjeta`.
   - Los mismos tres datos que `/cyp_fees`, con una función compartida, `feesRecord(state)`.
   - Va al final y como una parte entera, no como tres datos más en `DatosUsuario`: no son datos del usuario.
   - Se llena si la cuenta pasa el permiso de Porcentajes tal como lo pregunta el despachador (`ACCESS.fees`, por la
     ruta y por el nombre; `can()` acepta el nombre del permiso). Si no, los tres van vacíos (`;;`): vacío no es `0.00`.
     Así, la sexta parte es `;;` justo cuando `/cyp_fees` daría `SPE`. `PuedeEnviar` no cambia.
   - El estado se lee solo después de entrar y solo si la cuenta puede pedirlos.
2. **`/cyp_fees` se queda**, para pedirlos otra vez si el Administrador los cambia durante la sesión.
3. **El contrato pasa a la 0.14** (renombrado desde la 0.13, con la versión de la cabecera):
   - **1.1:** la respuesta con `Porcentajes`, qué es cada dato, que vacío no es 0.00, y el ejemplo.
   - **`PuedeEnviar`:** también los Porcentajes.
   - **6.3:** dice que los mismos vienen al iniciar sesión. Su punto 2 se reescribe: los del inicio de sesión sirven
     para mostrar desde el principio, `/cyp_fees` trae los de ese momento y los importes salen siempre de Cotizar.
   - **Pasos 1 y 3** de «Cómo se hace un envío».
   - **`(NUEVO)` solo en lo nuevo desde la 0.12**: lo que sale de la diferencia entre la 0.12 y la 0.13 de git, más lo
     de la 0.14.
     - Se quitan las marcas de la 0.7 a la 0.12, también las `(NUEVO: …)` de la 0.10 y de la sección 6.
     - Se separan las marcas que mezclan versiones.
     - Se marcan los cambios de la 0.13 que no lo estaban:
       - el Modo 1 sin el recargo;
       - Tarjeta en Referencia, Banco y Verificado;
       - el aviso de los datos de la tarjeta;
       - `PNV` con Tarjeta;
       - `VersionApp` como dato 20;
       - el ejemplo de Cotizar con tarjeta.
   - **«Lo nuevo de esta versión»**, contado desde la 0.12:
     - avisa de que la respuesta de Iniciar Sesión trae 6 partes, y de que una aplicación que cuente las partes tiene
       que revisarlo;
     - la tarjeta, Cotizar, `fees` y `VersionApp` como dato 20;
     - que «No incluido» ya no tiene la tarjeta;
     - las preguntas que cambian (la 1 y la 6).
4. **Los demás nombres de la 0.13:**
   - los encabezados de `text-protocol.ts` y `text-protocol-routes.ts`;
   - en `docs/PROTOCOLO-TEXTO-PLANO.md`: el título, el enlace, que la otra parte tiene la 0.12 (lo dijo Rardiel) y la
     0.14 en el historial;
   - en `docs/API_CONTRACTS.md`, solo el enlace, porque no describe las respuestas.
5. **Mensaje para la otra parte**, corto y llano, con lo nuevo desde la 0.12: los porcentajes al iniciar sesión (6
   partes), pagar con tarjeta y lo nuevo de Cotizar. Va en `protocolo-cyp-movil/MENSAJES.txt`, sustituye al 14 y se
   manda con el documento 0.14.

### Archivos

| Archivo | Cambio |
| --- | --- |
| `app/server/src/text-protocol-routes.ts` | `feesRecord`; `can()` con el nombre del permiso; la sexta parte en `login`; encabezado. |
| `app/server/src/text-protocol.ts` | Encabezado. |
| `app/server/test/text-protocol.test.ts`, `demo-mobile-test-account.test.ts` | 6 partes; prueba de la 0.14. |
| `docs/protocolo-cyp/Protocolo CYP 0.14.txt` | Lo de arriba. |
| `docs/PROTOCOLO-TEXTO-PLANO.md`, `docs/API_CONTRACTS.md` | Lo de arriba. |

## Lo que cuesta

- **Una aplicación que exija exactamente 5 partes en Iniciar Sesión falla.** El contrato permite partes de más desde la
  0.2, y «Lo nuevo» lo avisa.
- **Los porcentajes del inicio de sesión pueden quedar viejos** si el Administrador los cambia durante la sesión (8
  horas). Los importes salen siempre de Cotizar, y el documento lo dice.
- **El inicio de sesión hace una consulta de permisos y una lectura del estado de más.** Si esa lectura falla después de
  entrar, responde `EIC` y la sesión creada vence sola, igual que si hoy falla una de las consultas de permisos.

## Pruebas

- **Cada cuenta del ejemplo** (Administración, Cajero, Cobrador, supervisor y cliente): la respuesta trae 6 partes. La
  sexta es `;;` justo cuando `/cyp_fees` da `SPE`; si no, es igual a la de `/cyp_fees`.
- **Porcentajes:** con otros porcentajes guardados, los trae; sin política guardada, `0.00;0.00;0.00`, distinto de `;;`.
- **Las dos lecturas de la clave:** 6 partes y una sola sesión.
- **Si la central falla después de entrar:** `EIC` sin nada de dentro.
- **Las pruebas de 5 partes pasan a 6**, en `text-protocol.test.ts` y `demo-mobile-test-account.test.ts`.
- **Generales:** la suite del servidor, los tipos y la compilación pública.
- **En la demo, con `cob`:** el inicio de sesión con 6 partes, igual a `/cyp_fees`. La sesión se cierra con
  `/cyp_logout`.
