# Goldfish Annotated Review Report

**Target:** `design_draft.md` (sección «Detailed Implementation Plan», líneas 31-103 de la primera versión)

EGM, etapa 9 (lista para implementar), 2026-11-17. Cambio pequeño: una sola etapa. Tres revisores sin el contexto de la
conversación, lanzados por Claude Code (Fable 5.2): `egm-implementation-readiness`, `egm-codebase-details` y
`egm-style`. Los tres terminaron. Resolución (`egm-resolve`) hecha por el autor del plan; Rardiel no estaba delante,
así que las correcciones se aplicaron sin esperar su visto bueno, como indican las reglas del Superbrain. Sin hallazgos
`CONTEST` ni `ESCALATE`.

Resultado: ningún bloqueo, 4 puntos importantes y varios menores, todos corregidos en `design_draft.md`. Los tres
revisores comprobaron que el cambio de código y las dos ediciones de pruebas coinciden con el repositorio y que ninguna
otra prueba se rompe.

## Prioritized Findings & AI Suggestions

### [1] [`implementation-readiness`, `codebase-details`, `style`] - Severity: Major
*   **Affected Scope:** paso 4, `docs/IMPRESION-TERMICA.md`.
*   **Discrepancy Description:** el paso daba dos sitios distintos para la frase nueva: «al final del punto 3» y
    «después de "…y se recuerda en el navegador."», que es el final de su primera frase, no del punto.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** un solo sitio (tras la primera frase del punto 3) y la frase en un bloque, reescrita para que
    se entienda sola.

### [2] [`implementation-readiness`, `codebase-details`] - Severity: Major
*   **Affected Scope:** plan entero; `RemittancesWorkspace.tsx`.
*   **Discrepancy Description:** el panel se dibuja en dos sitios y el plan solo hablaba de la ventana del recibo. El
    otro es el diálogo «¿Quieres imprimir el recibo?», que sale tras cada envío y siempre para quien envía; también en
    el terminal del cobrador. Con el cambio, el selector se verá ahí en cada envío nuevo. Ninguna prueba lo comprobaba.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** es consecuencia directa del pedido («Deja esto también cuando pongo que el recibo es para quien
    envía»), pero tiene que estar escrito y probado.
*   ***Proposed Edit:*** «Cómo está hoy» y «Qué cambia» nombran los dos sitios; paso 2, comprobación nueva en el diálogo
    de impresión.

### [3] [`implementation-readiness`, `codebase-details`] - Severity: Major
*   **Affected Scope:** paso 2.
*   **Discrepancy Description:** ninguna prueba demostraba lo único nuevo que se puede hacer: elegir el formato con
    «Para quien envía» y que valga al volver a «Para quien recibe». La comprobación añadida era negativa y pasaba igual
    aunque la elección no se guardara.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** paso 2: se comprueba que el selector queda en `haiti` y, al final del caso, que al volver a
    «Para quien recibe» la vista previa dice «Formato de Haití».

### [4] [`codebase-details`, `implementation-readiness`, `style`] - Severity: Major
*   **Affected Scope:** «Comprobación».
*   **Discrepancy Description:** la frase sobre la prueba de teclado era falsa: no recorre con Tab el panel con «Para
    quien envía». Y dos de las seis pruebas listadas usan otro componente (`ReceiptPaperSelect`), mientras que tres que
    sí dibujan este panel no estaban.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** lista corregida (siete archivos: salen `collector-login-ui` y `login-notifications`; entran
    `cashier-shell-ui`, `remittance-workspace-corrections-ui` y `teclado-ventanas-ui`) y la frase dice lo que hace la
    prueba de teclado.

### [5] [`style`, `implementation-readiness`, `codebase-details`] - Severity: Nit
*   **Discrepancy Description:** el paso 1 parecía de una línea y la expresión ocupa cuatro; no se decía que es una sola
    fase; los textos a insertar iban entre comillas angulares que contenían otras; «pruebas» y «comprobación» con dos
    sentidos; rutas descritas como relativas a la raíz sin serlo todas; sin criterio de aprobado para los comandos.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** aplicado todo en la nueva redacción.

### [6] [`codebase-details`, `style`] - Severity: Nit
*   **Discrepancy Description:** el plan anterior (`2026-11-17-comprobante-recepcion/design_draft.md`) dice en cuatro
    sitios que el selector se oculta, y el paso 5 solo anotaba uno.
*   ***AI Suggestion:*** PROPOSE FIX en dos sitios (punto 2 de «Qué cambia» y la viñeta de decisiones); DECLINE en los
    otros dos, que son el bloque de código y la lista de pruebas de un plan ya ejecutado.

## Resolución

Aplicadas todas las correcciones `PROPOSE FIX` en `design_draft.md` el 2026-11-17. No se repitió la revisión: las
correcciones son de documentación y de pruebas, y los tres revisores dieron por correcto el cambio de código.
