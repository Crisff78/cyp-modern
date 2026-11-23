# Revisión EGM del plan: `idSesion` corto

Dos revisores nuevos sobre la primera versión del plan, el 2026-11-23: `egm-codebase-details` y `egm-design`. Resolución de
Claude Code (Opus 5.5).

## Bloqueantes

- **`readSessionIdentity` no llegaba a la app:** `requestStore` copia una lista fija de métodos. Resuelto: el método es
  obligatorio en `Store` y está en `request-store.ts`; una prueba cuenta que se usa a través de `buildApp`.
- **«Todo pasa por `authenticate`» era falso:** Cerrar Sesión solo usa `assertAuthSession`. Corregido en el plan y en
  `docs/PROTOCOLO-TEXTO-PLANO.md`.

## Importantes

- **Normalizar la fila de PostgreSQL** (`collector_id` NULL, versión entera, `email IS NOT NULL` en el `ON`). Resuelto con
  `clean`, `String(...)` y arranque real con PostgreSQL para Cajero, Administración y Cobrador.
- **La revocación queda con una barrera.** Resuelto: `rotateCredentials` sube la versión y cierra las sesiones en un paso.
- **Cambiar `ADMIN_EMAIL` o `ADMIN_PASSWORD` cierra todas las sesiones del protocolo.** Aceptado y escrito en «Lo que
  cuesta» y en `docs/PROTOCOLO-TEXTO-PLANO.md`.
- **Pruebas que se rompían** (`text-protocol.test.ts:83` y `:86`). Reescritas; `Vence` sale ahora de la fila.
- **«Bloques al azar no abren» fallaría a veces** (6 bits fijos). Resuelto: se exige `SNE` en la petición.
- **Documentos incompletos.** Resuelto: contrato 0.5, `PROTOCOLO-TEXTO-PLANO.md`, `API_CONTRACTS.md` y comentarios.
- **Qué pasa si se filtra un valor.** Escrito en «Antes de producción»: se cierra con `/cyp_logout`, y queda por decidir
  Registrar Envío solo por POST y una duración menor.
- **El protocolo acepta tokens de la web en la dirección.** Ya era así y está documentado. No se cambia aquí: queda en
  «Antes de producción», como decisión de Rardiel.

## Menores

- Un fallo de la base sigue siendo `EIC`: la lectura va fuera del `catch`.
- Una sesión sin fila da `SNE` (con JWT daba `SNA`): escrito en «Lo que cuesta».
- `channel` es una constante, no un dato de la fila: corregido en el plan.
- Cuenta inicial borrada a mano: ninguna ruta lo hace. Escrito en «Lo que cuesta».

## Sin diferencia (comprobado por los revisores)

Nombre, cobrador y permisos salen igual que con el JWT; `credentialVersion` solo sube en un sitio; el cifrado de un bloque
con clave derivada por HKDF es válido para un UUID aleatorio.
