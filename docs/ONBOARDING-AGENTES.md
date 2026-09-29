# Onboarding para colaboradores de CyP Modern

Este archivo es un índice breve. El estado operativo actual está en
[AGENTS.md](../AGENTS.md); compruébalo contra la rama y el entorno antes de
trabajar. El historial de sesiones no pertenece a este repositorio público.

## Orden de lectura

1. [README.md](../README.md): instalación, configuración local y recorrido.
2. [AGENTS.md](../AGENTS.md): decisiones activas, estado y siguiente paso.
3. [Arquitectura](ARCHITECTURE.md), [modelo de datos](DATA_MODEL.md) y
   [lógica de negocio](BUSINESS_LOGIC.md).
4. [Contratos generales](API_CONTRACTS.md) y
   [contrato de Envíos de Dinero](ENVIOS-API.md).
5. [Paridad legacy](legacy-parity.md) cuando una tarea dependa del sistema anterior.

## Mapa del código

- `app/server`: API Fastify, dominio, adaptadores, migraciones y pruebas.
- `app/client-admin`: portal de Central.
- `app/client-collector`: PWA del cobrador.
- `app/shared`: tipos y componentes compartidos.
- `scripts`: arranque local y preparación de revisión con datos ficticios.

El dinero se representa con centavos enteros y el día operativo usa
`America/Santo_Domingo`. La caja de envíos por operador y moneda es independiente
del libro original de cobros en DOP. Las reglas críticas se aplican en la API.

## Trabajo local

Usa Node.js 22.12 o posterior, Corepack y la versión de pnpm fijada en
`package.json`. El lockfile es único. Tras configurar tu `.env` local:

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm -r typecheck
pnpm --filter @cyp/server test
pnpm -r build
```

`pnpm --filter @cyp/server db:migrate` muestra el estado; `--apply` escribe en la
base configurada. Comprueba la identidad de esa base y usa respaldo antes de
aplicarlo. Las pruebas de PostgreSQL necesitan una base de pruebas dedicada.

## Colaboración y datos

- Sincroniza la rama antes de editar y revisa el diff antes de compartir cambios.
- Mantén `.env`, respaldos, extractos, datos de clientes y estado local fuera de Git.
- Las cuentas y datos de demostración son ficticios y no sustituyen la base local
  de cada integrante.
- Reporta qué verificaste realmente y qué queda pendiente, especialmente en GPS
  físico, PostgreSQL y acceso externo.