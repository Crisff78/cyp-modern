# Revisión EGM del plan: porcentajes en el inicio de sesión (protocolo 0.14)

Una etapa con dos revisores nuevos sobre el primer borrador de `design_draft.md` (2026-11-27):
`egm-codebase-details` (el plan contra el código) y `egm-zoom-out` (alcance). Los hallazgos los resolvió Claude Code
(Opus 5.5).

## Bloqueantes

- **El mensaje para la otra parte no estaba en el plan** (zoom-out). Rardiel lo pidió, y como la otra parte tiene la
  0.12, el mensaje tiene que incluir lo de la 0.13. **Resuelto:** es el paso 5.
- **«Lo nuevo» tiene que avisar de que Iniciar Sesión trae 6 partes** (codebase-details). El borrador decía que una
  aplicación que lee 5 partes sigue igual. En la 0.4 ya se marcó como bloqueante el mismo error, con 4 y 5 partes.
  **Resuelto:** «Lo nuevo» y su último párrafo lo avisan.

## Menores, todos resueltos

- **Qué permiso decide `;;`** (codebase-details). **Resuelto:** el mismo que pregunta el despachador, por la ruta y por
  el nombre (`ACCESS.fees`); `can()` acepta el nombre del permiso. El zoom-out proponía reutilizar `PuedeEnviar`, pero
  se prefirió el permiso exacto de Porcentajes: así la sexta parte es `;;` justo cuando `/cyp_fees` da `SPE`.
- **La lectura de más** (codebase-details). **Resuelto:** se lee solo después de entrar y solo si la cuenta puede
  pedirlos. El coste y el `EIC` van a «Lo que cuesta».
- **El documento se contradecía** (los dos):
  - el punto 2 de 6.3 pedía los porcentajes otra vez antes de mostrarlos, y eso choca con traerlos al iniciar sesión;
  - «Pueden ser 0.00» chocaba con los vacíos.
  **Resuelto:**
  - 6.3.2, reescrito;
  - 1.1 dice que vacío no es 0.00;
  - `PuedeEnviar` nombra los Porcentajes.
- **Las marcas `(NUEVO)` tienen que salir de la diferencia entre la 0.12 y la 0.13 de git** (zoom-out). Había tres
  problemas:
  - marcas `(NUEVO: …)` que una búsqueda de `(NUEVO)` no encuentra;
  - marcas que mezclaban versiones;
  - cambios de la 0.13 sin marcar.
  **Resuelto** así, con la lista en el plan.
- **`docs/API_CONTRACTS.md` no describe las respuestas** (los dos). **Resuelto:** solo se cambia el enlace.
- **Quedaban nombres de la 0.13** en encabezados y enlaces (los dos). **Resuelto:** se listan en el paso 4.
- **A «Lo nuevo» le faltaban cosas** al contar desde la 0.12 (codebase-details). **Resuelto:** se añaden
  - `VersionApp` como dato 20,
  - «No incluido»,
  - las preguntas 1 y 6.
- **Faltaba la tabla de archivos** (codebase-details). Añadida.
- **La prueba en la demo dejaba una sesión abierta** (codebase-details). **Resuelto:** se cierra con `/cyp_logout`.
- **Faltaban pruebas** (codebase-details). Añadidas:
  - todas las cuentas comparadas con `/cyp_fees`;
  - sin política guardada;
  - las dos lecturas de la clave;
  - `EIC`;
  - las pruebas de 5 partes, también en `demo-mobile-test-account.test.ts`.

## Sin objeción

- La sexta parte al final, y no tres datos más en `DatosUsuario`.
- `;;` para quien no puede pedirlos. `0.00` se leería como «sin cargo», y quitar la parte cambiaría la forma de la
  respuesta.
- Mantener `/cyp_fees`.
- Quitar las marcas de lo que ya tiene la otra parte.
- Nada se rompe en el límite de intentos, en las dos lecturas de la clave ni en las sesiones.
