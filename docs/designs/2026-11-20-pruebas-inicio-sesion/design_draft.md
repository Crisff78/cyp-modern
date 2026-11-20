# Nueve pruebas de la interfaz que fallan en `main` desde que el inicio de sesión lleva la lista de Estación

Plan escrito por Claude Code (Fable 5.2) el 2026-11-20, en la laptop de Rardiel, sobre `main` `510e2fb`. Esta es la
versión corregida tras la revisión EGM (`goldfish_review_report.md`, en esta carpeta).

Orden de Rardiel del 2026-11-20: «Haz esta tarea aquí: “Arreglar nueve pruebas de interfaz que fallan en main”».
El nombre de la tarea lo escribió la IA en una sesión anterior; el alcance es este documento.

## Qué falla y por qué

Todo lo de esta sección se comprobó ejecutando cada archivo, uno por uno, con
`pnpm --filter @cyp/server exec tsx --test --test-concurrency=1 ../client-admin/test/<archivo>`.

### Grupo 1: siete pruebas. El fallo es del producto

`embudo-filtros-ui` y las seis `teclado-*-ui` (`admin`, `altas`, `cajero`, `cobrador`, `raton`, `ventanas`), todas en
`app/client-admin/test/`.

Las seis del teclado escriben el usuario, Intro, escriben la contraseña, Intro, y esperan el menú. Se quedan en
`Timeout 15000ms`, y el arnés dice `keyboard at: SELECT «Usar vínculo actual»`. `embudo-filtros-ui` rellena los dos
campos y pulsa un solo Intro; se queda igual, esperando el menú.

La regla escrita es que eso tiene que funcionar. `docs/TECLADO-COMPLETO.md`: «Solo «Iniciar sesión» entra con Intro
en la clave, como siempre (su formulario lleva `data-keyboard-enter="send"`)».

El commit `e47fbb4` (PR #171 y #172) puso la lista de Estación debajo de la contraseña, en los dos portales
(`app/shared/LoginStation.tsx`). Su plan (`docs/designs/2026-11-19-estacion-en-login/plan.md`) no habla del teclado.
Desde entonces, cuando la lista ya cargó, `stepField` de `app/shared/keyboard.ts` encuentra un campo después de la
contraseña y lleva el teclado a él en lugar de enviar el formulario: entrar pasó de dos Intro a cuatro. Mientras la
lista carga, o si falla, está deshabilitada y el mismo Intro sí entra. Es decir: hoy, que Intro entre o no depende de
si el catálogo ya llegó.

Las pruebas, por tanto, están bien: dicen lo que la regla pide. Lo que cambió sin querer fue el formulario.

### Grupo 2: dos pruebas. No hay fallo; faltaba la compilación pública

`login-password-layout-ui` y `login-station-flow-ui`.

Las dos pasan (1 de 1 cada una) cuando `dist` tiene la compilación pública, la que hace Render (`render.yaml`):
`CYP_PUBLIC_DEMO=true`, `VITE_PUBLIC_DEMO=true` y `VITE_COLLECTOR_URL=/collector/` antes de `pnpm build`.

Qué necesita cada una:

- Las dos: el cobrador compilado para `/collector/`. Eso lo decide `CYP_PUBLIC_DEMO`
  (`app/client-collector/vite.config.ts`).
- Solo `login-station-flow-ui`: además, que la oficina entregue la sesión a `/collector/`. Eso lo decide
  `VITE_COLLECTOR_URL`; sin ella la oficina manda a `http://127.0.0.1:5174` (`app/client-admin/src/App.tsx`, línea 153).
- `VITE_PUBLIC_DEMO` solo cambia un texto del cobrador; ninguna de las dos lo mira.

Fallaban en la laptop por dos causas del entorno:

1. Con la compilación normal (`pnpm build` sin variables), el cobrador se compila para la raíz. Las dos pruebas lo
   sirven en `/collector/`, sus archivos no aparecen y la página queda en blanco. Las pruebas solo miran que exista
   `dist/index.html`: por eso fallan en lugar de omitirse, aunque su propio mensaje dice «Requires both public web
   builds».
2. En el primer intento de compilación pública, la IA olvidó `CYP_PUBLIC_DEMO` y la lanzó desde Git Bash, que
   convirtió `/collector/` en `C:/Program Files/Git/collector/`.

## Archivos

| Archivo | Qué |
| --- | --- |
| `app/shared/LoginStation.tsx` | Modificar: la lista lleva `data-capture-skip` |
| `app/shared/keyboard.ts` | Modificar: solo el comentario que define `data-capture-skip` |
| `docs/TECLADO-COMPLETO.md` | Modificar: una frase |
| `app/client-admin/test/teclado-inicio-sesion-ui.test.ts` | Crear: entrar solo con el teclado, con estaciones |
| `app/client-admin/test/login-password-layout-ui.test.ts` | Modificar: condición y mensaje de omisión |
| `app/client-admin/test/login-station-flow-ui.test.ts` | Modificar: condición y mensaje de omisión |
| `scripts/build-public.mjs` | Crear: la compilación pública, con sus variables puestas dentro de Node |
| `package.json` | Modificar: orden `build:public` |
| `README.md` | Modificar: cuándo y cómo correr las dos pruebas |

## Qué se cambia

### 1. Intro en la contraseña vuelve a entrar

`app/shared/LoginStation.tsx`:

```tsx
<select name="station" data-capture-skip value={choice?.number ?? ""} disabled={disabled || state !== "ready"}
```

Es la marca que ya existe para «Intro salta este campo; Tab y las flechas sí llegan» (hoy la usa una casilla de
Envíos). Su definición, en `keyboard.ts`, pasa a ser: «un campo que no hace falta tocar: uno que el formulario calcula
solo, o la lista opcional de Estación». Con ella:

- Intro en la contraseña: no queda ningún campo después, el formulario es `send` y el navegador lo envía. Como antes
  de `e47fbb4`, y ya sin depender de si la lista cargó.
- La lista sigue siendo una parada de Tab (contraseña, el ojo de la contraseña, la lista) y se llega a ella con ↓
  desde la contraseña. ↓ y ↑ sobre ella la abren.
- Intro sobre la lista: va al botón «Iniciar sesión» sin pulsarlo (regla de siempre para una lista al final).
- El orden de Tab y el de la página no cambian. El ratón, tampoco.

No se toca `stepField`.

**Lo que cuesta, dicho claro.** Con solo Intro el teclado ya no se para en la lista. Quien quiera elegir estación
llega con ↓ o con Tab, o con el ratón; después de entrar, también puede hacerlo en «Estaciones», arriba. Antes del
cambio tampoco se registraba nada sin elegir: la diferencia es solo que Intro obligaba a pasar por la lista. Esto
matiza cómo quedó el PR #171 y lo decide Rardiel al fusionar.

**Por qué así y no cambiando las pruebas.** La lista es opcional (entra con «Usar vínculo actual» o con la última
estación usada, que solo se comprueba, nunca se registra sola); el coste de pasar por ella lo pagaría todo el mundo en
cada entrada; la regla escrita y siete pruebas dicen que Intro en la clave entra; y así el resultado deja de depender
de la red. Añadir dos Intro a las pruebas habría dejado la regla falsa.

**Por qué no «Intro sobre la lista envía».** Intro ya elige dentro de la lista abierta: dos Intro seguidos vincularían
el navegador a una estación sin querer. `keyboard.ts` excluye las listas del envío a propósito.

### 2. Una prueba nueva: `teclado-inicio-sesion-ui.test.ts`

Con dos estaciones ficticias (A y B), portales reales, API y `MemoryStore`, sin un clic.

- **Oficina.** Espera a que la lista esté habilitada. Usuario, Intro, contraseña; ↓ lleva a «Estación»; Intro sobre
  ella lleva a «Iniciar sesión» y nadie entra (ningún `POST /api/auth/login`, con la contraseña ya escrita);
  Mayús+Tab tres veces: la lista, «Mostrar contraseña», la contraseña; Intro: el menú. Exactamente un inicio de
  sesión y ningún navegador registrado.
- **Cobrador, cuando la estación elegida no se puede usar.** Elige la estación A con su letra, vuelve a la contraseña
  e Intro. Sale el aviso «permiso de edición». La cuenta ya está comprobada, así que usuario y contraseña quedan
  bloqueados y el teclado, que estaba en la contraseña, se queda sin sitio: como en todo CyP, la primera tecla lo
  devuelve, aquí a la lista. Con «U» vuelve a «Usar vínculo actual», Intro va al botón, Intro entra. Un solo inicio de
  sesión: no se pide la contraseña otra vez.

Las siete del grupo 1 ya comprueban «contraseña, Intro, dentro» en la oficina y, con `teclado-cobrador-ui` y
`embudo-filtros-ui`, en el cobrador.

### 3. `docs/TECLADO-COMPLETO.md`

Después de «…como siempre (su formulario lleva `data-keyboard-enter="send"`).»:

> La lista de Estación que va debajo de la clave es opcional y no es parada de Intro (lleva `data-capture-skip`): se
> llega a ella con ↓ o con Tab, y desde ella Intro va a «Iniciar sesión» sin pulsarlo (20-11-2026).

### 4. La compilación pública tiene su orden, y las dos pruebas se omiten sin ella

- `scripts/build-public.mjs` y `pnpm build:public`: pone las tres variables dentro de Node y llama a `pnpm build`.
  No se puede olvidar ninguna y Git Bash no las toca.
- En las dos pruebas, la condición de `skip` pasa de «existe `dist/index.html`» a «existen los dos y el del cobrador
  pide sus archivos en `"/collector/assets/`». Mensaje: «Requires both public web builds (pnpm build:public) and
  installed Edge/Playwright».
- `README.md`, en «Construcción y comprobación»: que las dos se omiten con la compilación normal y que antes de un
  cambio en el inicio de sesión hay que compilar con `pnpm build:public` y correrlas.

Solo se mira el cobrador. No se busca dentro del paquete de la oficina si `VITE_COLLECTOR_URL` está bien: si alguien
compila a mano con una variable sí y otra no, `login-station-flow-ui` falla por tiempo (falla, no aprueba en falso).
Buscar un texto en el paquete podría, en cambio, omitir la prueba para siempre sin que nadie lo vea.

## Qué no se cambia

- La posición de la lista, sus textos, el registro de la estación y todo el servidor.
- Adónde va el teclado cuando la estación falla y las credenciales quedan bloqueadas: se queda sin sitio hasta la
  primera tecla (regla general de CyP). Llevarlo directo a la lista sería una mejora aparte.
- Los PR abiertos #175 a #178.
- No hay migración.

## Cómo se comprueba

1. Las siete del grupo 1, una por una: todas pasan.
2. La prueba nueva pasa.
3. `pnpm build` normal: las dos del grupo 2 se omiten. `pnpm build:public` (lanzado desde Git Bash, a propósito):
   las dos pasan.
4. Tipos de los tres paquetes.
5. Toda la interfaz, con la compilación pública, para ver que no queda ningún fallo. `admin-catalog-suggestions`
   seguirá fallando en esta rama hasta que se fusione el PR #177: es otro arreglo.

## Guía web consultada

Modern Web Guidance, guía `forms`: no reordenar los controles respecto al orden de Tab (no se reordena); no enviar
el formulario al cambiar un `<select>` (no se envía); botones auxiliares con `type="button"` (ya lo tienen);
comprobar `isComposing` antes de tratar Intro (ya se hace, `keyboard.ts`); probar con solo el teclado (la prueba
nueva).
