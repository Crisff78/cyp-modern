# Demo pública de CyP Modern

`render.yaml` despliega una API Fastify, el portal de administración en `/` y
el portal del cobrador en `/collector/` bajo un mismo dominio HTTPS de Render.
Los visitantes no necesitan cuenta de ChatGPT ni instalar el proyecto.

La base PostgreSQL `cyp_demo` se crea en el plan gratuito de Neon y es exclusiva de la demo. Al estar
vacía, el servidor agrega datos ficticios de clientes, cobradores, cobros,
pagos, tasas y envíos. No se copia la base de la laptop ni se publica `.env`.
Las credenciales ficticias de ambos roles se describen en el README. Los
cambios que haga un evaluador serán visibles para los demás porque comparten
la misma base de demostración. No introduzcas datos de personas ni operaciones
reales.

## Ejemplos para recorrer la aplicación

El arranque público agrega una ampliación identificada como `public-v2` y
`collector-v2`. Se guarda una marca persistente en la misma transacción que los
registros: reiniciar o publicar de nuevo no duplica los ejemplos ni repone los que
un evaluador haya editado. Solo se ejecuta con ambos modos de demo activados y
la base dedicada `cyp_demo`. Las instalaciones locales normales quedan intactas.

- Clientes, zonas, rutas, servicios y motivos con etiquetas de demostración.
- Cargos, cobros, descargos, pagos, entregas y depósitos en distintos estados.
- Historial de seis jornadas cerradas de cobradores de ejemplo y una jornada
  abierta. Para verlo en reportes, selecciona la semana de la primera carga.
- Tasas y envíos DOP/USD/EUR con recibos pagados, pendientes y cancelaciones.
- Grupos, PCPs, estaciones, máquinas, plantillas de cargos y solicitudes de
  autorización. Las cuentas ficticias adicionales están deshabilitadas; se
  conservan los accesos habituales de Administración y Cobrador.
- Doce comercios de práctica adicionales en la ruta del cobrador habitual,
  con cargos y autorizaciones de pago pendientes. Los límites, fondos, jornadas
  y permisos normales siguen aplicándose al operar.

Los datos anteriores se conservan. El historial nuevo se construye aparte usando
las reglas del dominio, con cierres equilibrados y detección de colisiones antes
de incorporarlo. No se alteran cajas anteriores ni tasas que ya existían.
Las fechas se fijan en la primera carga; no avanzan artificialmente cada día.
Los teléfonos de los nuevos ejemplos están vacíos y los correos usan
`example.invalid`. Las coordenadas son de demostración.

**Descargos Recurrentes** queda oculto en el menú, en la ficha del cliente y en
las aperturas directas. El código y los registros se conservan. La constante
`SHOW_RECURRING_PAYOUTS` del portal administrativo permite reactivar su interfaz.
**Cargos Recurrentes** continúa disponible.

## Publicación

1. Revisa y fusiona la rama de la demo en `main`.
2. En la cuenta de Render que ya tiene conectado `Crisff78/cyp-modern`, crea un
   **Blueprint Instance** para ese repositorio y la rama `main`.
3. Antes de confirmar, comprueba que el único recurso es el servicio web `free`.
   Guarda la conexión de la base Neon `cyp_demo` en `DATABASE_URL`, con TLS
   (`sslmode=verify-full`). Render genera `JWT_SECRET` y `DEMO_ACCESS_CODE`.
   No introduzcas contraseñas de la instalación local ni publiques estas variables.
4. Espera el deploy y comprueba `GET /api/health`, `/`, `/collector/`, el login
   de ambos roles y un flujo de Envío/Recibo. `/` debe pedir primero la invitación.
   El enlace público será el dominio
   HTTPS `onrender.com` que muestre Render.

El comando de inicio aplica migraciones idempotentes antes de abrir el puerto.
Si la migración o la conexión a PostgreSQL fallan, la API no inicia y no usa
silenciosamente un archivo local.

Comparte el dominio y el código `DEMO_ACCESS_CODE` únicamente con los evaluadores.
La invitación habilita una cookie segura de ocho horas; después se necesita el
inicio de sesión del programa. Los visitantes no necesitan cuentas en Render,
Neon ni ChatGPT. Cambiar el código invalida las invitaciones anteriores.
Las sesiones del programa se pueden consultar y cerrar desde Administración.
Al actualizar desde una versión sin sesiones persistidas, hay que iniciar sesión
de nuevo. Las trazas registran acciones nuevas, sin cuerpos ni contraseñas.

El esquema incluye las migraciones 014 (anulaciones con historial inmutable) y
015 (estaciones, grupos, PCPs, sesiones, solicitudes y trazas). El alta central
de cobros guarda todas sus líneas o ninguna. Las anulaciones se limitan a la
jornada actual abierta y respetan los fondos disponibles. Las solicitudes de
autorización registran una decisión administrativa; no crean pagos ni alteran
límites de caja. Las licencias de estaciones son metadatos registrados manualmente.

## Límites de esta demo gratuita

- Render puede dormir el servicio tras 15 minutos sin tráfico. La primera
  visita posterior puede tardar mientras arranca.
- Se usa Neon en lugar del PostgreSQL Free de Render, que vence a los 30 días.
  Neon conserva el almacenamiento al suspender el cómputo. Su plan gratuito
  mantiene cuotas de almacenamiento, cómputo y transferencia; no es ilimitado.
  La retención de restauración gratuita es limitada y no sustituye un respaldo
  operativo para datos reales.
- El GPS del cobrador se activa voluntariamente en el navegador. Si se pulsa
  «Compartir ubicación», las coordenadas reales se envían a la base compartida
  y pueden verse desde el panel administrativo de la demo. Usa un dispositivo
  de prueba y permiso consciente para verificarlo; no se ha certificado la
  precisión física desde esta laptop.
- Los evaluadores comparten una base: los cambios de uno aparecen al otro.
- La impresión usa las funciones del navegador y del dispositivo disponible.
  El alojamiento no da acceso automático a impresoras de la red de la laptop.

Referencias de la plataforma: [Render Free](https://render.com/docs/free),
[Blueprints](https://render.com/docs/blueprint-spec) y
[Web Services](https://render.com/docs/web-services),
[Neon Free](https://neon.com/pricing).
