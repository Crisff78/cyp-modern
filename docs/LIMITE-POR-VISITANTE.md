# Límite de peticiones por visitante (R5, 13-11-2026)

## Qué pasaba

El servidor deja 120 peticiones por minuto a cada dirección, y 10 por minuto para entrar o para escribir el código de
invitación. En Render el servidor no ve la dirección del visitante, sino la del proxy de Render, así que **todos los
visitantes compartían el mismo límite**: varias personas revisando a la vez podían agotarlo entre todas.

Comprobado en la demo el 13-11-2026: una petición hecha desde otra red gastó del mismo contador que las de la laptop
(`x-ratelimit-remaining` pasó de 119 a 117).

## Qué cambia

En Render (variable `RENDER=true`, que pone Render) el límite se cuenta con la dirección que Cloudflare escribe en la
cabecera `CF-Connecting-IP`. Cada visitante tiene su propio límite.

- Fuera de Render no cambia nada: se sigue usando la dirección de la conexión.
- Si la cabecera falta o no es una dirección, también se usa la de la conexión, como antes.
- Solo afecta al límite de peticiones. Nada más del sistema usa la dirección del visitante.

## Por qué no `trustProxy`

El hallazgo proponía activar `trustProxy` en Fastify. Aquí no sirve:

- Render **añade** su dato a `X-Forwarded-For` sin borrar lo que mande el visitante. Con `trustProxy: true` cualquiera
  podría escribir la dirección que quisiera y saltarse el límite de intentos de entrada.
- Fastify 5.12 ya no acepta confiar «por número de saltos» (`trustProxy: 1`), precisamente por ese riesgo.
- `CF-Connecting-IP` no se puede falsear desde fuera: Cloudflare, que está delante de Render, rechaza con 403 la petición
  que la trae (comprobado en la demo el 13-11-2026). `True-Client-IP` sí pasa, por eso no se usa.

## Cómo comprobarlo después de publicar

Repetir esta orden desde dos redes distintas (por ejemplo, la laptop y el teléfono con datos):

```bash
curl -s -o /dev/null -D - https://cyp-modern-demo.onrender.com/api/health
```

Cada red debe llevar su propia cuenta en `x-ratelimit-remaining`; antes bajaban las dos del mismo número. Y la misma orden
con `-H "CF-Connecting-IP: 203.0.113.9"` debe seguir respondiendo 403.

## Si CyP se instala en otro servidor

Este ajuste solo se activa en Render. Detrás de otro proxy (por ejemplo, el servidor de la empresa) habrá que indicar
qué cabecera pone ese proxy, y solo si los visitantes no pueden enviarla ellos mismos.

Pruebas: `app/server/test/client-address.test.ts`.

Fuentes: [variables que pone Render](https://render.com/docs/environment-variables),
[cabeceras de Cloudflare](https://developers.cloudflare.com/fundamentals/reference/http-headers/),
[`trustProxy` en Fastify](https://fastify.dev/docs/latest/Reference/Server/).
