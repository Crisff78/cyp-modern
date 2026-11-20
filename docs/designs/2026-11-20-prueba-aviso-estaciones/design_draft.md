# Poner al día la prueba del aviso de Estaciones

Autor: Claude Code (Fable 5.2). Revisión EGM, una etapa. Base: `main` `510e2fb`. Fecha: 2026-11-20.

Orden de Rardiel del 2026-11-19: «Haz esta tarea aquí: “Corregir prueba vieja del aviso de Estaciones”».

## El fallo

`app/client-admin/test/admin-catalog-suggestions.test.ts`, subprueba «SUG-2.2/2.3 unvalidated stations remain
visible without enabling manual actions» (línea 316), falla en `main`:

```
The input did not match the regular expression /No validado.*RRAA/. Input:
'Sin conexión RRAA, el alta, la edición de datos y la activación de estaciones están deshabilitadas. El formato de
recepción se guarda en CyP.'
```

Comprobado ejecutándola en `main` `510e2fb` sin ningún otro cambio (2026-11-20): de 20 (19 subpruebas y la prueba
que las contiene) pasan 18; fallan esta y la contenedora.

## La causa

El commit `b07adb4` («Elegir el recibo de recepción por estación», PR #165/#166) cambió el aviso de la página de
Estaciones cuando no hay conexión con RRAA (`app/client-admin/src/ConnectedAdminTools.tsx`, el
`<p className="legacy-admin-note" role="status">`):

- antes: «No validado. Deshabilitado temporalmente hasta conexión RRAA: no se permite crear, editar ni activar…»
- ahora: «Sin conexión RRAA, el alta, la edición de datos y la activación de estaciones están deshabilitadas. El
  formato de recepción se guarda en CyP.»

El cambio fue a propósito: desde ese PR el formato del recibo sí se puede guardar sin RRAA, y el aviso viejo decía
que no se podía editar nada. La prueba no se actualizó.

## El cambio

Modificar: `app/client-admin/test/admin-catalog-suggestions.test.ts`, línea 316. Ningún otro archivo de código. La
interfaz no se toca. Este plan y su revisión entran en el mismo commit.

```diff
-      assert.match(await page.getByRole("status").innerText(), /No validado.*RRAA/);
+      assert.match(await page.getByRole("status").innerText(), /Sin conexión RRAA.*alta.*edición de datos.*activación.*deshabilitadas/);
```

La expresión nueva comprueba lo mismo que quería comprobar la vieja: que el aviso dice que, sin RRAA, no se puede
dar de alta, editar los datos ni activar. Las tres líneas siguientes de la subprueba ya comprueban que los botones
Nuevo y Editar están deshabilitados y que Inactivar no lo está; no cambian.

«No validado» sigue existiendo como texto de la columna de cada estación sin validar (`ConnectedAdminTools.tsx`,
fila de la tabla) y así lo cita `docs/RRAA-ESTACIONES.md`. Eso no cambia.

## Comprobación

- La prueba entera: `pnpm --filter @cyp/server exec tsx --test --test-concurrency=1
  ../client-admin/test/admin-catalog-suggestions.test.ts`. Tiene que dar 20 de 20 y **0 omitidas**: sin Windows, Edge
  y Playwright la prueba se omite, y omitida no es pasar. Resultado del 2026-11-20 en esta rama: 20 pasan, 0 fallan,
  0 omitidas. Es la primera vez desde `b07adb4` que corren las líneas 317 a 321 de la subprueba, y pasan.
- `pnpm typecheck`.

## Fuera de alcance

En la misma corrida de `main` fallan otras nueve pruebas de la interfaz (el embudo de filtros, las seis del teclado,
el encaje del inicio de sesión y la estación en el inicio de sesión). No son un texto viejo: tienen que ver con el
formulario de inicio de sesión, que desde los PR #171 a #174 lleva la lista de Estación entre la contraseña y el
botón. Decidir si hay que cambiar las pruebas o el formulario es otra tarea.
