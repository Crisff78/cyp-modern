# Goldfish Annotated Review Report

**Target:** `design_draft.md` (sección «Detailed Implementation Plan», líneas 72-263 de la primera versión)

EGM, etapa 9 (lista para implementar), 17-11-2026. Cambio pequeño: una sola etapa. Tres revisores sin el contexto de la
conversación, lanzados por Claude Code (Fable 5.2): `egm-implementation-readiness`, `egm-codebase-details` y
`egm-style`. Los tres terminaron. Resolución (`egm-resolve`) hecha por el autor del plan; Rardiel no estaba delante,
así que las correcciones se aplicaron sin esperar su visto bueno, como indican las reglas del Superbrain. Sin hallazgos
`CONTEST` ni `ESCALATE`.

Resultado: ningún bloqueo. `egm-implementation-readiness` y `egm-codebase-details` no encontraron nada importante
(6 y 5 menores); `egm-style` marcó 6 importantes, todos de redacción o de falta de anclas. Todo quedó corregido en
`design_draft.md`. Los dos revisores técnicos comprobaron contra el repositorio que los cinco cambios de nombre solo
tocan los siete archivos listados, que no chocan con nombres existentes, que con «Haití» y «Para quien envía» no queda
ningún sitio que mire para quién es el recibo, y que los textos que esperan las pruebas nuevas salen de los datos de
prueba. Ninguno pudo ejecutar pruebas: eso lo hizo el autor después (ver «Comprobación» en el plan).

## Prioritized Findings & AI Suggestions

### [1] [`implementation-readiness`, `codebase-details`, `style`] - Severity: Major
*   **Affected Scope:** «Decisiones tomadas por Claude»; paso 9; `RemittancesWorkspace.tsx`.
*   **Discrepancy Description:** el plan no decía una consecuencia del pedido: el aviso «¿Quieres imprimir el recibo?»
    de cada envío nuevo es para quien envía y usa el formato recordado. Con «Haití» elegido (también en los navegadores
    que ya lo tenían guardado) ese aviso pasa a imprimir el recibo corto de Haití. Ninguna prueba lo cubría.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** es lo que pide Rardiel («que también cambie el recibo de envío… dependiendo de si elijo
    Haití»), pero tiene que estar escrito para que él lo sepa, y probado.
*   ***Proposed Edit:*** sección nueva «Consecuencia que conviene saber»; paso 9, comprobación nueva en el aviso de
    impresión de un envío nuevo.

### [2] [`style`, `codebase-details`] - Severity: Major
*   **Affected Scope:** paso 13, `docs/LIMITE-POR-VISITANTE.md`.
*   **Discrepancy Description:** el párrafo nuevo dice que antes del cambio no se midió, pero el documento seguía
    diciendo más abajo «antes bajaban las dos del mismo número». Además, la medida del 17-11-2026 se insertaba sin decir
    con qué orden ni desde dónde se hizo, justo en el paso que corrige un dato mal medido.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** paso 13 con una tercera edición que quita esa frase; «Además» dice la orden, los dos equipos, la
    hora y la salida. El 403 con la cabecera falsa se repitió ese día.

### [3] [`style`, `codebase-details`] - Severity: Major
*   **Affected Scope:** pasos 8 y 11; `thermalReceipt.ts`, `docs/IMPRESION-TERMICA.md`.
*   **Discrepancy Description:** el documento de impresión dice que en los rollos de 58 y 51 mm el título ocupa dos
    líneas. Con `RECIBO DE RECEPCIÓN`, más corto, cabría en una (deducción de `egm-codebase-details` por las medidas de
    la letra, sin ejecutar). El plan dejaba la frase y un comentario de prueba que quedarían falsos.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** paso 8, comprobación nueva de que el título va en una línea en los rollos de 80 y 58 mm; paso
    11, se quita la frase (ya no se afirma nada del rollo de 51 mm, que no tiene prueba). Si la comprobación fallara,
    se dejan la frase y el comentario. Resultado al implementar: pasa; captura `reception-58-graphics.png` revisada.

### [4] [`style`, `implementation-readiness`, `codebase-details`] - Severity: Major
*   **Affected Scope:** pasos 6 a 10.
*   **Discrepancy Description:** varios pasos de prueba iban en prosa («tercer caso», «al final del bloque», «después del
    bucle», «se añade una impresión») mientras el paso 9 traía el código. Dejaban decisiones al implementador: dónde va
    el botón nuevo, si se emula la impresión antes de la captura, nombres que chocaban con `popupReady` y `popup` ya
    declarados, y si había que añadir `selectOption("common")`.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** código literal y número de línea en los pasos 6, 7, 8 y 10; el paso 9 cita las tres líneas que
    se quitan y dice que el selector ya está en `common`.

### [5] [`implementation-readiness`, `codebase-details`, `style`] - Severity: Minor
*   **Affected Scope:** paso 3; paso 7; «Comprobación».
*   **Discrepancy Description:** (a) la frase del comentario de `remittanceReceipt` que se cambiaba está partida en dos
    líneas y no se encontraba tal cual; el mismo comentario decía «common recipient format», nombre que se retira.
    (b) El paso 3 decía que `receiptSections` pasa las opciones a `isHaitiVoucher`; no lo llama. (c) Quedaba falso un
    comentario de `remittance-receipt.test.ts`. (d) El `git grep` final no vigilaba dos de los cinco nombres viejos ni
    el documento de impresión. (e) `app/server/test/remittance-card-records.test.ts` también dibuja estos recibos y no
    estaba entre las pruebas a ejecutar.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** aplicado todo: las tres líneas del comentario completas, la frase corregida, el comentario
    nuevo de la prueba, dos patrones y una ruta más en el `git grep`, y un tercer comando de pruebas.

### [6] [`implementation-readiness`] - Severity: Minor
*   **Affected Scope:** pasos 6 y 7.
*   **Discrepancy Description:** el título nuevo del caso prometía «todos los tamaños» para quien envía y solo se
    comprobaba en A4; y no quedaba fijado qué manda si están guardados a la vez el nombre nuevo y el anterior.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** paso 7, en cada tamaño el recibo de quien envía con «Haití» es idéntico al de quien recibe;
    paso 6, dos casos más (nombre anterior con valor no válido, y los dos nombres a la vez).

### [7] [`style`] - Severity: Minor
*   **Affected Scope:** primera mitad del documento.
*   **Discrepancy Description:** «comprobante» y «recibo» para el mismo impreso de Haití; «Lo que no cambia: el
    contenido…» cuando un título sí cambia; «como hasta ahora» para la casilla del recibo resumido, que con «Para quien
    envía» y «Haití» sí tenía efecto; el nombre nuevo del selector no figuraba como decisión de Claude; la opción
    «(recibo de envío)» no coincide en la tilde con `RECIBO DE ENVIO`; «recibo en pantalla» ambiguo; fechas en dos
    formatos; comillas dentro de comillas en los textos a insertar.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** aplicado: «recibo corto de Haití» en todo el documento; frases corregidas; «Fuera de alcance»
    dice que `RECIBO DE ENVIO` sigue sin tilde; fechas DD-MM-AAAA; textos a insertar en bloques.

### [8] [`style`] - Severity: Nit
*   **Affected Scope:** nombre del selector.
*   **Discrepancy Description:** «Tipo de recibo» y «Formato del recibo», contiguos, no eran paralelos.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** el selector se llama «Formato de recibo».

### [9] [`implementation-readiness`, `style`] - Severity: Nit
*   **Discrepancy Description:** la razón del orden de las sustituciones del paso 1 era falsa (distinguiendo mayúsculas
    ningún nombre contiene a otro); la razón de un solo commit no valía para el paso 13; la nota del paso 12 no cubría
    la opción «(comprobante de recepción)» del plan anterior.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** paso 1 reescrito; dos commits (el paso 13 aparte); nota del paso 12 ampliada.
