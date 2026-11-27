# Tasas Vigentes con idMoneda -1: todas las monedas (protocolo 0.12)

Plan escrito por Claude Code (Opus 5.5) el 2026-11-27, en la laptop de Rardiel, sobre `main` `67d3b1d` (protocolo 0.11).
Cambio pequeño: una sola etapa de revisión EGM (ver `goldfish_review_report.md`). Esta es la versión que se programó.

## De dónde sale

Rardiel, 2026-11-27: «Él me dijo esto ahora para añadirle eso también», con una captura de WhatsApp de la otra parte:
«cyp_rates?idSesion[|idMoneda]», «Puedes hacer algo aqui», «En esta peticion», «Y es que su te mando un id de moneda
-1», «Me devuelvas los valores de todas las monedas».

## Lo comprobado

- `rates` (`text-protocol-routes.ts`) trae todas las tasas vigentes si `idMoneda` viene vacío, y una sola si trae una
  moneda (`currencyOf`). Hoy `-1` no es una moneda y responde `PIN` con `idMoneda`.
- `-1` no tiene forma de VersionApp (`withoutVersion` pide una cifra delante y un punto), así que en `s|-1` no se
  quita, y en `s|-1|3.0` se quita solo el `3.0`. Por GET el `-1` llega igual con o sin `p=`, y por POST llega tal cual;
  los datos no se recortan, así que ` -1` (con espacio) no es `-1`.
- En el ejemplo de LSAN 1.14 (`lomovil.com/apps/proto.txt`), `-1` solo aparece como un valor de `idEstado` («Sin
  Cobrar»), no como «todas». La regla sale del pedido de la otra parte.
- `currencyOf` la usan también Cotizar y Registrar Envío: el cambio va en `rates`, no ahí.

## Qué se hace

- En Tasas Vigentes, `idMoneda` igual a `-1`, exacto, es lo mismo que vacío: todas las monedas con tasa vigente. Nunca
  da `TNE`: el peso viene siempre.
- Solo ahí. En Cotizar y Registrar Envío, `-1` sigue siendo `PIN`: un envío necesita una moneda.
- Otras formas (`-01`, `-2`, ` -1`) siguen siendo `PIN`.
- Sin migración. La web no cambia.

| Archivo | Cambio |
| --- | --- |
| `app/server/src/text-protocol-routes.ts` (modificar) | `rates`: `-1` como vacío. El encabezado cita la 0.12. |
| `app/server/src/text-protocol.ts` (modificar) | El encabezado cita la 0.12. |
| `app/server/test/text-protocol.test.ts` (modificar) | `-1` igual que vacío (GET con y sin `p=`, POST con y sin `3.0`); sin tasa de EUR, `-1` da OK sin `TNE`; `-01`, `-2` y `%20-1`, `PIN`; `-1` en Cotizar, `PIN`. |
| `app/server/test/text-protocol-format.test.ts` (modificar) | `s|-1` no pierde el `-1`; `s|-1|3.0` pierde solo el `3.0`. |
| `docs/protocolo-cyp/Protocolo CYP 0.12.txt` (renombrar desde la 0.11) | Versión; «Formato de los datos» (`-1` solo en Tasas); 6.2 (qué se manda, `TNE` nunca con `-1`, un ejemplo); «Lo nuevo». |
| `docs/PROTOCOLO-TEXTO-PLANO.md` (modificar) | Título, enlace, la 0.12 en la lista de versiones, un apartado y la línea de `TNE`. |
| `docs/API_CONTRACTS.md` (modificar) | El enlace. |

«Lo nuevo» sigue desde la 0.7, como en la 0.11.

## Lo que cuesta

Nada que se vea: `-1` hoy da `PIN`, así que nadie lo usa para otra cosa.

## Pruebas

- `-1`, por GET con `p=` y `3.0`, da lo mismo que vacío.
- `-01`, `-2` y ` -1` dan `PIN`; `-1` en Cotizar da `PIN` con `idMonedaOrigen`.
- `withoutVersion` con `-1`.
- Suite del servidor, tipos y compilación pública.
- En la demo, solo leyendo: `cyp_rates` con `-1` igual que sin él.
