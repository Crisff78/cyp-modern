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

**Last updated:** 2026-10-05 por Codex (hora dominicana).

### Done so far

- PR3/4 fusionados; antes de este cambio main y demo comprobados en 6df34267.
  Render y Neon ya están desplegados; el servicio existente escucha
  codex/public-browser-demo. No recrear recursos ni repetir merges anteriores.
- Auditoría de 28 sugerencias: 24 conservan la implementación al alcance
  acordado; este cambio completa 2.3, 3.1, 4.1 y 6.4. Ver
  docs/SUGERENCIAS-CIERRE.md para comportamiento, pruebas y límites.
- Se conserva Z/L/R, límites DOP persistidos, multimoneda separada,
  comisiones manuales, diseños y recibos 58/80 mm. Sin migraciones nuevas.
- Pruebas de escritura únicamente sobre ejemplos aislados. Ninguna operación
  de prueba en registros compartidos o reales. Sin VPS ni variables privadas.

### Next step

1. Antes de otro cambio, consultar en GitHub los recibos de CI y deployment
   del commit actual. La publicación usa PR hacia main y demo por fast-forward;
   los recibos remotos son la fuente del estado de publicación.
2. Registrar el resultado final en el handoff local y Superbrain. Mantener
   Codex Superbrain Vault Sync Disabled; sin sync remoto ni Agent Mail.
3. Si llega otro fallo, reproducirlo en un entorno aislado antes de cambiarlo.

### Blockers / límites

- Los identificadores de CI/deployment viven en GitHub y en el handoff local;
  no deducir su estado a partir de una nota histórica.
- No se afirma cobertura del 100 %. Las pruebas PostgreSQL omitidas no cuentan
  como ejecutadas; no usar la base pública para habilitarlas.
- TestSprite e impresión física excluidos. GPS físico ya confirmado por Rardiel.
  Punto 2.2: rraa eliminado; ID interno readonly conservado.
- Plan gratuito sujeto a suspensión por inactividad y cuotas; demo compartida.
  La instalación definitiva local mantiene su estado independiente.
