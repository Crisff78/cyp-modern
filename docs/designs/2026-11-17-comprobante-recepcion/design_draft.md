# Comprobante de recepción, formato de Haití opcional y fin de «Solo texto»

Autor: Claude Code (Fable 5.2), 2026-11-17. Base: `main` `96c529e`. Revisado con EGM (etapa 9); el informe está en
`goldfish_review_report.md`, en esta misma carpeta.

## Pedido

Rardiel, 2026-11-17, en el chat de Claude Code, con la foto de un recibo impreso marcado a mano:

> «el formato de impresión del que envía debe ser debe ser diferente del que recibe, pero solo quitandole los campos del
> recibo del que envía (que te los mandaré en la imagen), el formato que pusimos del que recibe es el formato de Haití, y
> ese solo tiene que estar en los casos de Haití, eso debe ser configurable en esa misma parte donde se imprime, que si
> se desea el formato común o el formato de Haití (que es el que está actualmente). El formato de impresión de solo texto
> debe desaparecer y ser solo el de diseño. En la imagen los campos que están tachados con una línea sobre ellos son los
> que no van en el comprobante de recepción (que debemos ponerle ese titulo de comprobante de recepción en ese caso, en
> vez de recibo de envío).»

Tachados en la foto: las filas «Código del Cliente», «Total pagado por el remitente» y «Forma pago del remitente», y el
título «Importes del envío».

## Cómo está hoy

El panel de impresión (`ReceiptPrintControls`) tiene «Tipo de recibo» con dos valores:

- `sender`, «Para quien envía»: imprime `RECIBO DE ENVIO` con todas las filas.
- `recipient`, «Para quien recibe»: imprime un comprobante distinto, el que Rardiel llama formato de Haití (empresa en
  mayúsculas, `Envío #:`, `TELÉFONO:`, `MONTO:`, `RECIBE EN <moneda>:`, aviso del teléfono y línea de reclamaciones).

Además hay «Formato de impresión» con «Solo texto» (valor por defecto) y «Con diseño».

## Qué cambia

1. **«Para quien recibe» imprime por defecto el comprobante de recepción en formato común.** Es el mismo recibo de quien
   envía, con el título `COMPROBANTE DE RECEPCIÓN`, sin las tres filas tachadas y sin el título «Importes del envío».
2. **El formato de Haití pasa a ser una opción.** Cuando el tipo es «Para quien recibe» aparece un selector «Formato para
   quien recibe» con «Común» y «Haití». «Común» es el valor por defecto. «Haití» imprime el comprobante actual, sin
   cambios. La elección se recuerda en el navegador, igual que el papel. Decisión sustituida el 2026-11-17 por pedido de Rardiel: el selector se queda siempre a la vista; ver `docs/designs/2026-11-17-formato-siempre-visible/design_draft.md`.
3. **Desaparece «Solo texto».** Se quita el selector «Formato de impresión» y todo se imprime con diseño.
4. **La opción del selector «Tipo de recibo»** pasa de «Para quien recibe (comprobante de entrega)» a «Para quien recibe
   (comprobante de recepción)».

Nombres que usa este documento: **comprobante de recepción** es lo que se entrega a quien recibe; tiene dos formatos, el
**formato común** (el que lleva el título `COMPROBANTE DE RECEPCIÓN`) y el **formato de Haití**. `RECIBO DE ENVIO` se
queda sin tilde: es el texto actual y no entra en este cambio.

### Filas del comprobante de recepción en formato común

| Fila del recibo de quien envía | En el comprobante de recepción |
|---|---|
| Encabezado de la empresa | Se queda |
| Título | `COMPROBANTE DE RECEPCIÓN` en vez de `RECIBO DE ENVIO` |
| Fecha, Envío, Cód. Operación | Se quedan |
| Remitente | Se queda |
| Código del Cliente | Se quita |
| Destinatario, Teléfono, Dirección | Se quedan |
| Título «Importes del envío» | Se quita (las filas siguen, sin título) |
| Monto a enviar | Se queda |
| Total pagado por el remitente | Se quita |
| Cargo de entrega (solo existe si el envío lo tiene) | Se queda |
| Recibe el destinatario | Se queda |
| Forma pago del remitente | Se quita |
| Cancelación (solo si el envío está cancelado) | Se queda |
| Recibido por, Registrado por, Nota | Se quedan |

Dos consecuencias: en Carta y A4 el formato común lleva 4 líneas punteadas entre bloques en vez de 5, porque desaparece
el bloque de «Forma pago del remitente»; y en los rollos de 58 y 51 mm el título, que es más largo, ocupa dos líneas
centradas.

## Decisiones tomadas por Claude (para que Rardiel las corrija si no son)

- **Cód. Operación se queda.** En la foto la línea está debajo de esa fila, no encima, y Rardiel dijo «tachados con una
  línea sobre ellos». Es la única marca dudosa.
- **Monto a enviar y Cargo de entrega se quedan.** No están tachados. «Cargo de entrega» no sale en la foto porque ese
  envío no lo tenía.
- **La fecha no cambia.** Sigue siendo la del envío; el pedido es solo quitar campos y cambiar el título.
- **El selector de formato solo se ve con «Para quien recibe».** No existe un formato de Haití para quien envía. Decisión sustituida el 2026-11-17 por pedido de Rardiel: el selector se queda siempre a la vista; ver `docs/designs/2026-11-17-formato-siempre-visible/design_draft.md`.
- **Quien tenía guardado «Solo texto» pasa a imprimir con diseño** sin aviso: la opción ya no existe.
- **El código de «Solo texto» se borra**, no se esconde. Queda en el historial de Git.
- **Riesgo aceptado por el pedido:** una impresora instalada con un controlador de Windows de solo texto no imprime
  gráficos, así que con este cambio no podrá imprimir estos recibos hasta que se le instale su controlador gráfico.

## Fuera de alcance

- El contenido del formato de Haití y del recibo de quien envía.
- El recibo de consulta en pantalla (`RemittanceReceipt`), los tamaños de papel, márgenes y tipografías.
- Elegir el formato de Haití de forma automática según el destino del envío: el sistema no guarda el país.
- La base de datos y el servidor. No hay migración.

## Detailed Implementation Plan

Las rutas de la lista «Archivos» son relativas a la raíz del repositorio. En las fases se usa solo el nombre del archivo:
el código está en `app/shared/remittances/` y las pruebas en `app/client-admin/test/`. Los comandos se ejecutan en Git
Bash desde la raíz del repositorio, que es la raíz del espacio de trabajo de pnpm.

El trabajo va en tres fases. Cada una termina con el código compilando y sus pruebas en verde, y se guarda en un commit.
Las pruebas de interfaz se ejecutan en Microsoft Edge; si una sale como «skipped» no cuenta como aprobada.

### Archivos

Se modifican:

- `app/shared/remittances/receiptPaper.ts`
- `app/shared/remittances/receipt.ts`
- `app/shared/remittances/thermalReceipt.ts`
- `app/shared/remittances/ReceiptPrintControls.tsx`
- `app/shared/remittances/remittances.css`
- `app/client-admin/test/receipt-paper.test.ts`
- `app/client-admin/test/remittance-receipt.test.ts`
- `app/client-admin/test/remittance-thermal-print-ui.test.ts`
- `app/client-admin/test/remittance-quote-allocation-ui.test.ts`
- `app/client-admin/test/envios-review-corrections-ui.test.ts`
- `app/client-admin/test/october-nine-financial-ui.test.ts`
- `docs/IMPRESION-TERMICA.md`
- `docs/ENVIOS-API.md`

Se borran:

- `app/shared/remittances/receiptText.ts`
- `app/client-admin/test/remittance-receipt-text.test.ts`

No se toca `app/shared/remittances/RemittancesWorkspace.tsx`: ya guarda las opciones completas con
`saveReceiptPrintOptions` y pasa `audience` aparte.

### Fase A. Quitar «Solo texto»

Código:

1. `receiptPaper.ts`
   - En `ReceiptPrintOptions`, quitar `output?: "graphics" | "text"`.
   - `defaultReceiptPrintOptions` pasa a `{ paper: "80", compact: false }`.
   - En `readSavedReceiptPrintOptions`, borrar la línea `const output = …` y quitar `output` del objeto devuelto. Un
     `output` guardado por una versión anterior se ignora.
   - En `receiptPrintLayout`, quitar la propiedad `textColumns` de los tres objetos que devuelve. `widthMm` se queda.
   - Sustituir el comentario de `thermalReceiptSize` por:

     ```ts
     /**
      * widthMm is the printable width of the roll, without the hardware edge margins (e.g. POS80-01 V6 USB reports 72.1 mm on an 80 mm roll).
      * graphicWidthMm is the width drawn: right up to the physical printhead window (~67.4 mm from GDI x=0 on POS80-01 V6 USB) without clipping.
      */
     ```

2. `receipt.ts`
   - Borrar `import { receiptText, receiptTextColumns } from "./receiptText";`.
   - En `receiptHtml`, borrar el bloque `if (options.output === "text") { … }` entero y la línea
     `const audience = resolvePrintedAudience(receipt, options);`, que deja de usarse (vuelve en la fase B).
   - En `printRemittanceReceipt`, borrar `if (options?.output === "text") { window.setTimeout(print,150); return; }`.
3. `ReceiptPrintControls.tsx`
   - Borrar `import { receiptText } from "./receiptText";`.
   - En `ReceiptPrintPreview`, borrar el bloque `if ((options.output ?? "graphics") === "text") { … }` entero.
   - En `ReceiptPrintControls`, borrar el `<label>Formato de impresión…</label>` entero.
4. `remittances.css`: borrar las dos reglas cuyo selector empieza por `.remittance-print-preview-text`.
5. Borrar `app/shared/remittances/receiptText.ts` y `app/client-admin/test/remittance-receipt-text.test.ts`.

Pruebas:

6. `receipt-paper.test.ts`
   - Borrar el import de `receiptTextColumns`.
   - Primer caso: el título pasa a «two, three and four inch rolls keep readable type, zero extra @page margin and the
     drawing width of each roll». `assert.equal(defaultReceiptPrintOptions.output, "text")` pasa a
     `assert.equal("output" in defaultReceiptPrintOptions, false)`. La lista del bucle pierde su cuarto valor
     (`[["51",45,42],["58",48,45],["76",70,63],["80",72,66],["102",96,92]]`) y `options` pasa a `{paper,compact:false}`. En
     vez de `layout.textColumns` y `receiptTextColumns(paper)` se comprueba `"textColumns" in layout === false`. Las dos
     llamadas a `receiptHtml` se quedan en una, `receiptHtml(receipt,options)`, que debe contener
     `max-width:${graphicWidth}mm`, `margin:0mm` y `DOP 1,000.00`, y no contener `<pre`.
   - Tercer caso: `saveReceiptPrintOptions({ paper: "a4", compact: false, audience: "recipient" })`;
     `assert.equal(restored.output, "graphics")` pasa a `assert.equal("output" in restored, false)`; y se añade: con
     `{"paper":"58","compact":true,"output":"text"}` guardado en la clave `cyp.remittances.receiptPrintOptions`,
     `readSavedReceiptPrintOptions()` devuelve exactamente `{ paper: "58", compact: true }`.
7. `remittance-receipt.test.ts`
   - Añadir tras los imports el ayudante que da el texto que lee una persona en la hoja:

     ```ts
     const printedText = (html: string) => html.slice(html.indexOf("<body>")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
     ```

   - Caso «thermal and telephone receipts…»: `fullHtml` y `upgradedHtml` pasan a
     `printedText(receiptHtml(modelo, { paper: "80", compact: false }))`. En la lista esperada de `fullHtml`,
     `Recibido por: ________________________` pasa a `Recibido por:`. En la de `upgradedHtml` se quita la línea de 40
     guiones. La comprobación `(upgradedHtml.match(/-{40}/g) ?? []).length === 1` se sustituye por dos sobre el HTML sin
     procesar de ese mismo recibo: contiene `border-bottom:1px dashed #000` y no contiene `receipt-sheet-divided`. Las dos
     comprobaciones de orden que usaban la línea de guiones se sustituyen por una: `Tel. 809-555-0222 / RNC: 1-30-00100-1`
     va antes que `RECIBO DE ENVIO`. En el bucle de papeles se borran `plainHtml` y su comprobación de ancho.
   - Caso «credit card surcharge…»: se quita el bucle `for (const output of ["text", "graphics"])`; queda el de `compact`
     con `receiptHtml(printedReceipt, { paper: "80", compact })`.
   - Caso «A4 and Carta…»: se quita `output: "graphics"` de las dos llamadas y se borran `textHtml` y la cuenta de 72
     guiones.
   - Caso del formato de Haití: el título pierde «in graphics and text modes»; se quita `output: "graphics"` de las dos
     llamadas y se borra el tramo de `textHtml` (desde `const textHtml` hasta el final del `if` del título espaciado).
   - Caso nuevo «the company title is spaced letter by letter and split only between words», sobre
     `formatSpacedTitleLines`, que perdía su única comprobación: con `() => true` devuelve
     `["I N V E R S I O N E S   D E M O   S . R . L ."]` para `"Inversiones Demo S.R.L."`; con
     `(line) => line.length <= 31` devuelve `["I N V E R S I O N E S   D E M O", "S . R . L ."]`; con
     `(line) => line.length <= 5` devuelve `[]`.
8. `remittance-thermal-print-ui.test.ts`
   - En el archivo de prueba que genera: los botones `pos80-*` pasan a `pos80-full-graphics` y `pos80-compact-graphics`
     (`printRemittanceReceipt(pos80Invoice,{paper:'80',compact})`); se quita `output` de todos los demás; se quitan los
     botones `recipient-pos80-text` y `recipient-a4-text`; y los bucles que creaban un botón `text-…` por cada papel y por
     cada hoja crean solo el botón con diseño.
   - Se borran: el bucle `text-<papel>`, la variante `textOnly` del bucle de hojas (queda `sheet-<nombre>` y la
     comprobación de tamaño de letra sin condición), el bloque `recipient-pos80-text`, la fila `recipient-a4-text` con su
     variable `isText`, la entrada `recipient-pos80-text.png` de la lista de capturas y la línea final que imprimía
     `text-80` tras el fallo del dibujo (el fallo ya se comprueba en las dos líneas anteriores: aviso y cero impresiones).
   - El bucle `pos80-full-text` / `pos80-compact-text` se sustituye por una comprobación de `pos80-compact-graphics`: se
     espera `__prints===1`, se unen los textos dibujados (`__runs`) y deben estar `RECIBO DE ENVIO`, `Envío:`,
     `Remitente:`, `Destinatario:`, `Teléfono:`, `Forma pago del remitente:` y `Registrado por:`, y no estar
     `Cód. Operación:`, `Calle Las Damas 18`, `1111111111` ni `Recibido por:`. Captura: `pos80-compact-graphics-72.1mm.png`.
9. `remittance-quote-allocation-ui.test.ts`: el tramo que va desde
   `assert.equal(await detail.getByLabel("Formato de impresión",{exact:true}).inputValue(),"text")` hasta
   `await textReceiptPopup.close();` se sustituye por
   `assert.equal(await detail.getByLabel("Formato de impresión",{exact:true}).count(),0);`, y se borra la línea que
   elegía `graphics`. La comprobación `assert.match(printedRows, /Devuelta/)` pasa a
   `assert.match(printedRows, /Forma pago del remitente: Efectivo/)`: la línea base del 2026-11-17 confirmó que esta
   prueba ya fallaba en `main` (el recibo impreso no lleva la fila «Devuelta» desde el formato final).
10. `envios-review-corrections-ui.test.ts` y `october-nine-financial-ui.test.ts`: no eligen papel, así que imprimen en el
    rollo de 80 mm, que ahora siempre sale como imágenes. Las cuatro lecturas `locator("body").innerText()` de la ventana
    de impresión pasan a usar este ayudante, que se añade en cada archivo:

    ```ts
    // A roll prints as images: what the sheet says is in their alternative text.
    const printedSheet = async (popup: any) => {
      const blocks = popup.locator("main.thermal-image-output img");
      await blocks.first().waitFor({ state: "attached" });
      return (await blocks.evaluateAll((images: HTMLImageElement[]) => images.map((image) => image.alt))).join("\n").replace(/[ \t]+/g, " ");
    };
    ```

    Las imágenes entran en la ventana todas a la vez, ya dibujadas, así que basta esperar a la primera. Las
    comprobaciones de contenido no cambian en esta fase.

Comprobación de la fase A:

```bash
pnpm typecheck
pnpm --filter @cyp/server exec tsx --test --test-concurrency=1 ../client-admin/test/receipt-paper.test.ts ../client-admin/test/remittance-receipt.test.ts ../client-admin/test/remittance-thermal-print-ui.test.ts ../client-admin/test/remittance-quote-allocation-ui.test.ts ../client-admin/test/envios-review-corrections-ui.test.ts ../client-admin/test/october-nine-financial-ui.test.ts
git grep -n -e "receiptTextColumns" -e "textColumns" -e "remittance-print-preview-text" -e "Solo texto" -e "options.output" -e "value.output" -- app/shared app/client-admin/src app/client-collector/src app/server/src
```

El `git grep` no debe devolver ninguna línea. Se limita al código: las pruebas nombran «Solo texto» y `textColumns`
para comprobar que ya no están.

### Fase B. Comprobante de recepción y formato de Haití

Código:

1. `receiptPaper.ts`
   - `printedReceiptAudienceLabels.recipient` pasa a `"Para quien recibe (comprobante de recepción)"`.
   - Debajo de `printedReceiptAudienceLabels` añadir:

     ```ts
     export type RecipientReceiptFormat = "common" | "haiti";
     export const recipientReceiptFormatLabels: Record<RecipientReceiptFormat, string> = { common: "Común", haiti: "Haití" };
     ```

   - En `ReceiptPrintOptions` añadir `recipientFormat?: RecipientReceiptFormat`.
   - En `readSavedReceiptPrintOptions` añadir la línea
     `const recipientFormat = parsed.recipientFormat === "haiti" ? "haiti" as const : undefined;` y, en el objeto devuelto,
     `...(recipientFormat ? { recipientFormat } : {})`. `saveReceiptPrintOptions` no cambia: guarda todo menos `audience`.
2. `receipt.ts`
   - El import de `./receiptPaper` pasa a
     `import { receiptPrintLayout, type PrintedReceiptAudience, type RecipientReceiptFormat } from "./receiptPaper";`.
   - Debajo de `printedReceiptHeading` añadir:

     ```ts
     export const receptionReceiptHeading = "COMPROBANTE DE RECEPCIÓN";
     export const printedReceiptTitle = (audience: PrintedReceiptAudience) => audience === "recipient" ? receptionReceiptHeading : printedReceiptHeading;
     ```

   - En el tipo `Receipt`, añadir `recipientFormat?: RecipientReceiptFormat;` debajo de `audience`.
   - Debajo de `resolvePrintedAudience` añadir:

     ```ts
     export const resolveRecipientFormat = (
       receipt: Pick<Receipt, "recipientFormat">,
       options?: { recipientFormat?: RecipientReceiptFormat },
     ): RecipientReceiptFormat => options?.recipientFormat ?? receipt.recipientFormat ?? "common";
     ```

   - `isRecipientPrintedReceipt` se renombra a `isHaitiRecipientVoucher` y queda así:

     ```ts
     export const isHaitiRecipientVoucher = (
       receipt: Receipt,
       options?: { audience?: PrintedReceiptAudience; recipientFormat?: RecipientReceiptFormat },
     ) => Boolean(receipt.printed && receipt.recipientVoucher && resolvePrintedAudience(receipt, options) === "recipient"
       && resolveRecipientFormat(receipt, options) === "haiti");
     ```

   - `receiptSections` recibe un tercer parámetro y aplica el filtro de recepción **después** del filtro de recibo
     resumido (`compact`). El orden importa: el filtro de recibo resumido conserva las filas de importes porque su sección
     tiene título; si el título se vaciara antes, las perdería.

     ```ts
     const receptionOmittedRows = new Set(["Código del Cliente", "Total pagado por el remitente", "Forma pago del remitente"]);
     export function receiptSections(receipt: Receipt, compact: boolean, options?: { audience?: PrintedReceiptAudience }) {
       const sections = compact ? /* la rama `compact` del `return` actual, sin cambios */ : receipt.sections;
       if (!receipt.printed || resolvePrintedAudience(receipt, options) !== "recipient") return sections;
       return sections.map((section) => ({ ...section, title: section.title === "Importes del envío" ? "" : section.title,
         rows: section.rows.filter(([label]) => !receptionOmittedRows.has(String(label))) })).filter((section) => section.rows.length > 0);
     }
     ```

     Con formato de Haití las secciones no se dibujan, así que el filtro no le afecta.
   - En `receiptHtml`: vuelve `const audience = resolvePrintedAudience(receipt, options);`; la declaración de
     `recipientMode` pasa a `const haitiMode = isHaitiRecipientVoucher(receipt, options);` y sus dos usos (`sheetDividers` y
     la condición del bloque del formato de Haití) pasan a `haitiMode`; la línea de `sections` pasa a
     `const sections = receiptSections(receipt, options.compact, options);`; y en `refHtml`,
     `escapeHtml(printedReceiptHeading)` pasa a `escapeHtml(printedReceiptTitle(audience))`.
   - En `printRemittanceReceipt`, la llamada a `thermalReceiptImages` pasa como recibo
     `{...receipt, audience, recipientFormat: resolveRecipientFormat(receipt, options), sections: receiptSections(receipt, compact, options)}`.
   - Al comentario de `remittanceReceipt` se le añade al final: «With the common recipient format, the recipient's copy
     (COMPROBANTE DE RECEPCIÓN) is the same layout without the rows in receptionOmittedRows and without the «Importes del
     envío» title; see receiptSections. The Haiti format is drawn from recipientVoucher instead.»
3. `thermalReceipt.ts`
   - En el import de `./receipt`, `isRecipientPrintedReceipt` pasa a `isHaitiRecipientVoucher`, se quita
     `printedReceiptHeading` y se añaden `printedReceiptTitle` y `resolvePrintedAudience`.
   - `if (isRecipientPrintedReceipt(receipt) && receipt.recipientVoucher)` pasa a
     `if (isHaitiRecipientVoucher(receipt) && receipt.recipientVoucher)`.
   - `text(printedReceiptHeading, …)` pasa a `text(printedReceiptTitle(resolvePrintedAudience(receipt)), …)`, con los
     mismos argumentos restantes. En 58 y 51 mm el título no cabe en una línea y `text` lo parte en dos, centradas.
4. `ReceiptPrintControls.tsx`
   - Imports: de `./receiptPaper` se añaden `recipientReceiptFormatLabels` y `type RecipientReceiptFormat`; de `./receipt`,
     `isRecipientPrintedReceipt` pasa a `isHaitiRecipientVoucher`, se quita `printedReceiptHeading` y se añade
     `printedReceiptTitle`.
   - En `ReceiptPrintPreview`: la declaración de `recipientMode` pasa a
     `const haitiMode = isHaitiRecipientVoucher(receipt, options);` y sus tres usos (`sheetDividers`, `badge` y la
     condición del bloque del formato de Haití) pasan a `haitiMode`; la línea de `sections` pasa a
     `const sections = receiptSections(receipt, options.compact, options);`; `badge` pasa a
     `` `${audienceLabel}${haitiMode ? "Formato de Haití · " : ""}${receiptPaperLabels[options.paper]}${options.compact && !haitiMode ? " · Envío telefónico" : ""}` ``;
     y `{printedReceiptHeading}` pasa a `{printedReceiptTitle(audience)}`.
   - En `ReceiptPrintControls`, justo después del `<label>Tipo de recibo…</label>`, añadir este bloque (solo se muestra
     con «Para quien recibe»):

     ```tsx
     {audience === "recipient" && <label>Formato para quien recibe<select aria-label="Formato para quien recibe" value={value.recipientFormat ?? "common"} onChange={(event) => {
       const next = event.target.value;
       if (next === "common" || next === "haiti") onChange({ ...value, recipientFormat: next });
     }}>{(["common", "haiti"] as RecipientReceiptFormat[]).map((kind) => <option key={kind} value={kind}>{recipientReceiptFormatLabels[kind]}</option>)}</select></label>}
     ```

     Sigue el patrón de los demás selectores del panel: etiqueta visible que envuelve al `select`, con `aria-label` igual
     al texto visible, que es por donde lo buscan las pruebas.

Pruebas:

5. `receipt-paper.test.ts`, tercer caso: `printedReceiptAudienceLabels.recipient` es
   `"Para quien recibe (comprobante de recepción)"`; tras
   `saveReceiptPrintOptions({ paper: "80", compact: false, audience: "recipient", recipientFormat: "haiti" })`, lo guardado
   contiene `recipientFormat` y no `audience`, y `readSavedReceiptPrintOptions()` devuelve `recipientFormat: "haiti"`; con
   `"recipientFormat":"otro"` guardado, el resultado no tiene `recipientFormat`.
6. `remittance-receipt.test.ts`
   - Caso del formato de Haití: las llamadas con `recipientModel` pasan `recipientFormat: "haiti"`; la última, que fuerza
     `audience: "sender"`, sigue dando `RECIBO DE ENVIO` con 5 separadores.
   - Caso nuevo «the recipient's copy is the sender receipt titled COMPROBANTE DE RECEPCIÓN without the crossed-out
     fields», con el `transfer` del archivo y `remittanceReceipt(transfer, undefined, "Operador", "Cajero", true)`:
     - Para `80`, `58`, `a4` y `letter`, `printedText(receiptHtml(recibo, { paper, compact: false, audience: "recipient" }))`
       contiene `COMPROBANTE DE RECEPCIÓN`, `Fecha: 21/10/26 12:00 p.m.`, `Envío: ENV00000001`, `Cód. Operación: OP-QA-123`,
       `Remitente:`, `Destinatario: Destinatario`, `Teléfono: 8095550102`, `Dirección: Fictional destination`,
       `Monto a enviar: DOP 900.00`, `Recibe el destinatario: DOP 900.00`, `Recibido por:`, `Registrado por: Cajero` y
       `Nota: Conserve este recibo.`; y no contiene `RECIBO DE ENVIO`, `Código del Cliente`, `CL1`, `Importes del envío`,
       `Total pagado por el remitente`, `DOP 990.00`, `Forma pago del remitente`, `RECIBE EN ` ni `PARA RECLAMACIONES`.
     - En `a4` y `letter` el HTML tiene 4 apariciones de `receipt-sheet-divided"`.
     - Con `compact: true` y papel `80` siguen `Monto a enviar: DOP 900.00` y `Recibe el destinatario: DOP 900.00`, y no
       están `Total pagado por el remitente` ni `Forma pago del remitente`.
     - Con `audience: "sender"` siguen `RECIBO DE ENVIO`, `Importes del envío`, `Código del Cliente: CL1`,
       `Total pagado por el remitente` y `Forma pago del remitente: Efectivo`.
     - Envío cancelado (`cancelledAt: "2026-10-22T16:00:00.000Z"`, `cancelReason: "Prueba"`): el comprobante de recepción
       contiene `Cancelación` y `Motivo: Prueba`.
     - Envío con cargo de entrega (`receiveAmount: 90000` y `calculation: { version: 2, amountMode: "source",
       requestedAmount: 90000, convertedAmount: 90000, deliveryConceptId: "dc", deliveryConceptName: "Domicilio",
       deliveryCommissionBps: 500, deliveryCommissionAmount: 4500, receiveRounding: "none", roundingAdjustment: 0,
       payoutAmount: 85500 }`): el comprobante de recepción contiene `Cargo de entrega: DOP 45.00`.
     - `resolveRecipientFormat`: sin nada da `"common"`; con `recipientFormat: "haiti"` en el recibo da `"haiti"`; y la
       opción `{ recipientFormat: "common" }` manda sobre el recibo.
7. `remittance-thermal-print-ui.test.ts`
   - Los cuatro botones `recipient-*` que quedan pasan `recipientFormat:'haiti'`.
   - Tres botones nuevos con `pos80Invoice` y `audience:'recipient'`: `reception-pos80-graphics` (papel `80`),
     `reception-58-graphics` (`58`) y `reception-a4-graphics` (`a4`, `orientation:'portrait'`).
   - `reception-pos80-graphics`: tras `__prints===1`, el primer `alt` es `Logo de la empresa`, hay `Separador punteado` y
     no hay `Separador`; todas las imágenes miden `66*8` puntos; ningún texto se sale (`left>=0.2`, `right<=65.7`); los
     textos dibujados unidos contienen `COMPROBANTE DE RECEPCIÓN`, `Cód. Operación:`, `Remitente:`, `mayo lomb`,
     `Destinatario:`, `Teléfono:`, `Dirección:`, `Monto a enviar:`, `DOP 500.00`, `Recibe el destinatario:`,
     `Recibido por:`, `Registrado por:` y `Nota:`, y no contienen `RECIBO DE ENVIO`, `Código del Cliente:`, `1111111111`,
     `Importes del envío`, `Total pagado por el remitente:`, `DOP 594.00`, `Forma pago del remitente:`, `RECIBE EN` ni
     `PARA RECLAMACIONES`. Captura: `reception-pos80-graphics.png`, que se añade a la lista de capturas que se copian.
   - `reception-58-graphics`: las imágenes miden `45*8` puntos, ningún texto se sale (`right<=44.7`) y los textos unidos
     con un espacio contienen `COMPROBANTE DE RECEPCIÓN`. Captura: `reception-58-graphics.png`.
   - `reception-a4-graphics`: no hay imágenes de rollo, hay 4 `section.receipt-sheet-divided`, el texto del cuerpo
     contiene `COMPROBANTE DE RECEPCIÓN` y `Recibe el destinatario: DOP 500.00`, y no contiene `RECIBO DE ENVIO`,
     `Código del Cliente`, `Importes del envío`, `Total pagado por el remitente` ni `Forma pago del remitente`.
8. `envios-review-corrections-ui.test.ts` y `october-nine-financial-ui.test.ts`, con «Tipo de recibo» en `recipient`:
   - «Formato para quien recibe» vale `common`; la vista previa y la hoja impresa contienen `COMPROBANTE DE RECEPCIÓN` y
     no contienen `RECIBE EN`.
   - Se elige `haiti` en «Formato para quien recibe» y siguen las comprobaciones actuales del formato de Haití. En
     `envios-review-corrections-ui.test.ts`, además, el texto de la vista previa (`.remittance-print-preview-caption`)
     contiene `Formato de Haití`.
   - Al pasar «Tipo de recibo» a `sender`, `getByLabel("Formato para quien recibe", { exact: true })` da 0 elementos.

Comprobación de la fase B: los mismos dos primeros comandos de la fase A y

```bash
git grep -n -e "isRecipientPrintedReceipt" -e "comprobante de entrega" -- app
```

que no debe devolver ninguna línea.

Comprobación visual: abrir `reception-pos80-graphics.png` en la carpeta temporal que la prueba escribe al terminar
(«Synthetic receipt screenshots: …») y recorrer con ella, fila por fila, la tabla «Filas del comprobante de recepción en
formato común».

### Fase C. Documentos y cierre

1. `docs/IMPRESION-TERMICA.md`
   - «Para probar», paso 3: queda «Revisar la **Vista previa de impresión** integrada antes de pulsar **Imprimir** /
     **Imprimir comprobante**. Los recibos se imprimen siempre con diseño: en papel térmico salen como imágenes que
     conservan líneas, acentos y formato, así que la impresora necesita su controlador gráfico (el de la V6 USB está en
     las [descargas del fabricante](https://www.2connet.com/es/descargas.php)).»
   - «Qué cambió»: se borra la viñeta que empieza por «En **Solo texto**». La que empieza por «En **Con diseño**» pasa a
     empezar por «Los recibos térmicos se dibujan localmente…». En la de etiquetas y valores se quita «tanto en **Con
     diseño** como en **Solo texto**». En la de alineación se quita «En modo **Con diseño**,» y la frase «En modo **Solo
     texto** se mantienen intactos los anchos y columnas (40 columnas en 80 mm).»
   - La viñeta «Existen **dos recibos impresos diferenciados**…» pasa a «Existen **tres salidas impresas**…». El punto 1
     no cambia. El punto 2 pasa a describir «**Para quien recibe (comprobante de recepción)**», formato común: el mismo
     recibo con el título **COMPROBANTE DE RECEPCIÓN**, sin «Código del Cliente», sin el título «Importes del envío», sin
     «Total pagado por el remitente» y sin «Forma pago del remitente»; en Carta y A4 lleva 4 líneas punteadas. Se añade
     un punto 3, «**Formato de Haití**», con la descripción que hoy tiene el punto 2 sin «`Con diseño`, `Solo texto`», y
     con cómo se elige: «Tipo de recibo» en «Para quien recibe» y «Formato para quien recibe» en «Haití»; la elección se
     recuerda en el navegador.
   - «Límites de la comprobación»: se borra la frase «También verifican texto genérico sin imágenes… preservación de
     acentos.» El párrafo «Un controlador de solo texto no imprime gráficos…» pasa a «Un controlador de Windows de solo
     texto no imprime gráficos: con él estos recibos no salen. Hay que instalar el controlador gráfico de la impresora.»
   - La sección «Tildes con el controlador genérico» se borra entera: describía un problema del modo «Solo texto».
2. `docs/ENVIOS-API.md`: las dos frases «**Solo texto** conserva separadores… del controlador/impresora.» y «**Con
   diseño** prepara los rollos… un controlador gráfico.» se sustituyen por «Los recibos se imprimen siempre con diseño:
   los rollos se preparan como imágenes con acentos dibujados en el navegador y requieren un controlador gráfico.»
3. Cierre, con las tres fases hechas:

   ```bash
   pnpm typecheck
   pnpm build
   pnpm --filter @cyp/server exec tsx --test --test-concurrency=1 ../client-admin/test/*.test.ts ../client-admin/tests/*.test.ts
   ```

   El último comando ejecuta toda la interfaz de Administración: el código compartido de remesas lo usan muchas ventanas.
