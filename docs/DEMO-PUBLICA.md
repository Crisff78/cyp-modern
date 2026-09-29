# Demo pública de CyP Modern

`render.yaml` despliega una API Fastify, el portal de administración en `/` y
el portal del cobrador en `/collector/` bajo un mismo dominio HTTPS de Render.
Los visitantes no necesitan cuenta de ChatGPT ni instalar el proyecto.

La base PostgreSQL creada por el Blueprint es exclusiva de la demo. Al estar
vacía, el servidor agrega datos ficticios de clientes, cobradores, cobros,
pagos, tasas y envíos. No se copia la base de la laptop ni se publica `.env`.
Las credenciales ficticias de ambos roles se describen en el README. Los
cambios que haga un evaluador serán visibles para los demás porque comparten
la misma base de demostración. No introduzcas datos de personas ni operaciones
reales.

## Publicación

1. Revisa y fusiona la rama de la demo en `main`.
2. En la cuenta de Render que ya tiene conectado `Crisff78/cyp-modern`, crea un
   **Blueprint Instance** para ese repositorio y la rama `main`.
3. Antes de confirmar, comprueba que los dos recursos indican `free`: web y
   PostgreSQL. El secreto `JWT_SECRET` lo genera Render; no introduzcas
   contraseñas de la instalación local.
4. Espera el deploy y comprueba `GET /api/health`, `/`, `/collector/`, el login
   de ambos roles y un flujo de Envío/Recibo. El enlace público será el dominio
   HTTPS `onrender.com` que muestre Render.

El comando de inicio aplica migraciones idempotentes antes de abrir el puerto.
Si la migración o la conexión a PostgreSQL fallan, la API no inicia y no usa
silenciosamente un archivo local.

## Límites de esta demo gratuita

- Render puede dormir el servicio tras 15 minutos sin tráfico. La primera
  visita posterior puede tardar mientras arranca.
- PostgreSQL Free expira a los 30 días y no incluye respaldo administrado.
  Para conservar los cambios de los evaluadores, migra o cambia a un plan con
  persistencia antes de esa fecha.
- El GPS del cobrador se activa voluntariamente en el navegador. Si se pulsa
  «Compartir ubicación», las coordenadas reales se envían a la base compartida
  y pueden verse desde el panel administrativo de la demo. Usa un dispositivo
  de prueba y permiso consciente para verificarlo; no se ha certificado la
  precisión física desde esta laptop.
- Algunas pantallas heredadas de administración aún usan rutas `/mock/admin/`
  que devuelven 501 en modo conectado. Esta publicación habilita los flujos
  implementados; no convierte esas acciones pendientes en funcionalidades
  reales.

Referencias de la plataforma: [Render Free](https://render.com/docs/free),
[Blueprints](https://render.com/docs/blueprint-spec) y
[Web Services](https://render.com/docs/web-services).
