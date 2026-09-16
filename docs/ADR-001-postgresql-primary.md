# ADR-001: PostgreSQL nativo como base primaria

**Status:** Accepted
**Date:** 2026-09-16
**Deciders:** Usuario, Codex

## Context

El proyecto comenzó con un respaldo `CobrosyPagos-GDemos-2.bak`, pero la instrucción vigente descarta restaurarlo localmente y prohíbe Docker y SQL Server. La máquina sí dispone de PostgreSQL local. El objetivo actual es construir un scaffold moderno y verificable, no reproducir la base antigua.

## Decision

La aplicación usa PostgreSQL nativo como persistencia primaria. La migración inicial crea tablas normalizadas para usuarios, cobradores, rutas, zonas, puntos de cobro, clientes, servicios, cargos, descargos, cobros, pagos, entregas de efectivo y cuadres diarios.

El cierre diario se impone en la base con `daily_settlements.difference` generado como `(collected - deposited) + (office_delivered - paid_to_clients)` y un `CHECK` que exige cero. Los límites de riesgo se validan en el dominio transaccional antes de insertar movimientos.

## Options Considered

### PostgreSQL nativo

| Dimension        | Assessment                                                         |
| ---------------- | ------------------------------------------------------------------ |
| Complexity       | Medium                                                             |
| Cost             | Low                                                                |
| Scalability      | Good for the scaffold; repository layer will need pagination later |
| Team familiarity | High enough for Node.js and standard SQL                           |

**Pros:** matches the local environment, avoids Docker, supports strong constraints and triggers, and keeps the new model clean.

**Cons:** not a direct restore path from `.bak`; migration from legacy data remains a separate future project.

### SQL Server restore

| Dimension        | Assessment                            |
| ---------------- | ------------------------------------- |
| Complexity       | High in this environment              |
| Cost             | Higher local setup and tooling burden |
| Scalability      | Unknown without extracted schema      |
| Team familiarity | Blocked by current instruction        |

**Pros:** could reveal exact legacy metadata if later authorized elsewhere.

**Cons:** explicitly out of scope now, unavailable locally, and would slow the modern scaffold.

### Dockerized SQL Server

| Dimension        | Assessment                     |
| ---------------- | ------------------------------ |
| Complexity       | Medium                         |
| Cost             | Operationally unnecessary      |
| Scalability      | Irrelevant to current scaffold |
| Team familiarity | Blocked by current instruction |

**Pros:** none under the current constraints.

**Cons:** explicitly prohibited.

## Consequences

- The executable schema in `app/server/database/001_initial.sql` is PostgreSQL-specific.
- The backup is retained only as provenance evidence and is ignored by Git.
- The live demo audit informs flows and language, but the scaffold does not depend on authenticated legacy screens.
- A future real migration must map and reconcile legacy records deliberately instead of importing by table-name similarity.
