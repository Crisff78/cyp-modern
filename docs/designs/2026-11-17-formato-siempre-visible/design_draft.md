# El selector «Formato para quien recibe» se queda siempre a la vista

Autor: Claude Code (Fable 5.2), 2026-11-17. Base: `main` `7bbff5d` (PR #159 ya fusionado). Revisado con EGM (etapa 9);
el informe está en `goldfish_review_report.md`, en esta misma carpeta.

## Pedido

Rardiel, 2026-11-17, en el chat de Claude Code, con una captura del selector «Formato para quien recibe» en la demo:

> «Deja esto también cuando pongo que el recibo es para quien envía, no tienes que quitarlo si lo pongo así»

## Cómo está hoy

El panel de impresión de un envío (`ReceiptPrintControls`) dibuja el selector «Formato para quien recibe» («Común» /
«Haití») solo cuando «Tipo de recibo» vale «Para quien recibe». Al pasar a «Para quien envía» desaparece. Así lo decidió
Claude en `docs/designs/2026-11-17-comprobante-recepcion/design_draft.md`; este pedido sustituye esa decisión.

Ese panel sale en dos sitios, los dos dentro de `RemittancesWorkspace`, que usan Administración y el terminal del
cobrador:

- la ventana del recibo de un envío (se abre para quien envía desde «Envíos de dinero» y para quien recibe desde
  «Entregas de dinero»);
- el diálogo «¿Quieres imprimir el recibo?», que aparece después de registrar cada envío y siempre se abre para quien
  envía.

## Qué cambia

El selector «Formato para quien recibe» se dibuja siempre, con cualquier «Tipo de recibo», en el mismo sitio: justo
después de «Tipo de recibo». Por tanto pasa a verse también en el diálogo «¿Quieres imprimir el recibo?» de cada envío
nuevo y en la ventana del recibo abierta desde «Envíos de dinero».

Lo que no cambia:

- El formato elegido solo afecta a lo que se imprime «Para quien recibe». Con «Para quien envía» se imprime siempre
  `RECIBO DE ENVIO`, también si el selector dice «Haití»: no existe un formato de Haití para quien envía. Esto dejó de valer el 17-11-2026, por pedido de Rardiel: con «Haití» también cambia el recibo de quien envía; ver `docs/designs/2026-11-17-formato-haiti-para-ambos/design_draft.md`.
- El selector sigue activo con «Para quien envía», para poder dejar elegido el formato antes de cambiar el tipo. La
  elección se sigue recordando en el navegador.
- Textos, valores y orden de las opciones («Común», «Haití»).

## Detailed Implementation Plan

Las rutas de «Archivos» y de los pasos 4 y 5 son relativas a la raíz del repositorio; los pasos 1 a 3 usan solo el
nombre del archivo (`ReceiptPrintControls.tsx` está en `app/shared/remittances/` y las pruebas en
`app/client-admin/test/`). Los comandos se ejecutan en Git Bash desde la raíz del repositorio; las rutas
`../client-admin/…` del comando de pruebas son relativas al paquete `@cyp/server`.

Es una sola fase: los pasos 1 a 3 van juntos en un mismo commit, porque el paso 1 solo deja fallando las dos
comprobaciones que los pasos 2 y 3 cambian.

### Archivos

Se modifican:

- `app/shared/remittances/ReceiptPrintControls.tsx`
- `app/client-admin/test/envios-review-corrections-ui.test.ts`
- `app/client-admin/test/october-nine-financial-ui.test.ts`
- `docs/IMPRESION-TERMICA.md`
- `docs/designs/2026-11-17-comprobante-recepcion/design_draft.md`

### Pasos

1. `ReceiptPrintControls.tsx`, función `ReceiptPrintControls`: la expresión que empieza por
   `{audience === "recipient" && <label>Formato para quien recibe<select` ocupa cuatro líneas. Se quita el prefijo
   `{audience === "recipient" && ` de la primera y la `}` que cierra la expresión, justo después de `</select></label>`
   en la cuarta. Queda el `<label>Formato para quien recibe<select …>…</select></label>` tal cual, como hijo directo de
   `<div className="remittance-print-controls-grid">`, entre el `<label>` de «Tipo de recibo» y el de «Papel de
   impresión». No cambia nada más del componente ni hace falta tocar los estilos: la rejilla ya aloja ese selector
   cuando el tipo es «Para quien recibe».
2. `envios-review-corrections-ui.test.ts`
   - Caso «Cajero in Entregas de dinero: the detail names both operator and registrar…»: la comprobación que sigue a
     `selectOption("sender")`,

     ```ts
     assert.equal(await detail.getByLabel("Formato para quien recibe", { exact: true }).count(), 0, "the format is only asked for the recipient's copy");
     ```

     se sustituye por estas cuatro líneas (`format`, el localizador del selector, ya está declarado más arriba en ese
     caso; en ese punto el selector está en `common`):

     ```ts
     assert.equal(await format.inputValue(), "common", "the format selector stays visible with the sender's receipt");
     await format.selectOption("haiti");
     assert.equal(await format.inputValue(), "haiti");
     assert.equal((await detail.locator(".remittance-print-preview-caption").innerText()).includes("Formato de Haití"), false, "the sender's receipt has one format only");
     ```

     Las comprobaciones siguientes del caso no se tocan y deben seguir pasando con «Haití» elegido: la vista previa y
     la hoja impresa de «Para quien envía» siguen mostrando, entre otras cosas, `Registrado por: Administración` y
     `Forma pago del remitente` antes de `Registrado por`.
   - En ese mismo caso, después de su última comprobación
     (`assert.equal(printed.includes("demo-admin"), false, …)`) y antes del `} finally`, se añaden dos líneas que prueban
     que lo elegido con «Para quien envía» vale al volver a «Para quien recibe»:

     ```ts
     await detail.getByLabel("Tipo de recibo", { exact: true }).selectOption("recipient");
     assert.match(await detail.locator(".remittance-print-preview-caption").innerText(), /Formato de Haití/, "what was chosen with the sender's receipt applies to the recipient's copy");
     ```

     Cada caso de este archivo abre un contexto de navegador nuevo, así que la elección guardada no pasa a otros casos y
     no hace falta devolver el selector a «Común» al final.
   - Caso que registra un envío y cierra el diálogo «¿Quieres imprimir el recibo?» (el que declara
     `const print = page.getByRole("dialog", { name: "¿Quieres imprimir el recibo?", exact: true });`): entre esa línea
     y la que pulsa «No imprimir» se añade

     ```ts
     assert.equal(await print.getByLabel("Formato para quien recibe", { exact: true }).inputValue(), "common", "the print prompt of a new send shows the format selector too");
     ```

3. `october-nine-financial-ui.test.ts`: la línea

   ```ts
   assert.equal(await detail.getByLabel("Formato para quien recibe", { exact: true }).count(), 0);
   ```

   pasa a

   ```ts
   assert.equal(await detail.getByLabel("Formato para quien recibe", { exact: true }).inputValue(), "haiti");
   ```

   En ese punto el selector está en `haiti`: se eligió unas líneas antes. Las comprobaciones siguientes de la hoja de
   «Para quien envía» (`DOP 105.00`, `Nota: Pie ficticio…`) no cambian.
4. `docs/IMPRESION-TERMICA.md`, punto «3. **Formato de Haití**» de la viñeta «Existen **tres salidas impresas**»: justo
   después de su primera frase (la que termina en «y se recuerda en el navegador.») y antes de «Disponible en **todos
   los tamaños**», se inserta esta frase:

   ```text
   El selector **Formato para quien recibe** está siempre a la vista. Con **Tipo de recibo** en «Para quien envía», el formato elegido no cambia lo que se imprime.
   ```

5. `docs/designs/2026-11-17-comprobante-recepcion/design_draft.md`: al final del punto 2 de «Qué cambia» (el que empieza
   por «**El formato de Haití pasa a ser una opción.**») y al final de la viñeta de «Decisiones tomadas por Claude» que
   empieza por «**El selector de formato solo se ve con «Para quien recibe».**» se añade, en los dos sitios, esta frase:

   ```text
   Decisión sustituida el 2026-11-17 por pedido de Rardiel: el selector se queda siempre a la vista; ver `docs/designs/2026-11-17-formato-siempre-visible/design_draft.md`.
   ```

   El resto de ese documento es el plan de un cambio ya hecho y no se toca.

### Comprobación

```bash
pnpm typecheck
pnpm --filter @cyp/server exec tsx --test --test-concurrency=1 ../client-admin/test/envios-review-corrections-ui.test.ts ../client-admin/test/october-nine-financial-ui.test.ts ../client-admin/test/remittance-quote-allocation-ui.test.ts ../client-admin/test/teclado-cajero-ui.test.ts ../client-admin/test/cashier-shell-ui.test.ts ../client-admin/test/remittance-workspace-corrections-ui.test.ts ../client-admin/test/teclado-ventanas-ui.test.ts
pnpm build
```

Los tres comandos deben terminar sin errores. Son los siete archivos de prueba que dibujan este panel: los dos que se
modifican y cinco que abren la ventana del recibo o el diálogo de impresión y deben pasar sin modificarse. Ninguno
recorre con Tab el panel con «Para quien envía»: `teclado-cajero-ui.test.ts` lo recorre dentro de «Entregas de dinero»,
donde el selector ya se veía, y busca el botón «Imprimir comprobante» sin contar paradas. Necesitan Microsoft Edge; un
caso que salga como «skipped» no cuenta como aprobado.
