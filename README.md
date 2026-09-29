# Cobros y Pagos · CyP

Un backend REST, un portal administrativo y una PWA para cobradores. Incluye cobros de servicios, pagos autorizados, envíos y recibos de dinero, seguimiento y cuadre diario. Interfaz en español; los cobros originales usan pesos dominicanos y los envíos admiten DOP, USD y EUR.

El repositorio contiene código, migraciones de PostgreSQL y ejemplos ficticios. La base local de trabajo y los datos de clientes no forman parte de GitHub. El esquema moderno no es una extracción directa del respaldo legado.

## Inicio rápido en Windows con PostgreSQL

Requisitos: Node.js 22.12+, Corepack y PostgreSQL local. En PowerShell:

```powershell
cd C:\CyP
corepack enable
pnpm install --frozen-lockfile
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# Copiar el valor generado a JWT_SECRET en .env y configurar DATABASE_URL.
pnpm --filter @cyp/server db:migrate --apply
pnpm -r --parallel dev
```

Si `.env` ya existe, conserva sus valores. Completa localmente `JWT_SECRET` y `DATABASE_URL` antes de ejecutar la migración. `DEMO_MODE=true` con `DATABASE_URL` abre esa base y habilita cuentas de demostración: usa únicamente una base dedicada con datos ficticios. Sin `DATABASE_URL`, la demo usa un archivo local. Nunca subir `.env`.

| Servicio       | URL                                    |
| -------------- | -------------------------------------- |
| Administración | http://127.0.0.1:5173                  |
| Cobrador PWA   | http://127.0.0.1:5174                  |
| API / health   | http://127.0.0.1:3001/api/health       |
| OpenAPI        | http://127.0.0.1:3001/api/openapi.json |

Demo: `admin@cyp.local` y `collector@cyp.local`, ambos con `Demo-CyP-2026!`. Son identidades ficticias habilitadas únicamente con `DEMO_MODE=true`. Con `DATABASE_URL`, estas cuentas acceden a esa base; no uses el modo demo con datos reales. No se importa ningún cliente del respaldo.

Para empezar una demo nueva, usa una base PostgreSQL dedicada vacía y ejecuta `pnpm --filter @cyp/server db:migrate --apply`. La API rechaza la operación si existe efectivo pendiente de una jornada anterior; no arrastra saldos silenciosamente.

## Recorrido de demostración

1. Entrar como administración y revisar tablero, clientes, mapa, filtros y búsqueda con Ctrl/Cmd+K.
2. Entrar como Ana en el portal cobrador. Abrir Colmado La Esquina y cobrar RD$ 4,500.00; revisar recibo, copia de enlace e impresión.
3. En Pagos, entregar la remesa autorizada de RD$ 2,000.00 a María. La demo incluye ese anticipo inicial de oficina.
4. En Cuadre administrativo, confirmar depósito de RD$ 4,500.00 para Ana. La fórmula resulta `(4,500 - 4,500) + (2,000 - 2,000) = 0`.
5. Cerrar la jornada. Intentar un nuevo cobro de Ana devuelve `DAY_CLOSED`. Los demás cobradores mantienen sus jornadas independientes.

Un recibo es operacional, no fiscal. Descargar ESC/POS produce bytes para un puente/controlador local compatible; no instala ni conecta una impresora. La impresión web abre el diálogo del navegador. El tamaño, corte y caracteres deben verificarse con la impresora física.

## PostgreSQL nativo

El adaptador PostgreSQL está implementado y fue probado contra un clúster nativo aislado. No toca el servicio PostgreSQL existente ni exige Docker.

Crear una base `cyp` y un usuario propietario dedicado con las herramientas de la instalación PostgreSQL elegida. Configurar en `.env`:

```dotenv
DATABASE_URL=postgresql://cyp:your-local-password@127.0.0.1:5432/cyp
DEMO_MODE=true
```

```powershell
pnpm --filter @cyp/server db:migrate --apply
pnpm -r --parallel dev
```

La migración está en `app/server/database/` (`001_initial.sql` más los scripts posteriores en orden); crea `users`, `collectors`, `routes`, `zones`, `collection_points`, `clients`, `services`, `charges`, `payouts`, `collections`, `payments`, `cash_handovers` y `daily_settlements`, además de idempotencia, FKs, índices y triggers. `daily_settlements.difference` se genera con `(Cobrado - Depositado) + (Entregado - Pagado)` y el CHECK exige cero. Con demo activa y base vacía dedicada, el backend siembra datos ficticios. Con `DEMO_MODE=false`, no siembra datos y exige `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` de 14+ caracteres y `JWT_SECRET`. Se proporciona inicio de sesión de administrador configurado; el aprovisionamiento de usuarios/cobradores reales se describe abajo y una importación validada es trabajo pendiente antes de usar datos reales.

## Aprovisionamiento de usuarios

Las identidades `admin@cyp.local` y `collector@cyp.local` son ficticias y solo
existen con `DEMO_MODE=true`. Para que el jefe y los cobradores entren con su
propia cuenta, desde el portal administrativo: **Archivos → Usuarios → Nueva
cuenta**. Una cuenta de cobrador se vincula a un cobrador existente (y por tanto
a su ruta y sus clientes); una de administración no lleva cobrador asignado. La
contraseña inicial exige 12 caracteres mínimo, se entrega personalmente y el
cobrador puede cambiarla; cualquier cambio de contraseña o de estado cierra las
sesiones abiertas de esa cuenta.

API equivalente (con `Idempotency-Key` en las mutaciones): `GET /api/usuarios`,
`POST /api/usuarios`, `POST /api/usuarios/:id/clave` y
`POST /api/usuarios/:id/estado`. Las contraseñas se guardan con scrypt y una sal
propia por cuenta; la API nunca devuelve el hash ni la sal.

## Construcción y comprobación

```powershell
pnpm -r typecheck
pnpm --filter @cyp/server test
pnpm -r build
# O ejecutar todo:
pnpm check
```

Pruebas del backend: autenticación y aislamiento por ruta, importes inválidos, carreras de cobro, idempotencia, rollback de lotes, dos límites de efectivo, cuadre exacto, cierre, privacidad/revocación de recibos, ESC/POS, zona horaria y persistencia. Para incluir integración PostgreSQL se requiere una **base de pruebas dedicada** ya migrada; contiene datos ficticios que se conservarán:

```powershell
$env:TEST_DATABASE_URL='postgresql://user:password@127.0.0.1:5432/cyp_test'
pnpm --filter @cyp/server test
```

`pnpm -r build` genera `app/server/dist`, `app/client-admin/dist` y `app/client-collector/dist`. La API compilada se inicia con `pnpm --filter @cyp/server start`. Servir ambos frontends con un servidor HTTPS estático y proxy `/api` hacia la API; cada portal necesita fallback de navegación a `index.html`. Ajustar `ALLOWED_ORIGINS` y `COLLECTOR_URL` a los dominios reales. El servidor Vite de desarrollo no es el servidor de producción.

## PWA, GPS y uso en teléfono

La PWA incluye manifiesto, iconos y service worker para recursos estáticos. No confirma cobros sin conexión ni guarda respuestas financieras en caché. Verificar el service worker con la compilación de producción. HTTPS es necesario fuera de localhost para instalación PWA, geolocalización y algunas APIs de compartir/portapapeles. GPS se solicita con una acción explícita del cobrador; el mapa muestra la última posición recibida y su antigüedad. El mapa usa Leaflet con mosaicos externos de OpenStreetMap y atribución; evaluar proveedor y política de uso antes de escalar.

## Estructura

```text
app/
  server/              Fastify, Zod, dominio, adaptadores y pruebas
  client-admin/        React + Vite, administración y mapa
  client-collector/    React + Vite, PWA y recibos
docs/                  Modelo, reglas, API, diseño y verificación
legacy/
  database/            Procedencia del respaldo, estado de extracción y deuda
  web/                 Evidencia pública redactada y crawler reproducible
  ui_audit.md          Hallazgos observados y límites del acceso
```

Leer `docs/ADR-001-postgresql-primary.md`, `docs/DATA_MODEL.md`, `docs/BUSINESS_LOGIC.md`, `docs/API_CONTRACTS.md`, `docs/DESIGN_SYSTEM.md` y `docs/VERIFICATION.md`. Los límites conocidos incluyen falta de importación legada, recuperación de contraseñas por correo (el restablecimiento lo hace un administrador), recuperación de jornadas previas, devoluciones/anulaciones contables y paginación servidor para grandes volúmenes. La aplicación es una base funcional para validación, no una migración de producción ya aprobada.

## Respaldo legado

`legacy/database` documenta la procedencia del respaldo y la decisión de no restaurarlo. La pantalla de acceso público uniGUI muestra Usuario, Clave y Estación; se necesita un usuario válido para auditar Cargos/Descargos/Cuadre autenticados. El desarrollo moderno continúa sobre PostgreSQL con reglas de negocio documentadas, sin bloquearse por la pantalla de login.

## GitHub

El repositorio es público. `.gitignore` excluye respaldos, archivos comprimidos, secretos, estado local, dependencias y compilaciones. El lockfile se versiona. Cada integrante configura su `.env` local y aplica las migraciones en una base propia; nunca debe publicar respaldos ni datos reales de clientes.

Fuentes de implementación: [Fastify](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), [PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html), [Service workers (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers). Los hallazgos sobre el sistema anterior se sustentan en la evidencia guardada, no en estas referencias.
