# CyP Modern — estado compartido

Este archivo resume el estado operativo para quienes trabajan en CyP Modern. La
historia detallada pertenece al Superbrain del proyecto. Antes de actuar, comprobar
el código, la rama y el entorno real; este archivo no sustituye esa verificación.

## Objetivo

Mantener la API REST, el portal administrativo y la PWA del cobrador para cobros,
pagos autorizados, envíos de dinero, seguimiento y cuadre. CyP Modern es un
proyecto separado de Hermes-BI.

## Stack y límites

- Node.js 22.12 o posterior, TypeScript, pnpm y un único `pnpm-lock.yaml`.
- `app/server`: Fastify, PostgreSQL, dominio, migraciones y pruebas.
- `app/client-admin`: portal React/Vite. `app/client-collector`: PWA React/Vite.
- Puertos de desarrollo: API 3001, administración 5173 y cobrador 5174.
- PostgreSQL es el almacén del modo real. La demo requiere activación explícita:
  sin `DATABASE_URL` usa un archivo local; con esa variable abre la base indicada
  y habilita cuentas demo. Usar solo una base dedicada con datos ficticios.
- Los secretos, respaldos, extractos y datos de clientes quedan fuera de Git.
  El repositorio público contiene migraciones y ejemplos ficticios.
- No se usa Docker ni SQL Server para este proyecto.

## Decisiones activas

- El libro original de cobros en DOP y la caja de envíos por operador/moneda son
  independientes. Consultar [docs/ENVIOS-API.md](docs/ENVIOS-API.md) para reglas
  de tasas, comisión, actores, pago completo, cancelación y reportes.
- Los importes, permisos, estados, referencias e idempotencia se validan en la
  API; la interfaz no decide el saldo contable.
- Los monitores C/Z/R usan el mapa conectado a la API local. `MapViewer` de
  CobranzaMapas queda sin activar hasta contar con origen y sesión reales; su
  UUID de muestra no acredita una sesión válida.
- GPS requiere permiso explícito del dispositivo y HTTPS al salir de localhost.
  Una prueba automatizada no acredita precisión física.
- La base definitiva y los respaldos no se suben al repositorio público. Cada
  integrante prepara su propia configuración y aplica las migraciones que necesite.

## Current state

**Last updated:** 2026-09-29 por Codex.

### Done so far

- PR #1 fusionado en `main` (`666e100`). Rama `codex/public-browser-demo` con
  `ba2b077` subida bajo excepción puntual autorizada; PR #2 abierto en borrador,
  CI de ese commit aprobado. Los cambios nuevos completan esta misma rama.
- Alta central atómica; anulación de cobros, pagos y entregas con motivo,
  jornada actual abierta y reglas de saldo; archivo de descargos recurrentes.
  Estaciones/grupos/PCPs con asociaciones, sesiones reales revocables, trazas
  sin cuerpos y solicitudes administrativas sin efecto contable. Migraciones 014/015.
- Demo con API y ambos portales bajo un dominio, acceso por invitación y cookies
  seguras. Base dedicada `cyp_demo`, validada antes de migrar. No copia datos locales.
- Alojamiento elegido por Rardiel: gratuito para pruebas. Render web y Neon
  PostgreSQL, con variables privadas fuera de Git. Base Neon creada, servicio web
  y comprobación pública aún pendientes. Ver `docs/DEMO-PUBLICA.md`.
- TypeScript y builds de los tres paquetes aprobados. Servidor: 51 pruebas
  aprobadas, cuatro casos PostgreSQL comprobados
  aparte con éxito en un cluster temporal aislado. Migraciones 001–015 aprobadas.
  Vite conserva advertencia por tamaño de bundle.
- Instalación definitiva local 3001/5173/5174 sin modificar en esta ampliación.

### Next step

1. Subir la ampliación probada a PR #2 tras resolver el rechazo del filtro de
   privacidad de hermes-laptop, y revisar CI. No incluir estado local ni credenciales.
2. Con la autorización pendiente para transferir la conexión Neon a la variable
   secreta de Render, crear servicio gratuito desde la rama revisada. Comprobar
   dominio HTTPS, invitación, login, ambos portales y flujos antes de compartir.
3. El GPS físico lo probará Rardiel y está excluido del cierre solicitado.

### Blockers

- No hay URL pública verificada todavía. Está pendiente confirmar el traslado
  privado de `DATABASE_URL` entre Neon y Render y completar el deploy.
- La evaluación de subir la ampliación fue rechazada antes de red:
  `privacy_scrubbed_no_evaluation`. No reintentar cambiando el texto. La excepción
  recibida cubrió `ba2b077`, que ya está subido; esta ampliación aún no.
- El plan gratuito duerme por inactividad y mantiene cuotas; los datos de la
  demo son compartidos. No equivale a una instalación operativa para dinero real.
- La integración externa de CobranzaMapas no tiene origen ni sesión verificados.
- El túnel local anterior conserva rechazos automáticos; no se reintenta ni se
  cambia su lanzador. El despliegue alojado es la alternativa elegida por el usuario.
