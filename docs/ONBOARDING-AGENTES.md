# ONBOARDING PARA AGENTES — CyP Modern (Cobros y Pagos)

> Documento de traspaso para cualquier modelo/agente nuevo que tome este proyecto.
> Léelo COMPLETO antes de tocar nada. Actualizado: 2026-09-20.

---

## 1. Qué es este proyecto

**CyP Modern** es el reemplazo moderno del sistema legacy de **Cobros y Pagos**
de Gamera Software (República Dominicana, pesos dominicanos). Es una suite de
cobranza en calle: cobradores recolectan pagos de clientes (servicios,
préstamos), depositan en banco, y la oficina cuadra cada día.

**Tres aplicaciones:**
- `app/server` — API Fastify + PostgreSQL (puerto 3001)
- `app/client-admin` — portal administrativo React/Vite (puerto 5173)
- `app/client-collector` — PWA del cobrador (puerto 5174)

**Regla de oro:** importes en **centavos enteros** (BIGINT), nunca punto
flotante. `business_date` en zona `America/Santo_Domingo`; timestamps UTC.

**Dueño:** Rardiel (decide todo). **Compañero:** Crisff78 (diseño/frontend,
pushea a `origin/main`). El demo del sistema original que sirve de referencia
es `http://gdemos.ddns.net/cypdemo/cyp10_front.dll?CID=cypdemo` (a veces está
caído; su BD falla sin aviso).

## 2. Dónde está TODO (mapa de conocimiento)

| Qué | Dónde |
|---|---|
| **Estado operativo del proyecto** | `AGENTS.md` en la raíz del repo (LEER AL INICIAR, ACTUALIZAR AL CERRAR) |
| **Matriz de paridad con el original** | `docs/legacy-parity.md` — cada función del original: implementada/excepción |
| **Nota durable del proyecto en Superbrain** | `C:\Users\Rardiel Ceballo\Documents\VPS-obsidian\VPS\06-Knowledge-Base\Superbrain\Projects\Project - cyp-modern.md` |
| **Bitácoras diarias (append-only)** | `...\Superbrain\Activity\2026-09-17.md`, `2026-09-18.md`, `2026-09-19.md` (CyP: sync, paridad G1-G10, E2E) |
| **Política de retención de conocimiento** | `...\Superbrain\System\Knowledge Retention Policy.md` |
| **Modelo de datos y decisiones** | `docs/DATA_MODEL.md`, `docs/ADR-001-postgresql-primary.md` |
| **Inventario del legacy (.bak)** | `legacy/database/table_summary.json` (44 tablas, 136 procs), `legacy/database/EXTRACTION_STATUS.md`, `legacy/web/*.redacted.html` |
| **Credenciales y configuración** | `.env` en la raíz del repo (NO imprimir, NO commitear) |
| **Extracción de clientes legacy** | `legacy/database/clients_extract.json` (datos de clientes: FUERA de git) |
| **Pruebas E2E** | `e2e-pruebas.mjs` en la raíz (39 checks contra el servidor real) |
| **Repo remoto** | `github.com/Crisff78/cyp-modern`, rama `main` |

## 3. Estado actual (todo lo hecho hasta hoy)

**Base construida y verificada:**
- PostgreSQL 17 real (sin Docker, sin SQL Server): rol/DB `cyp`, migraciones
  `001`–`008` aplicadas. 17 tablas + vistas de compatibilidad en español.
- Modo real activo (`DEMO_MODE=false` en `.env`): PostgreSQL configurado,
  credenciales de admin reales en el `.env`.
- 14 clientes legacy importados (dataset demo de GDemos, no producción),
  limpiados de duplicados/huérfanos. Los datos PRUEBA **se quedan** como
  dataset demo (decisión de Rardiel 2026-09-20).

**Paridad con el original — CERRADA (G1–G10 + menores):**
- **G1** Aceptar/Cancelar depósitos con desglose de denominaciones.
- **G2** Importación masiva de Cargos y Descargos por CSV
  (`POST /api/cargos/importar`, `/api/descargos/importar`).
- **G3** Descargos Recurrentes completos (tabla `recurring_payouts`,
  CRUD API, pantalla admin).
- **G4** Estado de cuenta del cliente (`GET /api/clientes/:id/estado`
  + botón "Cobros y Pagos del Cliente").
- **G5** Ventanas auxiliares: Facturas, Qué hay de nuevo, Ventana de Pagos,
  Notificaciones.
- **G6** Configuración General persistente (tabla `system_config`,
  `GET/POST /api/configuracion`).
- **G7** Reportes de Pagos del legacy + Servicios por zona (7 definiciones).
- **G9** Campos de contacto del cliente (alias, sector, celular, email, nota).
- **G10** Orden por columna + selector de columnas + Imprimir + Hacer copia
  de respaldo (descarga snapshot JSON).
- **Menores:** desglose de denominaciones, formulario de plantilla recurrente.

**Verificación:** batería E2E `e2e-pruebas.mjs` (39 checks) en verde contra
PostgreSQL real; `npm run check` completo (typecheck 3 workspaces + 20 tests
+ builds) en verde. Datos PRUEBA visibles en el admin.

**Del compañero (fusionado):** modales legacy Cargos/Cobradores, flujos Z/L/R,
mock.ts + mapAdapter.ts, telemetría legacy en topbar (versión + reloj del
servidor), refinamiento del topbar y versionado real.

## 4. Decisiones CERRADAS (no reabrir sin Rardiel)

1. **PostgreSQL nativo** como única base. Prohibido Docker y SQL Server.
2. **Moneda única DOP.** El legacy era multimoneda; fuera de alcance.
3. **G8 Contabilidad** (EntidadesContables/MovimientosContables): FUERA DE
   ALCANCE por decisión de Rardiel (2026-09-19). El cuadre diario cubre el
   control operativo.
4. **Inmutabilidad del ledger:** `collections`, `payments` y
   `cash_handovers` tienen triggers que rechazan UPDATE/DELETE. El ciclo de
   vida de depósitos vive en `deposit_lifecycle` (eventos append-only,
   migración 008). NUNCA intentes actualizar una fila de movimiento.
5. **Los clientes del .bak son dataset demo,** no verdad de producción.
   Credenciales siempre hasheadas (scrypt), jamás texto plano.
6. **Los datos PRUEBA se quedan** como dataset demo.
7. El proyecto es SEPARADO de Hermes-BI (otro AGENTS.md, otro Superbrain).
   No mezclar decisiones.

## 5. Pendientes reales (lo único abierto)

- **Suministro de usuarios reales:** crear cuentas del jefe y cobradores
  desde la pantalla Usuarios (admin real: credenciales del `.env`).
- **Clientes legacy ambiguos:** mendez, PORFIRIO x2, NOEL USA, MAYITO YO,
  PRESTAMO DE LA 149 — decidir si son prueba o reales (no borrar sin Rardiel).
- **Redistribuir clientes** de la ruta semilla `legacy-import-*` a rutas/zonas
  reales.
- **Límites reales de cobradores** (collection_limit/payout_limit hoy en
  1,000,000.00 genérico).
- **Nombre partido en apellidos:** el original separa Cliente + 1er/2do
  apellido; el moderno usa nombre completo único (decisión de modelado
  documentada — cambiar solo si Rardiel lo pide).
- **Reportes con resultados reales:** los 16 reportes del admin son vista
  preliminar; falta cablear datos (ojo: el original tampoco los tenía todos).

## 6. Cómo trabajar (convenciones duras)

- **pnpm obligatorio** para instalar (existe `pnpm-workspace.yaml`). El shim
  de pnpm falla en shells no interactivas: usar `npm run <script>` (funciona)
  o node directo (`node node_modules/tsx/dist/cli.mjs` desde `app/server`).
- **Verificación antes de push:** `npm run check` (typecheck 3 workspaces +
  20 tests + builds). Debe estar en verde SIEMPRE.
- **Actualizar `AGENTS.md`** al cerrar (sección Current state) y registrar en
  Superbrain Activity del día (append-only, sin borrar).
- **Idempotency-Key** obligatoria en todo POST de mutación (header, 8-100 chars).
- **Montos:** enteros positivos en centavos. **Fechas de negocio:** zona
  `America/Santo_Domingo`.
- **Arranque de servicios:** `npm run dev` desde la raíz (API 3001, admin
  5173, cobrador 5174). OJO: si PostgreSQL no conecta al arrancar, la API
  cae en **fallback demo silencioso** (MemoryStore) — el log lo dice:
  "PostgreSQL no disponible...". Si el login real da 401 con credenciales
  correctas, revisa eso primero.
- **Migraciones:** `npm run db:migrate` (lee `app/server/database/*.sql` en
  orden, idempotentes).
- El admin en **modo mock** (`/mock/admin/...`) es la etapa actual del
  frontend: las vistas operativas persisten en mock, no en la API real.
  No "arreglar" eso sin coordinar con el compañero.

## 7. Plantilla de agentes para Hermes/AutoClaw (roster máximo)

Workspace para todos: `C:\Users\Rardiel Ceballo\Documents\Codex\2026-09-17\cyp-modern`
Modelo: dejar el principal por defecto salvo nota. Estrategia sugerida:
"prudente" para los que tocan código, "iteración rápida" para investigación
y documentación.

| # | Nombre | Áreas | Descripción (pegar en el formulario) |
|---|---|---|---|
| 1 | **Arquitecto API** | Programación | Dueño de `app/server`: rutas Fastify, dominio, validaciones, migraciones. Regla: centavos enteros, Idempotency-Key, sin romper el ledger. |
| 2 | **Artesano Admin** | Programación, Diseño | Dueño de `app/client-admin`: vistas MDI legacy, modales, toolbars. OJO: App.tsx es enorme y con trabajo de 3 fuentes — leer antes de editar. |
| 3 | **PWA Cobrador** | Programación | Dueño de `app/client-collector`: la app del cobrador en la calle (recibos, GPS, offline). |
| 4 | **Guardián del Ledger** | Programación, Análisis de datos | Dueño de migraciones y SQL: inmutabilidad de movimientos, `deposit_lifecycle`, saldos proyectados. Nunca UPDATE sobre movimientos. |
| 5 | **Cazador de Paridad** | Investigación, Programación | Compara el admin contra el original (gdemos.ddns.net/cypdemo) usando `docs/legacy-parity.md` como lista maestra. |
| 6 | **Verificador Supremo** | Programación, Operaciones | Ejecuta `npm run check` y `e2e-pruebas.mjs`; reporta fallos SIN corregirlos si no tiene autorización. |
| 7 | **Ojo Crítico** | Programación | Revisor de código de los demás: regresiones, seguridad, estilo del repo. Solo lectura + reporte. |
| 8 | **Tesorero de Pruebas** | Análisis de datos, Programación | Dataset demo: datos PRUEBA, escenarios de cuadre, límites de cobradores, casos borde. |
| 9 | **Escriba del Superbrain** | Escritura, Oficina | Documenta en AGENTS.md y Superbrain Activity (append-only) cada turno. Nunca borra historia. |
| 10 | **Centinela de Servicios** | Operaciones | API 3001 / admin 5173 / cobrador 5174: salud, arranque, detección del fallback demo (log "[api] PostgreSQL no disponible"). |
| 11 | **Integrador Git** | Operaciones, Programación | Sync con Crisff78: fetch/merge/push, resolver conflictos preservando G1-G10 y su diseño. |
| 12 | **Estilista Legacy** | Diseño | Fidelidad visual con el original: proporciones, modales, topbar con telemetría. Trabaja en styles.css y JSX de presentación. |
| 13 | **Inquisidor de Seguridad** | Investigación, Programación | Auth JWT, scrypt, límites, Idempotency-Key, exposición de datos en el admin. Solo auditoría + reporte. |
| 14 | **Reportero Mayor** | Programación, Análisis de datos | Cablear resultados reales de los 16 reportes (Cargos/Cobros/Pagos/Servicios por zona y ruta) — hoy son vista preliminar. |
| 15 | **Cartógrafo de Datos** | Análisis de datos, Oficina | Clientes legacy ambiguos, redistribución a rutas/zonas reales, límites reales de cobradores. |
| 16 | **Oráculo del Jefe** | Producto, Oficina | Interfaz con Rardiel: decisiones pendientes, prioridades, validación de lo entregado. No toca código. |

**Reglas de convivencia entre agentes:**
- Un archivo a la vez por agente; App.tsx se edita con parches quirúrgicos.
- Ante un fallo: REPORTAR primero; corregir solo con autorización de Rardiel.
- Todo cambio termina en: `npm run check` verde → commit → push → registro.
- Si el demo original está caído, no bloquea: la lista maestra ya está en
  `docs/legacy-parity.md`.

## 8. Comandos de referencia rápida

```bash
npm run dev            # los 3 servicios (API 3001, admin 5173, cobrador 5174)
npm run check          # typecheck + tests + builds (obligatorio antes de push)
npm run db:migrate     # aplica app/server/database/*.sql en orden (idempotentes)
npm test               # solo tests del servidor
```

Login admin demo/real según `.env`: `ADMIN_EMAIL` + `ADMIN_PASSWORD`
(en modo real, la demo `Demo-CyP-2026!` NO funciona).
