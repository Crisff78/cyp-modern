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

- Cada 5 minutos, y al volver a la pestaña (como mucho una vez por minuto), la página pregunta al
  servidor qué programa publica y lo compara con el que está ejecutando.
- Si cambió, con sesión abierta aparece arriba: «Hay una versión nueva del sistema. Guarda lo que
  estés haciendo y pulsa «Actualizar ahora».» No se recarga sola para no perder lo que se esté
  escribiendo.
- En la pantalla de inicio de sesión no hay nada que perder: se recarga sola.
- Si el servidor está despertando (Render gratuito) o falla, no se avisa nada y se vuelve a intentar.

Código: `app/shared/versionWatch.ts` y `app/shared/NewVersionNotice.tsx`.

## Pruebas

- `app/client-collector/test/session-and-version.test.ts`: cuándo una pestaña cuenta como cerrada y
  cuándo hay versión nueva.
- `app/client-admin/test/session-version-ui.test.ts` (Edge real): la sesión vieja en `localStorage` ya
  no abre sesión; recargar la conserva; una pestaña reabierta empieza sin sesión; con sesión sale el
  aviso y «Actualizar ahora» carga la versión nueva; sin sesión se recarga sola.
