# Goldfish Annotated Review Report

**Target:** `design_draft.md` (sección «Detailed Implementation Plan», líneas 78-295 de la primera versión)

EGM, etapa 9 (lista para implementar), 2026-11-17. Tres revisores sin el contexto de la conversación, lanzados por
Claude Code (Fable 5.2): `egm-implementation-readiness`, `egm-codebase-details` y `egm-style`. Los tres terminaron su
revisión. Resolución (`egm-resolve`) hecha por el autor del plan; Rardiel no estaba delante, así que las correcciones
propuestas se aplicaron sin esperar su visto bueno, como indican las reglas del Superbrain. Sin hallazgos `CONTEST` ni
`ESCALATE`.

Resultado: 1 bloqueo y 8 puntos importantes, todos corregidos en `design_draft.md`. El código de producción del plan no
tuvo objeciones: los tres revisores comprobaron que cada símbolo, línea y cuenta citados coincide con el repositorio.

## Prioritized Findings & AI Suggestions

### [1] [`implementation-readiness`, `codebase-details`] - Severity: Blocker
*   **Affected Scope:** fase de pruebas, `envios-review-corrections-ui.test.ts` y `october-nine-financial-ui.test.ts`.
*   **Discrepancy Description:** las dos pruebas imprimen con el papel por defecto (rollo de 80 mm) y leen la ventana con
    `locator("body").innerText()`. Hoy pasan porque el valor por defecto es «Solo texto». Al quitarlo, el rollo sale
    siempre como imágenes y ese texto deja de existir en la página; fallarían también las comprobaciones del recibo de
    quien envía, que el plan no mencionaba.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** cierto; comprobado en `receipt.ts` (`printRemittanceReceipt`) y en las dos pruebas.
*   ***Proposed Edit:*** fase A, paso 10: ayudante `printedSheet` que espera a las imágenes del rollo y lee su texto
    alternativo, como ya hace `remittance-quote-allocation-ui.test.ts`. Se mantiene la cobertura del papel por defecto.

### [2] [`implementation-readiness`, `codebase-details`] - Severity: Major
*   **Affected Scope:** fases 1 a 6 de la primera versión.
*   **Discrepancy Description:** ninguna fase dejaba el código compilando antes de la quinta ni tenía comprobación propia.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** tres fases que compilan y se prueban cada una: A, quitar «Solo texto»; B, comprobante de
    recepción y formato de Haití; C, documentos y cierre. Quitar primero el modo texto evita tocar `receiptText.ts` antes
    de borrarlo.

### [3] [`implementation-readiness`, `codebase-details`] - Severity: Major
*   **Affected Scope:** `remittance-receipt.test.ts`.
*   **Discrepancy Description:** «quitar las comprobaciones que dependían de `<pre>`» no era una lista de cambios: varias
    comprobaciones dependían del texto plano sin nombrar `<pre>` (cadenas `Campo: dato`, líneas de guiones, anchos).
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** fase A, paso 7: ayudante `printedText` y cambios caso por caso; se conservan las comprobaciones
    de contenido del recibo, ahora sobre la salida con diseño.

### [4] [`implementation-readiness`, `codebase-details`] - Severity: Major
*   **Affected Scope:** `receipt-paper.test.ts`.
*   **Discrepancy Description:** faltaban cambios: el ancho esperado en el HTML (72 mm pasa a 66 mm), `restored.output` y
    las llamadas que aún pasaban `output`.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** fase A, paso 6, con cada comprobación nombrada.

### [5] [`implementation-readiness`, `codebase-details`] - Severity: Major
*   **Affected Scope:** `remittance-thermal-print-ui.test.ts` y la comprobación visual.
*   **Discrepancy Description:** lista incompleta de botones de texto (`text-sheet-*`, bucle `textOnly`, impresión final
    `text-80`), caso nuevo sin datos de prueba ni captura, y captura visual sin ruta ni criterio.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** fase A, paso 8, y fase B, paso 7: qué se borra, tres casos `reception-*` con sus listas y sus
    capturas; la comprobación visual se hace contra la tabla de filas del documento.

### [6] [`implementation-readiness`, `codebase-details`, `style`] - Severity: Major
*   **Affected Scope:** `docs/IMPRESION-TERMICA.md` y `docs/ENVIOS-API.md`.
*   **Discrepancy Description:** el paso no daba el texto nuevo; quedaban pasajes sin tratar (controlador de solo texto,
    sección de tildes, «dos recibos», etiqueta antigua) y en `ENVIOS-API.md` la frase ocupaba dos líneas.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** fase C, pasos 1 y 2, pasaje por pasaje y con el texto que queda.

### [7] [`codebase-details`, `implementation-readiness`] - Severity: Major
*   **Affected Scope:** casos de prueba que faltaban.
*   **Discrepancy Description:** sin prueba: envío cancelado, selector ausente con «Para quien envía», rótulo «Formato de
    Haití» en la vista previa, precedencia de `resolveRecipientFormat`, 4 separadores en Carta y A4, datos para el cargo
    de entrega y `formatSpacedTitleLines`, que perdía su única comprobación.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** fase A, paso 7 (título espaciado) y fase B, pasos 6 a 8. La consecuencia de los 4 separadores y
    del título en dos líneas quedó escrita en «Qué cambia».

### [8] [`codebase-details`] - Severity: Major (anterior al plan)
*   **Affected Scope:** `remittance-quote-allocation-ui.test.ts`, comprobaciones `/Devuelta/`.
*   **Discrepancy Description:** por lectura, el recibo impreso no lleva la fila «Devuelta», así que esa prueba no podría
    pasar hoy.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** hay que comprobarlo ejecutando la prueba antes del cambio, no por lectura.
*   ***Proposed Edit:*** fase A, paso 9: se decide con la línea base; si ya fallaba, la comprobación pasa a una fila que
    el recibo impreso sí lleva.

### [9] [`style`] - Severity: Major
*   **Affected Scope:** nombres y cuentas.
*   **Discrepancy Description:** «las cuatro filas quitadas» eran tres filas y un título; «comprobante de recepción» se
    usaba para el formato común y para los dos formatos; «formato de Haití» alternaba con «comprobante de Haití»; el
    cambio de la opción «(comprobante de entrega)» no figuraba en «Qué cambia».
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** definición de nombres en «Qué cambia», punto 4 nuevo, y las filas nombradas una a una en las
    pruebas. La opción del selector se queda como «Para quien recibe (comprobante de recepción)»: el formato de Haití es
    un formato de ese comprobante.

### [10] [`style`, `implementation-readiness`, `codebase-details`] - Severity: Major / Nit
*   **Affected Scope:** pasos que no se podían seguir al pie de la letra.
*   **Discrepancy Description:** el borrado de `remittance-receipt-text.test.ts` estaba en la lista pero en ningún paso;
    el `git grep` de control estaba antes de actualizar las pruebas, no cubría `options.output` y siempre encontraba una
    variable local llamada `receiptText`; «desde `app/`» y «desde la raíz» se contradecían.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** fase A, paso 5; los controles `git grep` van al final de cada fase con patrones que no deben dar
    ninguna línea; todos los comandos se ejecutan en Git Bash desde la raíz del repositorio.

### [11] [`implementation-readiness`] - Severity: Nit
*   **Discrepancy Description:** `COMPROBANTE DE RECEPCIÓN` puede no caber en una línea en 58 y 51 mm.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** resultado esperado escrito (dos líneas centradas) y caso `reception-58-graphics`.

### [12] [`codebase-details`] - Severity: Nit
*   **Discrepancy Description:** sin modo texto, `widthMm` de los rollos solo lo lee una prueba.
*   ***AI Suggestion:*** DECLINE
*   ***Justification:*** se queda: es el ancho imprimible del rollo y el comentario nuevo lo dice. Quitarlo sería un
    cambio de estructura que el pedido no incluye.

### [13] [`style`] - Severity: Nit (N1-N16)
*   ***AI Suggestion:*** PROPOSE FIX para N1 a N9 y N11 a N16 (orden de los pasos, verbos, nombre de la clave guardada,
    «Comandos», tilde de `RECIBO DE ENVIO`); DECLINE para N10 solo en la parte de renombrar los casos `recipient-*` a
    `haiti-*`: son nombres de botones de una prueba y cambiarlos no aporta.

## Resolución

Aplicadas todas las correcciones `PROPOSE FIX` en `design_draft.md` el 2026-11-17. No se repitió la revisión: el límite
del protocolo es una nueva auditoría por etapa y las correcciones son de pruebas, fases y documentos, no del código de
producción, que los tres revisores dieron por correcto.
