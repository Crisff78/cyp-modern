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

**Last updated:** 2026-09-28 por Codex.

### Done so far

- En la rama local `codex/integrate-envios` se integraron las migraciones 012/013,
  la API, las pantallas de envíos/recibos/caja/reportes y la semilla ficticia de
  revisión con los cambios recientes de `origin/main`.
- La integración conserva el mapa conectado y los ajustes visuales recientes de
  Cargos Recurrentes. El contrato externo de CobranzaMapas sigue pendiente.
- Verificación del código integrado: TypeScript correcto en los tres paquetes;
  34 pruebas de servidor aprobadas y dos de PostgreSQL omitidas en este worktree
  sin base de pruebas; tres builds aprobados. Vite advierte por tamaño de bundle.
- La instalación local definitiva respondió HTTP 200 en API 3001 y portales
  5173/5174 en la última revisión. Esta observación no acredita el enlace público.

### Next step

1. Revisar el diff público, ejecutar CI y compartir la rama mediante el flujo de
   revisión del repositorio. No añadir estado local, respaldos ni datos reales.
2. Resolver por el canal de aprobación del entorno el arranque de la API aislada
   de revisión; después comprobar la invitación y crear el túnel de Cloudflare.
3. Hacer la prueba de GPS con un dispositivo físico por HTTPS y comprobar la
   ubicación recibida en el mapa.

### Blockers

- La revisión automática volvió a rechazar el arranque de la API aislada en
  3012 después de `/approve`; el gateway de revisión no está sano y no hay túnel.
- La integración externa de CobranzaMapas no tiene origen ni sesión verificados.
- Las dos pruebas de PostgreSQL omitidas y el GPS físico requieren comprobación
  en sus entornos correspondientes.
