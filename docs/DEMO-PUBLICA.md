# Demo pública de CyP Modern

`render.yaml` despliega una API Fastify, el portal de administración en `/` y
el portal del cobrador en `/collector/` bajo un mismo dominio HTTPS de Render.
Los visitantes no necesitan cuenta de ChatGPT ni instalar el proyecto.

La base PostgreSQL dedicada `cyp_demo` puede alojarse en Neon o Supabase. En una
instalación nueva autorizada, al estar vacía, el servidor agrega datos ficticios
de clientes, cobradores, cobros, pagos, tasas y envíos. Para trasladar una demo
existente se deben copiar primero todos sus registros; una base vacía no
sustituye esa transferencia. No se copia la base de la laptop ni se publica `.env`.
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

### Actualizar la demo existente

El servicio `cyp-modern-demo` publica automáticamente la rama
`codex/public-browser-demo`. Para actualizarlo, comprobar el estado actual,
abrir un PR hacia `main`, esperar CI y fusionar el commit revisado. Después,
avanzar la rama de demo al merge mediante fast-forward, sin `force`, y verificar
que CI y el deployment exitoso pertenecen al mismo SHA. Reutilizar el servicio
Render y su URL existentes. La comprobación pública es de lectura; las pruebas
con escritura se ejecutan en entornos aislados con ejemplos ficticios.

### Trasladar la base de Neon a Supabase conservando todos los registros

**Estado: procedimiento preparado; migración pendiente.** La solicitud vigente
es conservar todos los registros de Neon y el mismo servicio y URL de Render.
Se ha comunicado que Neon está suspendido y muestra 5,57 GB de transferencia;
esa cifra de tráfico no determina el tamaño de la base. No hay autorización
para reemplazar sus registros por ejemplos nuevos.

1. Conserva Neon y consigue una copia completa y consistente mediante
   `pg_dump`, con esquema y datos de `cyp_demo`, o un respaldo completo existente
   cuya integridad y fecha puedan verificarse. El snapshot de la interfaz o de
   la API no es un respaldo completo: puede omitir tablas, sesiones, historial,
   idempotencia y otros registros persistidos. Si la suspensión impide obtener
   la copia y no existe un respaldo íntegro, el traslado queda pendiente; no
   cambies `DATABASE_URL` ni arranques una base vacía como sustituto.
2. Comprueba el tamaño real y la capacidad del destino antes de restaurar.
   Crea el proyecto Supabase y una base adicional llamada `cyp_demo`, mediante
   una conexión administrativa PostgreSQL. Mantén apagada la Data API de
   Supabase: la aplicación sigue usando su API Fastify y su autenticación
   actuales. Las bases adicionales funcionan mediante clientes PostgreSQL,
   aunque el dashboard y los servicios integrados de Supabase solo gestionan
   la base predeterminada `postgres`.
   [Bases adicionales en Supabase](https://supabase.com/docs/guides/troubleshooting/manually-created-databases-are-not-visible-in-the-supabase-dashboard-4415aa).
3. Para CyP en Render, copia desde **Connect → Session pooler** el host y el
   usuario reales del proyecto, usa el puerto **5432** y selecciona `cyp_demo`
   como base. Configura `sslmode=verify-full` y `sslrootcert` apuntando al
   certificado raíz público descargado del dashboard, disponible como archivo
   en Render. No publiques la cadena de conexión ni contraseñas. La conexión
   directa es la recomendada para dump/restauración cuando haya IPv6 disponible;
   el Session pooler permite la conexión persistente por IPv4. Comprueba la
   conexión elegida antes de transferir; el Transaction pooler de 6543 no es
   la conexión prevista para este procedimiento.
   [Conexiones PostgreSQL y TLS de Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).
4. Restaura la copia completa en `cyp_demo` todavía vacía. Revisa la
   compatibilidad de versiones, extensiones, roles y permisos sin descartar registros.
   El destino preparado el 10 de octubre usa PostgreSQL 17.11; el origen Neon
   usa PostgreSQL 18.6. El cliente de exportación debe admitir la versión del
   origen. Una restauración de una versión mayor a una menor necesita una
   comprobación aislada del esquema y los datos antes de cambiar la conexión;
   no presupongas que un dump de PostgreSQL 18 se acepta íntegro en 17.
   Verifica el inventario y los conteos de todas las tablas de la aplicación,
   el historial de migraciones, restricciones, secuencias y totales de negocio
   frente al origen o al respaldo. Incluye los registros que no muestra la
   interfaz. Conserva el dump de forma privada; una pantalla con algunos
   clientes o envíos no acredita la transferencia completa.
5. Solo después de restaurar y verificar, cambia `DATABASE_URL` en el servicio
   Render existente, conservando su URL y las variables de autenticación e
   invitación. Coordina una ventana sin escrituras para que la copia final sea
   consistente si Neon vuelve a admitir cambios. Comprueba salud, acceso y
   lecturas de los registros trasladados sin escribir pruebas en la demo
   compartida. No elimines Neon ni el respaldo. Si ya entraron escrituras en
   Supabase, reconcílialas antes de volver al origen para evitar perderlas.

Una instalación con datos nuevos solo puede sustituir esta copia completa si
se autoriza expresamente renunciar a los registros anteriores. Esa autorización
no se ha recibido.

### Crear una instalación nueva

Estos pasos son para una instalación nueva autorizada. El traslado anterior
reutiliza Render; no necesita otro servicio ni otro dominio.

1. Revisa y fusiona la rama de la demo en `main`.
2. En la cuenta de Render que ya tiene conectado `Crisff78/cyp-modern`, crea un
   **Blueprint Instance** para ese repositorio y la rama `main`.
3. Antes de confirmar, comprueba que el único recurso es el servicio web `free`.
   Guarda la conexión PostgreSQL de la base dedicada `cyp_demo` de Neon o
   Supabase en `DATABASE_URL`, con TLS verificado. Para Supabase usa el Session
   pooler y el certificado descritos arriba. Render genera `JWT_SECRET`. Configura
   `DEMO_ACCESS_CODE` con 9 a 256 caracteres; una invitación más corta es más
   fácil de adivinar y debe compartirse solo para esta demo de datos ficticios.
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
Neon, Supabase ni ChatGPT. Cambiar el código invalida las invitaciones anteriores.
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
- La base externa puede ser Neon o Supabase; el PostgreSQL Free de Render
  vence a los 30 días. Neon conserva el almacenamiento al suspender el cómputo.
  Su plan gratuito mantiene cuotas de almacenamiento, cómputo y transferencia;
  no es ilimitado.
  La retención de restauración gratuita es limitada y no sustituye un respaldo
  operativo para datos reales.
- Supabase Free incluye **500 MB de base de datos**, **5 GB de transferencia**,
  un máximo de **dos proyectos activos** y pausa proyectos tras una semana
  de inactividad. La copia completa debe caber en la cuota del destino; cambiar
  de proveedor no elimina los límites ni garantiza disponibilidad permanente.
  [Cuotas de Supabase](https://supabase.com/pricing).
- Los cambios actuales reducen de cuatro a dos las llamadas `Store.read` por
  snapshot persistido. Los intervalos automáticos de Administración solo
  consultan con la pestaña visible y conexión disponible; conservan sus
  frecuencias y los refrescos manuales. Esto reduce trabajo innecesario, pero
  no acredita un porcentaje de ahorro en bytes ni resuelve por sí solo la
  suspensión o las cuotas de un proveedor.
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
[Neon Free](https://neon.com/pricing),
[Supabase PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres),
[bases adicionales de Supabase](https://supabase.com/docs/guides/troubleshooting/manually-created-databases-are-not-visible-in-the-supabase-dashboard-4415aa) y
[Supabase Free](https://supabase.com/pricing).
