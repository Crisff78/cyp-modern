# Revisión EGM del plan y cómo se resolvió

Dos revisores nuevos leyeron el plan y el código el 2026-11-20, antes de implementar: `egm-codebase-details` (los
hechos, contra el código) y `egm-design` (las decisiones). Ninguno encontró bloqueantes. Los dos confirman que el
cambio del producto es correcto en los dos portales. Lo que sigue es lo que señalaron y qué se hizo; lo escribe Claude
Code (Fable 5.2).

## Aplicado

| # | Hallazgo | Qué se hizo |
| --- | --- | --- |
| 1 | Un solo Mayús+Tab no vuelve del botón a la contraseña: pasa por la lista y por «Mostrar contraseña». | La prueba nueva da los tres pasos y comprueba cada uno. |
| 2 | «Ningún `POST`» no probaba nada con la contraseña vacía: el navegador no envía un campo obligatorio vacío. | La contraseña se escribe antes; al final se exige exactamente un inicio de sesión. |
| 3 | ↓ solo llega a la lista si ya cargó; cargando está deshabilitada y ↓ va al botón. | La prueba espera a que la lista esté habilitada y con sus opciones. |
| 4 | El plan callaba el coste: con solo Intro el teclado ya no se para en la lista. | Dicho en el plan, en el PR y a Rardiel, que decide al fusionar. |
| 5 | Argumento que faltaba: hoy que Intro entre o no depende de si el catálogo llegó. | Añadido al plan. |
| 6 | Nadie probaba con el teclado el caso «la estación falla y las credenciales quedan bloqueadas», que ahora se alcanza con Intro desde la contraseña. | Segunda parte de la prueba nueva. Comprobado en el navegador: el teclado queda sin sitio y la primera tecla lo pone en la lista. |
| 7 | Omitir las dos pruebas del grupo 2 es correcto, pero quedarían omitidas siempre: `pnpm check` termina con una compilación normal y nadie sabía cómo hacer la pública. | `scripts/build-public.mjs`, `pnpm build:public`, el mensaje de omisión lo nombra y el README dice cuándo correrlas. |
| 8 | La definición de `data-capture-skip` decía «un campo que el formulario calcula solo». | Redefinida en `keyboard.ts`: «un campo que no hace falta tocar». |
| 9 | Imprecisiones: `embudo-filtros-ui` no entra igual que las otras; `teclado-cobrador-ui` ya es una de las seis; Tab pasa antes por el ojo; «de dos Intro a cuatro» solo con la lista cargada. | Corregidas en el plan. |
| 10 | Faltaban la lista de archivos con su ruta y los textos exactos. | Añadidos al plan. |

## No aplicado, y por qué

- **Omitir `login-station-flow-ui` también si el paquete de la oficina contiene `127.0.0.1:5174`.** Depende de cómo
  minimiza Vite y, si un día ese texto aparece por otro motivo, la prueba se omitiría para siempre sin avisar. Con
  una variable sí y otra no, la prueba falla por tiempo: se ve. `pnpm build:public` quita la causa real.
- **Fallar con un mensaje que nombre `VITE_COLLECTOR_URL` antes de la entrega al cobrador.** Mismo motivo: con la
  orden nueva ya no se compila a mano.
- **Cambiar también el comentario de `app/shared/remittances/formKeyboard.ts`.** Habla de su propio formulario (la
  casilla que calcula Envíos) y sigue siendo cierto. La definición general está en `keyboard.ts`.
- **Llevar el teclado directo a la lista cuando las credenciales quedan bloqueadas.** Mejoraría ese caso, pero es otro
  cambio del producto (tres archivos). Queda anotado en el plan como mejora aparte.
- **Pedir el sí de Rardiel antes de implementar.** Rardiel encargó la tarea entera; el coste se le dice sin rodeos y
  lo decide al fusionar los PR.

## Sin hallazgo

- Intro en la contraseña envía en los dos portales y en todos los estados de la lista (cargando, error, lista, con
  estación recordada). Con las credenciales bloqueadas no se atasca.
- `data-capture-skip` solo lo leen `keyboard.ts` y `formKeyboard.ts`; ningún CSS ni otra prueba.
- Mirar solo el `index.html` del cobrador nunca omite una compilación que habría pasado.
