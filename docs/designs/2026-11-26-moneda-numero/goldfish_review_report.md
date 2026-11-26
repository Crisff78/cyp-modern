# Revisión EGM del plan: el idMoneda como número (protocolo 0.11)

Una sola etapa, dos revisores nuevos sobre el primer borrador de `design_draft.md` (2026-11-26):
`egm-codebase-details` (el plan contra el código) y `egm-zoom-out` (alcance). Resueltos por Claude Code (Opus 5.5).

## Bloqueante

- **La razón para no normalizar la huella de Registrar Envío era falsa** (codebase-details). El borrador decía que
  normalizarla haría fallar la repetición de envíos registrados antes del cambio. Antes solo entraban códigos
  (`currencyOf` rechaza lo demás antes de la huella), así que traducir el número al código antes de la huella deja
  valer todas las huellas guardadas. **Resuelto:** la huella cuenta la moneda por su código; repetir con `USD` o con
  `2` es el mismo envío; el contrato lo dice en 3.2 c como excepción.

## Menores

- **El Listado de Monedas movía el Nombre** (zoom-out). `idMoneda;Codigo;Nombre` lo pasaba al tercer lugar en una
  respuesta que la aplicación ya lee, y el contrato promete agregar datos al final. **Resuelto:** `idMoneda;Nombre;Codigo`.
- **La pregunta 5 no está contestada** (los dos). **Resuelto:** se queda como pregunta para confirmar los números, y
  el plan dice que, una vez confirmados, no se cambian.
- **El Dato de `TNE`** (los dos). La 0.8 devuelve como llegó el Dato que viene de la petición. **Resuelto:** `TNE` lo
  trae como llegó; `CNA` y `CSF`, que salen del envío, con el número.
- **La tabla inversa como objeto normal** dejaría pasar `constructor` (codebase-details). **Resuelto:** un `Map`, con
  pruebas de `constructor` y `__proto__`.
- **Vacío y la entrega repetida no estaban en el plan** (codebase-details). **Resuelto:** vacío sigue como hoy; la
  entrega repetida sale con números (ya rearma el registro desde la 0.8), con prueba.
- **Cambios del contrato y archivos que faltaban en la tabla** (codebase-details). **Resuelto:** añadidos, con el
  encabezado de `text-protocol.ts` y las pruebas de `withoutVersion`.
- **La pantalla de Envíos por Entregar de la otra parte mostrará números hasta que lea el cambio** (zoom-out).
  **Resuelto:** en «Lo que cuesta» y con un OJO en el contrato.
- **Afirmaciones sin fuente sobre el sistema viejo** (zoom-out). **Resuelto:** el plan dice que `table_summary.json`
  da solo nombres de columnas, en orden alfabético.
- **Desde qué versión se marca `(NUEVO)`** (zoom-out). **Resuelto sin preguntar:** desde la 0.7, la última que consta
  que se le mandó.

## Sin objeción

Poner el número en todas las salidas, como el `idCliente` en la 0.8; los números fijos sin parar a preguntar (es la
demo y las entradas siguen aceptando el código); `1`, `2` y `3` no chocan con VersionApp ni con el Modo.
