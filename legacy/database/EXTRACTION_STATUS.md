# Estado de extracción — CobrosyPagos-GDemos-2.bak

**Fecha:** 2026-09-17  ·  **Agente:** Codex (Atria-Dawn-Preview)  ·  **Solo lectura**

## Resumen

- **Origen:** `C:\Users\Rardiel Ceballo\Downloads\CobrosyPagos\CobrosyPagos-GDemos-2.bak`
  (7,831,040 bytes, SHA-256
  `3406194142696769A0773E17FC9BB857E92D3B128054F29E7F44FCE785CAECB7`)
- **Metadatos:** 44 tablas con inventario de columnas + 136 procedimientos/vistas
  (`table_summary.json`).
- **Datos de clientes:** extraídos en este turno. 24 registros únicos →
  `clients_extract.json` / `clients_extract.csv`.

## Veredicto: base de DEMO, no producción

Evidencia (verificada, no inferida):

1. El nombre del archivo es `CobrosyPagos-GDemos-2.bak` — "GDemos".
2. El índice corto de códigos C00001–C00039 contiene entradas literalmente de
   prueba: `C00029 Cliente prueba 2019`, `C00033 NOEL PRUEBA`, `C00027 Cliente
   NUevo`, `C00021 dfaef`, `C00022 gr`, `C00020 Jessica Simpson`.
3. Entre los 24 registros únicos hay `Otro Cliente`, `Cliente 32684`,
   `Cliente NUevo`, `dfaef` y un registro plantilla con campos literales
   (`123 / Cliente / Alias / Dir / T / C / Ubic / Nota / E`).
4. `COLMADO MARIA` tiene campos de relleno (`asas`, `as`, `aa`).

Una parte de los registros sí tiene pinta de cliente real (pedidos con cédula
dominicana, dirección y email, p. ej. `Pedro Almonte Vicini` / C00008), pero
están mezclados con datos de prueba en la misma base.

**Recomendación:** NO importar esto a producción como verdad. Sirve como
referencia de esquema y como dataset de demo/validación, que es justo el estado
en el que está CyP (`DEMO_MODE=true`).

## Formato de registro decodificado (verificado)

El `.bak` guarda páginas SQL Server. Cada registro de `Clientes` es:

- **Layout A (`fixed_len=116`, 9 columnas variables):** registro completo.
  Inmediatamente antes del run ASCII hay un array de 9 offsets **u16
  little-endian**. Cada offset es la posición absoluta de FIN de la columna,
  medida desde el inicio del registro. Los deltas entre offsets consecutivos
  dan la longitud exacta de cada campo.
- **Layout B (`fixed_len=102`, 2 columnas variables):** registros parciales
  (solo id + nombre). Mismo principio de offsets.

Campos (Layout A), en orden: `id, nombre, alias, sector, telefono, celular,
direccion, nota, email`.

El `.bak` además tiene la región de datos duplicada (offsets 2435002–2437664 y
2438405–2441427), por lo que la deduplicación por tupla de campos es obligatoria.

## Próximo paso

La importación validada NO se ejecutó ni se aprobó. Antes de cualquier import:
1. Confirmar contigo la estrategia de asignación de `route_id` /
   `collection_point_id` (ambos son NOT NULL en el esquema nuevo y el legado
   no tiene equivalente directo).
2. Dry run con conteos y totales.
3. Tabla de mapeo legacy aparte con los IDs de procedencia.
