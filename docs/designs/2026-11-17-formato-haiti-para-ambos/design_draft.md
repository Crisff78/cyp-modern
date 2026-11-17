# El formato de Haití vale también para quien envía, y «recibo de recepción»

Autor: Claude Code (Fable 5.2), 17-11-2026. Base: `main` `36309c3` (PR #161 ya fusionado). Revisado con EGM, etapa 9;
ver `goldfish_review_report.md` en esta carpeta.

## Pedido

Rardiel, 17-11-2026, en el chat de Claude Code, con una captura del recibo «COMPROBANTE DE RECEPCIÓN» impreso desde la
demo:

> «Ok, hazlo. Y con lo que te dije anteriormente me refiero a que también cambie el recibo de envío también, dependiendo
> de si elijo Haití. También cambia el nombre a recibo de recepción en vez de comprobante de recepción»

«Lo que te dije anteriormente» es su pedido del mismo día: «Deja esto también cuando pongo que el recibo es para quien
envía, no tienes que quitarlo si lo pongo así» (el selector de formato).

## Cómo está hoy

El panel de impresión de un envío tiene «Tipo de recibo», con las opciones «Para quien envía (comprobante de envío)» y
«Para quien recibe (comprobante de recepción)», y «Formato para quien recibe», con «Común» y «Haití». Lo que se imprime:

| Tipo de recibo | Formato «Común» | Formato «Haití» |
|---|---|---|
| Para quien envía | `RECIBO DE ENVIO` | `RECIBO DE ENVIO` (el formato no le afecta) |
| Para quien recibe | `COMPROBANTE DE RECEPCIÓN` | Recibo corto de Haití |

El recibo corto de Haití no lleva título: empresa en mayúsculas, `Envío #:`, fecha, nombre y `TELÉFONO:` del
destinatario, `MONTO:`, `RECIBE EN <moneda>:`, el aviso de revisar el teléfono y la línea de reclamaciones.

El panel está en dos sitios, en Administración y en el terminal del cobrador: la ventana del recibo (abre «Para quien
envía» desde «Envíos de dinero» y «Para quien recibe» desde «Entregas de dinero») y el aviso «¿Quieres imprimir el
recibo?» que sale al registrar cada envío, que abre siempre «Para quien envía».

## Qué cambia

1. **Con «Haití» también cambia el recibo de quien envía.** El formato de Haití es un solo recibo: sale idéntico con
   «Para quien envía» y con «Para quien recibe».
2. **El selector pasa a llamarse «Formato de recibo»**, porque ya no es solo de quien recibe. Sigue con «Común» y
   «Haití», siempre a la vista y recordado en el navegador.
3. **«Comprobante de recepción» pasa a «recibo de recepción»:** el título impreso es `RECIBO DE RECEPCIÓN` y la opción
   de «Tipo de recibo» es «Para quien recibe (recibo de recepción)».
4. **La otra opción de «Tipo de recibo» pasa a «Para quien envía (recibo de envío)»**, en vez de «(comprobante de
   envío)», para que las dos opciones nombren el recibo como el título que imprime el formato «Común».

Queda así:

| Tipo de recibo | Formato «Común» | Formato «Haití» |
|---|---|---|
| Para quien envía | `RECIBO DE ENVIO` | Recibo corto de Haití |
| Para quien recibe | `RECIBO DE RECEPCIÓN` | Recibo corto de Haití |

Aparte de ese título, no cambia el contenido de ninguno de los tres impresos, ni los tamaños de papel, ni el botón
«Imprimir comprobante».

## Consecuencia que conviene saber

El aviso «¿Quieres imprimir el recibo?» de cada envío nuevo es para quien envía y usa el formato recordado. Con «Haití»
elegido, ese aviso imprime el recibo corto de Haití en cada envío nuevo, hasta que se vuelva a elegir «Común». Eso
incluye los navegadores que ya tenían «Haití» guardado de antes: hasta hoy imprimían ahí `RECIBO DE ENVIO`.

## Decisiones tomadas por Claude (para que Rardiel las corrija si no son las que quiere)

- **Con «Haití», quien envía recibe el mismo recibo corto que ya existe.** No hay otro formato de Haití en el sistema y
  el pedido no describe uno distinto.
- **El nombre «Formato de recibo»** y **el punto 4** no están en el pedido: se hacen para que los nombres digan lo que
  ahora pasa.
- **Quien ya eligió «Haití» en su navegador lo conserva** (ver «Consecuencia que conviene saber»). La elección se
  guardaba con el nombre `recipientFormat`; ahora se guarda como `receiptFormat` y al leer se acepta también el nombre
  anterior.
- **Con «Haití» la casilla «Recibo resumido para envío telefónico» no tiene efecto;** desde ahora, tampoco para quien
  envía.

## Además: un dato mal medido en el documento del límite por visitante

Rardiel dijo «Ok, hazlo» a la propuesta de Claude de averiguar por qué el límite de peticiones por visitante (hallazgo
R5 de la revisión de la fábrica, PR #155) no surtía efecto en la demo. Sí surte efecto: la medida de Claude estaba mal
hecha, porque sus dos peticiones salían de la misma laptop. No hay código que cambiar.

Medido de nuevo el 17-11-2026 a las 18:10 UTC con la orden de `docs/LIMITE-POR-VISITANTE.md`
(`curl -s -o /dev/null -D - https://cyp-modern-demo.onrender.com/api/health`), desde la laptop de Rardiel y, por ssh,
desde su servidor (otra red). Salida, en el chat de Claude Code de ese día: tres peticiones desde la laptop dieron
`x-ratelimit-remaining` 119, 118 y 117; dos desde el servidor, 119 y 118; una más desde la laptop, 116. La misma orden
con `-H "CF-Connecting-IP: 203.0.113.9"` respondió 403.

`docs/LIMITE-POR-VISITANTE.md` cita como prueba una medida del 13-11-2026 hecha con el mismo error; se corrige en el
paso 13, en un commit aparte.

## Fuera de alcance

- Un formato de Haití distinto para quien envía.
- El nombre del botón «Imprimir comprobante» y la vista de consulta del recibo (la que no es para imprimir).
- `RECIBO DE ENVIO` sigue sin tilde: es el texto actual y no entra en este cambio.
- La base de datos y el servidor. No hay migración.

## Detailed Implementation Plan

Las rutas de «Archivos» son relativas a la raíz del repositorio; en los pasos se usa solo el nombre del archivo (el
código está en `app/shared/remittances/` y las pruebas en `app/client-admin/test/`). Los comandos se ejecutan en Git Bash
desde la raíz del repositorio; las rutas `../client-admin/…` son relativas al paquete `@cyp/server`. Los números de
línea son los de `main` `36309c3`.

Son dos commits. El primero lleva los pasos 1 a 12: los cambios de nombre atraviesan código y pruebas, y ninguna parte
compila o pasa sin las demás. El segundo lleva el paso 13, que no tiene que ver con los recibos.

### Archivos

Se modifican:

- `app/shared/remittances/receiptPaper.ts`
- `app/shared/remittances/receipt.ts`
- `app/shared/remittances/thermalReceipt.ts`
- `app/shared/remittances/ReceiptPrintControls.tsx`
- `app/client-admin/test/receipt-paper.test.ts`
- `app/client-admin/test/remittance-receipt.test.ts`
- `app/client-admin/test/remittance-thermal-print-ui.test.ts`
- `app/client-admin/test/envios-review-corrections-ui.test.ts`
- `app/client-admin/test/october-nine-financial-ui.test.ts`
- `docs/IMPRESION-TERMICA.md`
- `docs/LIMITE-POR-VISITANTE.md`
- `docs/designs/2026-11-17-comprobante-recepcion/design_draft.md`
- `docs/designs/2026-11-17-formato-siempre-visible/design_draft.md`

### Pasos

1. Cambio de nombres. Son sustituciones exactas, distinguiendo mayúsculas y minúsculas; ninguno de los cinco nombres
   contiene a otro. Se hacen una sola vez y antes que los demás pasos, porque los pasos 2 y 6 vuelven a escribir
   `recipientFormat` a propósito.

   | Antes | Ahora |
   |---|---|
   | `recipientReceiptFormatLabels` | `receiptFormatLabels` |
   | `RecipientReceiptFormat` | `ReceiptFormat` |
   | `resolveRecipientFormat` | `resolveReceiptFormat` |
   | `isHaitiRecipientVoucher` | `isHaitiVoucher` |
   | `recipientFormat` | `receiptFormat` |

   Afecta a `receiptPaper.ts`, `receipt.ts`, `thermalReceipt.ts`, `ReceiptPrintControls.tsx`, `receipt-paper.test.ts`,
   `remittance-receipt.test.ts` y `remittance-thermal-print-ui.test.ts`; ningún otro archivo de `app/` usa esos nombres.
   `recipientVoucher`, `RecipientReceiptVoucher`, `recipientVoucherWarningText` y `receptionReceiptHeading` no se tocan:
   no contienen ninguno de los cinco.
2. `receiptPaper.ts`
   - `printedReceiptAudienceLabels` (líneas 9-10) queda con `sender: "Para quien envía (recibo de envío)"` y
     `recipient: "Para quien recibe (recibo de recepción)"`.
   - El comentario `// What the recipient is given: the common voucher, or the one used for Haiti.` (línea 12) pasa a
     `// The common receipts (one for the sender, one for the recipient), or the single voucher used for Haiti.`
   - En `readSavedReceiptPrintOptions`, la línea 31, que tras el paso 1 dice
     `const receiptFormat = parsed.receiptFormat === "haiti" ? "haiti" as const : undefined;`, pasa a

     ```ts
     // Until 17-11-2026 this was saved as recipientFormat, when the format only changed the recipient's copy.
     const savedFormat = parsed.receiptFormat ?? (parsed as { recipientFormat?: unknown }).recipientFormat;
     const receiptFormat = savedFormat === "haiti" ? "haiti" as const : undefined;
     ```

3. `receipt.ts`
   - `receptionReceiptHeading` (línea 13) pasa a valer `"RECIBO DE RECEPCIÓN"`.
   - `isHaitiVoucher` deja de mirar para quién es el recibo. El comentario y la función (líneas 59-64) quedan:

     ```ts
     // The Haiti voucher is the same for the sender and the recipient; it is drawn from recipientVoucher.
     // Every other printed receipt is drawn from its sections.
     export const isHaitiVoucher = (
       receipt: Receipt,
       options?: { receiptFormat?: ReceiptFormat },
     ) => Boolean(receipt.printed && receipt.recipientVoucher && resolveReceiptFormat(receipt, options) === "haiti");
     ```

   - Las tres últimas líneas del comentario de `remittanceReceipt` (176-178) quedan:

     ```ts
      * With the common format, the recipient's copy (RECIBO DE RECEPCIÓN) is the same layout without the rows in
      * receptionOmittedRows and without the «Importes del envío» title; see receiptSections. The Haiti format is drawn from
      * recipientVoucher instead, for the sender and for the recipient alike.
     ```

   - No cambia nada más: `receiptHtml` ya llama a `isHaitiVoucher(receipt, options)` (línea 300) y
     `printRemittanceReceipt` ya entrega a la impresión térmica el recibo con el formato resuelto (línea 364).
     `receiptSections` no interviene en el formato de Haití.
4. `thermalReceipt.ts`: solo el cambio de nombre del paso 1. Llama a `isHaitiVoucher(receipt)` sin opciones (línea 75);
   el formato le llega en `receipt.receiptFormat`, que `printRemittanceReceipt` ya rellena.
5. `ReceiptPrintControls.tsx`, línea 101: el texto visible y el `aria-label` del selector pasan de
   `Formato para quien recibe` a `Formato de recibo`. Los dos siguen iguales entre sí, como en los demás selectores del
   panel. El rótulo de la vista previa no cambia de código: con «Haití» dice «Formato de Haití · » también cuando el tipo
   es «Para quien envía», porque sale de `isHaitiVoucher` (líneas 13 y 18).
6. `receipt-paper.test.ts`, tercer `test(` del archivo, el único que usa `printedReceiptAudienceLabels`
   - Las líneas 50-51 pasan a:

     ```ts
     assert.equal(printedReceiptAudienceLabels.sender, "Para quien envía (recibo de envío)");
     assert.equal(printedReceiptAudienceLabels.recipient, "Para quien recibe (recibo de recepción)");
     ```

   - Dentro del `try`, después de la línea 75 (la segunda
     `assert.deepEqual(readSavedReceiptPrintOptions(), { paper: "80", compact: false });`), se añade:

     ```ts
     // Until 17-11-2026 the format was saved as recipientFormat: a browser that had «Haití» keeps it.
     memory.set("cyp.remittances.receiptPrintOptions", JSON.stringify({ paper: "80", compact: false, recipientFormat: "haiti" }));
     assert.deepEqual(readSavedReceiptPrintOptions(), { paper: "80", compact: false, receiptFormat: "haiti" });
     memory.set("cyp.remittances.receiptPrintOptions", JSON.stringify({ paper: "80", compact: false, recipientFormat: "otro" }));
     assert.deepEqual(readSavedReceiptPrintOptions(), { paper: "80", compact: false });
     // What was saved with the new name goes first.
     memory.set("cyp.remittances.receiptPrintOptions", JSON.stringify({ paper: "80", compact: false, receiptFormat: "common", recipientFormat: "haiti" }));
     assert.deepEqual(readSavedReceiptPrintOptions(), { paper: "80", compact: false });
     ```

7. `remittance-receipt.test.ts`
   - Caso de la línea 154, «recipient delivery receipt (Para quien recibe) renders the KEBEK voucher across all paper
     sizes without altering sender receipts» (KEBEK es el nombre del modelo de recibo de Haití). Su título pasa a «the
     format of Haiti renders the KEBEK voucher across all paper sizes, the same for the recipient and for the sender».
   - En su bucle de papeles, después de la línea 182 (`const graphicHtml = …`), se añade:

     ```ts
     assert.equal(receiptHtml(recipientModel, { paper, compact: false, audience: "sender", receiptFormat: "haiti" }), graphicHtml,
       `paper=${paper}: with the format of Haiti the sender gets the same voucher`);
     ```

   - Sus líneas 201-205 (el comentario «Switching options.audience…» y las cuatro líneas de `senderOverrideHtml`) pasan a:

     ```ts
     // 17-11-2026: without the format of Haiti, the same model prints the sender's receipt.
     const senderCommonHtml = receiptHtml(recipientModel, { paper: "a4", compact: false, audience: "sender" });
     assert(senderCommonHtml.includes("RECIBO DE ENVIO"));
     assert.equal((senderCommonHtml.match(/receipt-sheet-divided"/g) ?? []).length, 5);
     assert(!senderCommonHtml.includes("PARA RECLAMACIONES FAVOR COMUNICARSE"));
     ```

     La comilla final de `receipt-sheet-divided"` es intencionada: cuenta los atributos `class` y no las reglas de estilo.
   - Caso de la línea 208: `COMPROBANTE DE RECEPCIÓN` pasa a `RECIBO DE RECEPCIÓN` en sus cinco apariciones (líneas 208,
     214, 217, 222 y 227; el título del caso incluido).
8. `remittance-thermal-print-ui.test.ts`
   - `COMPROBANTE DE RECEPCIÓN` pasa a `RECIBO DE RECEPCIÓN` en sus dos apariciones (líneas 202 y 213).
   - El título nuevo es más corto y, por las medidas de la letra, cabe en una línea también en el rollo de 58 mm. El
     comentario de la línea 200 pasa a `// 17-11-2026: the shorter title fits in one line, also on the narrow roll.` y
     debajo de la línea 201 (`const receptionText=…`) se añade
     ``assert(receptionCheck.runs.some((r:any)=>r.text==="RECIBO DE RECEPCIÓN"),`${id}: the title fits in one line`);``.
     Si esa comprobación falla en `reception-58-graphics`, el título sigue ocupando dos líneas: se quita, se deja el
     comentario como estaba y no se aplica el cambio de la frase «el título ocupa dos líneas» del paso 11.
   - Botón nuevo en la página de prueba, después de la línea 29 (el bucle de los botones `reception-*`):

     ```js
     {const b=document.createElement('button');b.textContent='sender-haiti-pos80-graphics';b.onclick=()=>printRemittanceReceipt(pos80Invoice,{paper:'80',compact:false,audience:'sender',receiptFormat:'haiti'});document.body.append(b);}
     ```

   - Comprobación nueva, después de la línea 205 (la llave que cierra el bucle de `reception-pos80-graphics` y
     `reception-58-graphics`) y antes de `const openingReceptionSheet`:

     ```ts
     // 17-11-2026: with the format of Haiti the sender's receipt is the same short voucher.
     const openingSenderHaiti=page.waitForEvent("popup");await page.getByRole("button",{name:"sender-haiti-pos80-graphics",exact:true}).click();const senderHaiti=await openingSenderHaiti;
     await senderHaiti.waitForFunction(()=>(window as any).__prints===1);
     await senderHaiti.setViewportSize({width:Math.floor(72.1*96/25.4),height:760});
     await senderHaiti.emulateMedia({media:"print"});
     const senderHaitiCheck=await senderHaiti.evaluate(()=>({runs:(window as any).__runs,alts:Array.from(document.querySelectorAll<HTMLImageElement>("main.thermal-image-output img")).map(img=>img.alt)}));
     const senderHaitiText=senderHaitiCheck.runs.map((r:any)=>r.text).join(" ").replace(/\s+/g," ");
     for(const expected of ["Envío #: ENV00000048","TELÉFONO: 8095550100","MONTO: DOP 500.00","RECIBE EN DOP:"])assert(senderHaitiText.includes(expected),`sender-haiti-pos80-graphics missing ${expected}`);
     for(const forbidden of ["RECIBO DE ENVIO","Forma pago del remitente","Recibido por"])assert(!senderHaitiText.includes(forbidden),`sender-haiti-pos80-graphics unexpected ${forbidden}`);
     assert.equal(senderHaitiCheck.alts.filter((a:string)=>a==="Separador").length,2);assert(!senderHaitiCheck.alts.includes("Logo de la empresa"));
     await senderHaiti.screenshot({path:path.join(output,"sender-haiti-pos80-graphics.png"),fullPage:true});await senderHaiti.close();
     ```

     `__prints` y `__runs` son de cada ventana de impresión; no hay que reiniciarlos.
   - En la línea 218, la lista de capturas que se copian a `CYP_RECEIPT_SNAPSHOT_DIR` gana
     `"sender-haiti-pos80-graphics.png"`.
9. `envios-review-corrections-ui.test.ts`
   - `"Formato para quien recibe"` pasa a `"Formato de recibo"` en sus dos apariciones (líneas 273 y 540), y
     `COMPROBANTE DE RECEPCIÓN` a `RECIBO DE RECEPCIÓN` en las dos suyas (276 y 302).
   - Caso «Cajero in Entregas de dinero…», tras `selectOption("sender")` (línea 305). Se quitan las líneas 307-309:

     ```ts
     await format.selectOption("haiti");
     assert.equal(await format.inputValue(), "haiti");
     assert.equal((await detail.locator(".remittance-print-preview-caption").innerText()).includes("Formato de Haití"), false, "the sender's receipt has one format only");
     ```

     Al quitarlas el selector sigue en `common`, su valor al llegar ahí (lo comprueba la línea 306); no se añade nada.
     Las comprobaciones del recibo de quien envía (líneas 310-320) no cambian. Después de la línea 320
     (`assert.equal(printed.includes("demo-admin"), false, …)`) y antes de volver a `recipient`, se añade:

     ```ts
     // 17-11-2026: the format of Haiti changes the sender's receipt too.
     await format.selectOption("haiti");
     assert.match(await detail.locator(".remittance-print-preview-caption").innerText(), /Formato de Haití/);
     const senderHaitiPreview = await detail.getByLabel("Vista previa del recibo para imprimir", { exact: true }).textContent();
     assert.ok(senderHaitiPreview && senderHaitiPreview.includes("RECIBE EN EUR:"));
     assert.equal(senderHaitiPreview?.includes("RECIBO DE ENVIO"), false);
     const senderHaitiReady = context.waitForEvent("page");
     await detail.getByRole("button", { name: "Imprimir comprobante", exact: true }).click();
     const senderHaitiPopup = await senderHaitiReady; await senderHaitiPopup.waitForLoadState();
     const senderHaitiPrinted = await printedSheet(senderHaitiPopup); await senderHaitiPopup.close();
     assert.match(senderHaitiPrinted, /RECIBE EN EUR:/);
     assert.equal(senderHaitiPrinted.includes("Forma pago del remitente"), false);
     ```

     Las dos líneas finales del caso (volver a `recipient` y comprobar «Formato de Haití» en el rótulo) no cambian.
   - Caso «Admin, sending window…», aviso de impresión de un envío nuevo (de DOP a DOP). Después de la línea 540 se
     añade:

     ```ts
     // 17-11-2026: with «Haití», the receipt of a new send, which is the sender's, comes out in the format of Haiti.
     await print.getByLabel("Formato de recibo", { exact: true }).selectOption("haiti");
     const promptPreview = await print.getByLabel("Vista previa del recibo para imprimir", { exact: true }).textContent();
     assert.ok(promptPreview && promptPreview.includes("RECIBE EN DOP:"));
     assert.equal(promptPreview?.includes("RECIBO DE ENVIO"), false);
     await print.getByLabel("Formato de recibo", { exact: true }).selectOption("common");
     ```

10. `october-nine-financial-ui.test.ts`
    - `"Formato para quien recibe"` pasa a `"Formato de recibo"` (el comentario de la línea 169 y las líneas 172 y 176) y
      `COMPROBANTE DE RECEPCIÓN` a `RECIBO DE RECEPCIÓN` (línea 171).
    - La línea 176 ya comprueba que, tras `selectOption("sender")`, el selector sigue en `haiti`; no cambia. Entre ella
      y la línea 177 (`const popupReady = …`) se añade lo siguiente. `8090000505` es el teléfono del destinatario y
      `DOP 105.00` el total pagado por el remitente, que el recibo de Haití no lleva.

      ```ts
      const senderHaitiReady = context.waitForEvent("page"); await detail.getByRole("button", { name: "Imprimir comprobante", exact: true }).click(); const senderHaitiPopup = await senderHaitiReady; await senderHaitiPopup.waitForLoadState();
      const senderHaitiText = await printedSheet(senderHaitiPopup); assert.ok(senderHaitiText.includes("RECIBE EN DOP:")); assert.ok(senderHaitiText.includes("8090000505")); assert.ok(!senderHaitiText.includes("DOP 105.00")); await senderHaitiPopup.close();
      await detail.getByLabel("Formato de recibo", { exact: true }).selectOption("common");
      ```

      Las líneas 177-178, que esperan el recibo de quien envía, no cambian; ninguna comprobación posterior del caso
      depende del formato.
11. `docs/IMPRESION-TERMICA.md`, viñeta «Existen **tres salidas impresas**» (líneas 17-20)
    - La línea 17 entera pasa a:

      ```markdown
      - Existen **tres salidas impresas**. El selector **Tipo de recibo** dice para quién es y se preselecciona según la ventana; **Formato de recibo** elige entre el formato común y el de Haití, está siempre a la vista y se recuerda en el navegador:
      ```

    - Línea 18: `**Para quien envía (comprobante de envío)** —` pasa a
      `**Para quien envía (recibo de envío)**, formato **Común** —`.
    - Línea 19: `(comprobante de recepción)` pasa a `(recibo de recepción)` y `**COMPROBANTE DE RECEPCIÓN**` a
      `**RECIBO DE RECEPCIÓN**`. Su final `; en los rollos de 58 y 51 mm el título ocupa dos líneas.` pasa a `.`, con la
      condición del paso 8.
    - Línea 20: su comienzo, desde `**Formato de Haití** —` hasta `no cambia lo que se imprime.` incluido, pasa a:

      ```markdown
      **Formato de Haití** — se elige con **Formato de recibo** en «Haití». Es un solo recibo: sale idéntico para quien envía y para quien recibe, también en el aviso de impresión de cada envío nuevo.
      ```

      Sigue, tras un espacio, `Disponible en **todos los tamaños**…`, que no cambia.
12. Los dos planes anteriores describen un cambio ya hecho y no se reescriben; solo se les añade una nota.
    - `docs/designs/2026-11-17-comprobante-recepcion/design_draft.md`: al final del punto 1 de «Qué cambia» (termina en
      `sin el título «Importes del envío».`) se añade, tras un espacio:

      ```markdown
      Desde el 17-11-2026 el título es `RECIBO DE RECEPCIÓN` y la opción, «Para quien recibe (recibo de recepción)»; ver `docs/designs/2026-11-17-formato-haiti-para-ambos/design_draft.md`.
      ```

    - `docs/designs/2026-11-17-formato-siempre-visible/design_draft.md`: al final de la viñeta de «Lo que no cambia» que
      termina en `no existe un formato de Haití para quien envía.` se añade, tras un espacio:

      ```markdown
      Esto dejó de valer el 17-11-2026, por pedido de Rardiel: con «Haití» también cambia el recibo de quien envía; ver `docs/designs/2026-11-17-formato-haiti-para-ambos/design_draft.md`.
      ```

13. `docs/LIMITE-POR-VISITANTE.md` (segundo commit; ver «Además»)
    - En «Qué pasaba», el párrafo de las líneas 9-10 («Comprobado en la demo el 13-11-2026: … pasó de 119 a 117).») pasa
      a:

      ```markdown
      Esto se deduce del código y no de una medida: sin la opción `trustProxy`, el servidor (Fastify) cuenta las
      peticiones por la dirección de quien se conecta a él, y en Render quien se conecta es el proxy. Antes del cambio no
      se midió. Hasta el 17-11-2026 este documento citaba aquí una medida del 13-11-2026; no valía, porque las dos
      peticiones que comparaba salieron de la misma laptop.
      ```

    - En «Cómo comprobarlo después de publicar», línea 39: `; antes bajaban las dos del mismo número. Y la misma orden`
      pasa a `. Y la misma orden`.
    - En la misma sección, después del párrafo que termina en `debe seguir respondiendo 403.`, se añade:

      ```markdown
      Comprobado en la demo el 17-11-2026, con el cambio ya publicado: tres peticiones seguidas desde la laptop dieron
      `x-ratelimit-remaining` 119, 118 y 117; dos desde un servidor en otra red, 119 y 118; y una más desde la laptop,
      116. Cada red lleva su cuenta. La misma orden con `-H "CF-Connecting-IP: 203.0.113.9"` respondió 403.
      ```

### Comprobación

```bash
pnpm typecheck
pnpm --filter @cyp/server exec tsx --test --test-concurrency=1 ../client-admin/test/receipt-paper.test.ts ../client-admin/test/remittance-receipt.test.ts ../client-admin/test/remittance-thermal-print-ui.test.ts ../client-admin/test/envios-review-corrections-ui.test.ts ../client-admin/test/october-nine-financial-ui.test.ts ../client-admin/test/remittance-quote-allocation-ui.test.ts ../client-admin/test/teclado-cajero-ui.test.ts ../client-admin/test/cashier-shell-ui.test.ts ../client-admin/test/remittance-workspace-corrections-ui.test.ts ../client-admin/test/teclado-ventanas-ui.test.ts
pnpm --filter @cyp/server exec tsx --test test/remittance-card-records.test.ts
pnpm build
git grep -n -e "recipientFormat" -e "RecipientReceiptFormat" -e "recipientReceiptFormatLabels" -e "resolveRecipientFormat" -e "isHaitiRecipientVoucher" -e "COMPROBANTE DE RECEPCIÓN" -e "comprobante de recepción" -e "comprobante de envío" -e "Formato para quien recibe" -- app docs/IMPRESION-TERMICA.md
```

Los cuatro primeros comandos deben terminar sin errores. El segundo ejecuta los diez archivos de `app/client-admin/test`
que dibujan este panel o estos recibos, y el tercero, la prueba del servidor que también los dibuja. Las pruebas de
interfaz necesitan Microsoft Edge; si aparece un caso «skipped», el paso no está cumplido. `pnpm typecheck` no revisa
las pruebas: un nombre viejo olvidado en una prueba solo lo atrapan su ejecución o el `git grep`.

El `git grep` solo debe devolver `recipientFormat` en `receiptPaper.ts` (dos líneas: el comentario y la lectura del
nombre anterior) y en `receipt-paper.test.ts` (las cuatro líneas nuevas del paso 6 que lo contienen).

Comprobación visual: abrir `sender-haiti-pos80-graphics.png`, `reception-pos80-graphics.png` y
`reception-58-graphics.png` en la carpeta temporal cuya ruta imprime `remittance-thermal-print-ui.test.ts` al terminar
(«Synthetic receipt screenshots: …»). La primera debe ser el recibo corto de Haití; las otras dos, llevar el título
`RECIBO DE RECEPCIÓN` en una sola línea.
