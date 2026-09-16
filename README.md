# Cobros y Pagos · CyP

Un backend REST, un portal administrativo y una PWA para cobradores. Scaffold funcional en TypeScript para cobros de servicios, pagos autorizados, seguimiento y cuadre diario. Interfaz en español, importes en pesos dominicanos, sin impuestos ni amortización de préstamos.

**Estado del descubrimiento:** respaldo localizado y verificado; restauración descartada por pivote explícito del usuario. Auditoría pública del demo completada, pantallas autenticadas pendientes de credenciales válidas. El esquema moderno es un diseño nuevo para PostgreSQL, no una extracción del respaldo. No se usa Docker ni SQL Server.

## Inicio rápido en Windows con PostgreSQL

Requisitos: Node.js 22.12+, npm y PostgreSQL local. En PowerShell:

```powershell
cd C:\CyP
npm ci
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# Copiar el valor generado a JWT_SECRET en .env y configurar DATABASE_URL.
npm run db:migrate
npm run dev
```

Si `.env` ya existe, conserva sus valores. La configuración local creada durante esta entrega usa PostgreSQL nativo en loopback y datos ficticios con `DEMO_MODE=true`. Nunca subir `.env`.

| Servicio       | URL                                    |
| -------------- | -------------------------------------- |
| Administración | http://127.0.0.1:5173                  |
| Cobrador PWA   | http://127.0.0.1:5174                  |
| API / health   | http://127.0.0.1:3001/api/health       |
| OpenAPI        | http://127.0.0.1:3001/api/openapi.json |

Demo: `admin@cyp.local` y `collector@cyp.local`, ambos con `Demo-CyP-2026!`. Son identidades ficticias habilitadas únicamente con `DEMO_MODE=true`. Con `DATABASE_URL`, los datos se guardan en PostgreSQL. No se importa ningún cliente del respaldo.

Para empezar una demo nueva, usa una base PostgreSQL dedicada vacía y vuelve a ejecutar `npm run db:migrate`. La API rechaza la operación si existe efectivo pendiente de una jornada anterior; no arrastra saldos silenciosamente.

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
npm run db:migrate
npm run dev
```

La migración está en `app/server/database/001_initial.sql`; crea `users`, `collectors`, `routes`, `zones`, `collection_points`, `clients`, `services`, `charges`, `payouts`, `collections`, `payments`, `cash_handovers` y `daily_settlements`, además de idempotencia, FKs, índices y triggers. `daily_settlements.difference` se genera con `(Cobrado - Depositado) + (Entregado - Pagado)` y el CHECK exige cero. Con demo activa y base vacía, el backend siembra datos ficticios. Con `DEMO_MODE=false`, no siembra datos y exige `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` de 14+ caracteres y `JWT_SECRET`. Se proporciona inicio de sesión de administrador configurado; el aprovisionamiento de usuarios/cobradores reales y una importación validada son trabajo pendiente antes de usar datos reales.

## Construcción y comprobación

```powershell
npm run typecheck
npm test
npm run build
# O ejecutar todo:
npm run check
```

Pruebas del backend: autenticación y aislamiento por ruta, importes inválidos, carreras de cobro, idempotencia, rollback de lotes, dos límites de efectivo, cuadre exacto, cierre, privacidad/revocación de recibos, ESC/POS, zona horaria y persistencia. Para incluir integración PostgreSQL se requiere una **base de pruebas dedicada** ya migrada; contiene datos ficticios que se conservarán:

```powershell
$env:TEST_DATABASE_URL='postgresql://user:password@127.0.0.1:5432/cyp_test'
npm test
```

`npm run build` genera `app/server/dist`, `app/client-admin/dist` y `app/client-collector/dist`. La API compilada se inicia con `npm start -w @cyp/server`. Servir ambos frontends con un servidor HTTPS estático y proxy `/api` hacia la API; cada portal necesita fallback de navegación a `index.html`. Ajustar `ALLOWED_ORIGINS` y `COLLECTOR_URL` a los dominios reales. El servidor Vite de desarrollo no es el servidor de producción.

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

Leer `docs/ADR-001-postgresql-primary.md`, `docs/DATA_MODEL.md`, `docs/BUSINESS_LOGIC.md`, `docs/API_CONTRACTS.md`, `docs/DESIGN_SYSTEM.md` y `docs/VERIFICATION.md`. Los límites conocidos incluyen falta de importación legada, gestión completa de usuarios, recuperación de jornadas previas, devoluciones/anulaciones contables y paginación servidor para grandes volúmenes. La aplicación es una base funcional para validación, no una migración de producción ya aprobada.

## Respaldo legado

`legacy/database` documenta la procedencia del respaldo y la decisión de no restaurarlo. La pantalla de acceso público uniGUI muestra Usuario, Clave y Estación; se necesita un usuario válido para auditar Cargos/Descargos/Cuadre autenticados. El desarrollo moderno continúa sobre PostgreSQL con reglas de negocio documentadas, sin bloquearse por la pantalla de login.

## GitHub

Repositorio privado por defecto debido al contexto operacional. `.gitignore` excluye respaldos, archivos comprimidos, secretos, estado local, dependencias y compilaciones. El lockfile se versiona. Si se configura otro destino:

```powershell
git remote add origin https://github.com/YOUR_ACCOUNT/cobros-y-pagos.git
git push -u origin main
```

Fuentes de implementación: [Fastify](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), [PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html), [Service workers (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers). Los hallazgos sobre el sistema anterior se sustentan en la evidencia guardada, no en estas referencias.
