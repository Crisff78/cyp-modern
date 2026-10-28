# Sesión que termina al cerrar la pestaña y aviso de versión nueva (2026-10-26)

Dos observaciones hechas sobre la demo publicada en Render.

## 1. La sesión seguía abierta después de cerrar el navegador

**Antes:** el panel de oficina guardaba la sesión en `localStorage`, que sobrevive al cerrar
la pestaña y el navegador. Quien abría después el mismo equipo entraba con la cuenta de otra
persona, sin contraseña, durante las 8 horas que dura cada sesión.

**Ahora, en la oficina y en la app del cobrador:**

- La sesión se guarda en `sessionStorage`, que pertenece a la pestaña. Al cerrar la pestaña o el
  navegador, la próxima vez hay que iniciar sesión otra vez.
- Algunos navegadores reabren las pestañas cerradas con su `sessionStorage` (por ejemplo «Seguir
  donde lo dejaste» o Ctrl+Mayús+T). Por eso la pestaña abierta deja una marca de vida cada pocos
  segundos y al salir. Si una página arranca con una marca de más de 30 segundos, la pestaña estuvo
  cerrada y la sesión se descarta.
- Recargar la página (F5) no cierra la sesión. Tampoco una pestaña que el sistema dejó dormida y
  despertó (`document.wasDiscarded`).
- La primera vez que se abre la versión nueva se borra la sesión vieja que quedó en `localStorage`:
  todos vuelven a iniciar sesión una vez.
- Cada pestaña nueva pide iniciar sesión; las ventanas de impresión no la necesitan.

Código: `app/shared/sessionLifetime.ts`, llamado al arrancar desde `app/client-admin/src/main.tsx`
y `app/client-collector/src/main.tsx`; el token se lee en `app/client-admin/src/api.ts` y
`app/client-collector/src/api.ts`. El paso entre portales (`app/shared/sessionHandoff.ts`) usa
también `sessionStorage`.

**Límite conocido:** el servidor sigue aceptando cada sesión hasta 8 horas; el cambio impide que el
navegador la vuelva a usar. Si se quiere además cerrar las sesiones del servidor tras un tiempo sin
uso, es una decisión aparte.

## 2. Algunas personas seguían viendo una versión anterior

El servidor ya pide no guardar copias (`Cache-Control: no-store`) de la página y los archivos. Lo que
queda viejo es una pestaña que se deja abierta: sigue ejecutando la versión que cargó, aunque pasen
días (pasa mucho en el teléfono). Desde la oficina o la app del cobrador:

- Cada minuto, y al volver a la pestaña (como mucho cada 15 segundos), la página pregunta al
  servidor qué programa publica y lo compara con el que está ejecutando.
- En la pantalla de inicio de sesión no hay nada que perder: se recarga sola.
- **Con sesión abierta, también se carga sola** (28-10-2026, Rardiel: «Tienes que asegurarte de que a
  todos les salgan la versión actualizada, fuérzalo si es necesario»). Lo hace en cuanto no se pierde
  nada: ningún diálogo abierto (una pregunta, una confirmación, un formulario), nada escrito sin
  guardar en ninguna ventana y ni una tecla ni un clic durante 20 segundos (lo que se acaba de enviar
  tiene tiempo de responder). La sesión sigue: vive en la pestaña. Mientras tanto aparece arriba:
  «Hay una versión nueva del sistema. Se cargará sola en cuanto termines lo que estás haciendo (guarda
  o cierra lo abierto), o pulsa «Actualizar ahora».» Lo que se pierde al recargar son solo las
  ventanas abiertas sin nada escrito.
- Si el servidor está despertando (Render gratuito) o falla, no se avisa nada y se vuelve a intentar.

- **App del cobrador:** su service worker devolvía la página guardada cuando la app preguntaba por
  la versión nueva, así que no la veía nunca. Ahora la página se pide siempre al servidor (la copia
  guardada queda solo para usarla sin conexión) y un service worker nuevo entra en uso al momento, sin
  esperar a que se cierren todas las pestañas.
- Las pestañas que ya estaban abiertas antes de este cambio tienen el aviso viejo: verán el aviso y
  tendrán que pulsar «Actualizar ahora» (o recargar) una vez; desde ahí se actualizan solas.

### Fecha de la versión

Arriba del todo, junto a la versión, aparece cuándo se publicó la que se está usando: «Versión: CyP
Web v0.1.0 · Actualizada: 28/10/2026, 11:21 a. m.» (hora de Santo Domingo). Es la fecha del último
cambio publicado; al pasar el ratón se ve su código (el commit). Si en un equipo sale una fecha más
vieja que la del último cambio, esa pestaña aún no se ha actualizado. En la app del cobrador sale en
la ayuda («Tu ruta a un toque»). El servidor dice también qué versión publica en `/api/health`
(`version`, el commit que da Render), para comprobarlo sin entrar.

Código: `app/shared/versionWatch.ts`, `app/shared/NewVersionNotice.tsx`, `app/shared/buildInfo.ts`
(la fecha, que Vite escribe al compilar desde `vite.config.ts`) y `app/client-collector/public/sw.js`.

## Pruebas

- `app/client-collector/test/session-and-version.test.ts`: cuándo una pestaña cuenta como cerrada y
  cuándo hay versión nueva.
- `app/client-admin/test/session-version-ui.test.ts` (Edge real): la sesión vieja en `localStorage` ya
  no abre sesión; recargar la conserva; una pestaña reabierta empieza sin sesión; con un diálogo
  abierto sale el aviso, no se recarga sola y «Actualizar ahora» la carga; con algo escrito sin guardar
  espera y se carga sola en cuanto se borra; sin nada abierto se carga sola y conserva la sesión; sin
  sesión se recarga sola.
- `app/client-collector/test/session-and-version.test.ts`: también la fecha que se muestra (hora de
  Santo Domingo) y de dónde sale (el último commit, o la hora de compilar sin git).
- `app/server/test/health-version.test.ts`: `/api/health` dice la versión publicada por Render.
