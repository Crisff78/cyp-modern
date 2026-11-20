# Revisión EGM: prueba del aviso de Estaciones

Fecha: 2026-11-20. Autor del plan: Claude Code (Fable 5.2). Una etapa, un revisor nuevo (`egm-codebase-details`), por
lectura del plan, la prueba y el componente.

## Veredicto

Sin hallazgos bloqueantes ni importantes. El cambio de una línea es correcto y los hechos del plan coinciden con el
código.

## Comprobado por el revisor

- El aviso tiene tres variantes (`ConnectedAdminTools.tsx`, el `<p className="legacy-admin-note" role="status">`): con
  el control de prueba de la demo, con RRAA real y sin RRAA. La prueba corre sin RRAA (`buildApp` sin `rraa` ni
  `demoStationControl`), así que se muestra la tercera, que es el texto que cita el plan.
- `page.getByRole("status")` resuelve a un solo elemento en ese momento: los demás `role="status"` de la página no
  están presentes al abrir Estaciones.
- La expresión nueva coincide con el texto actual en orden y en acentos, y no confunde las otras dos variantes.
- No queda ninguna otra prueba ni documento que cite el aviso viejo. «No validado» sigue siendo, y está bien, la
  etiqueta de cada estación sin validar.
- El resto de las subpruebas de estaciones del archivo coincide con el componente actual.

## Hallazgos menores y qué se hizo

| # | Hallazgo | Resolución |
| --- | --- | --- |
| 1 | Las líneas 317 a 321 de la subprueba no se ejecutaban en `main` porque la 316 fallaba antes. | Ejecutada la prueba en esta rama: 20 de 20. Anotado en el plan. |
| 2 | Son 19 subpruebas más la contenedora, no «20 subpruebas». | Corregido en el plan. |
| 3 | Sin Windows, Edge y Playwright la prueba se omite, y eso no es pasar. | El plan exige «0 omitidas». |
| 4 | Faltaba decir que no se toca ningún otro archivo. | Añadido. |

## Fuera de alcance, sin tocar

- Con `CYP_QA_CATALOG_CASE=station-status` el recibo de la prueba espera 4 subpruebas y el filtro selecciona 3. Es
  solo un campo del recibo, sin aserción.
- Otras nueve pruebas de la interfaz fallan en `main` por el formulario de inicio de sesión con la lista de Estación
  (PR #171 a #174). Es otra tarea.
