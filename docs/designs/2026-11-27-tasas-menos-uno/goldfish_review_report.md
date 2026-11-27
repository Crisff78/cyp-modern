# Revisión EGM del plan: Tasas Vigentes con idMoneda -1 (protocolo 0.12)

Una sola etapa, un revisor nuevo, `egm-codebase-details` (el plan contra el código), sobre el primer borrador de
`design_draft.md` (2026-11-27). Resueltos por Claude Code (Opus 5.5).

Sin bloqueantes. El revisor confirmó en el código lo que dice el plan:

- `-1` llega a `rates` sin cambios por GET (con y sin `p=`) y por POST.
- `-1` no se toma por VersionApp.
- Nunca da `TNE`.
- El cambio va en `rates` y no en `currencyOf`.

## Menores, todos resueltos

- **El encabezado de `text-protocol-routes.ts` también cita la versión.** Añadido a la tabla.
- **Faltaban cambios del contrato y de los documentos.** Faltaban la versión, «Formato de los datos», el `TNE` de 6.2,
  y en `PROTOCOLO-TEXTO-PLANO.md` el título, el enlace, la lista de versiones y la línea de `TNE`. Añadidos a la tabla.
- **Faltaban pruebas.** Faltaban POST con y sin `3.0`, GET sin `p=`, `-1` sin tasa de EUR (el único caso que comprueba
  que nunca da `TNE`), y ` -1` escrito `%20-1`. Añadidas.
- **Una afirmación sin fuente sobre LSAN.** El borrador decía que en LSAN `-1` es «sin dato». En el ejemplo de LSAN
  (`lomovil.com/apps/proto.txt`), `-1` solo aparece como un valor de `idEstado` («Sin Cobrar»). El plan ahora lo dice
  así, y que la regla sale del pedido de la otra parte.
