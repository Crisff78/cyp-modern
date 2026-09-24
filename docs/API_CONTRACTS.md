# Contratos REST

Base local `http://127.0.0.1:3001/api`. Especificación OpenAPI 3.1 generada desde los esquemas Zod en **GET `/api/openapi.json`**; copia versionada en `docs/openapi.json`. Swagger Editor/Swagger UI puede cargarla. Dinero = centavos enteros DOP. JSON UTF-8. CORS limitado por `ALLOWED_ORIGINS`.

## Autenticación y errores

`POST /auth/login {email,password}` → `{token,user:{id,name,role,collectorId?}}`. JWT firmado, 8 horas. `GET /auth/me` devuelve el usuario. Enviar `Authorization: Bearer <token>` salvo health, login, OpenAPI y consulta de recibos por token. Demo explícito: `admin@cyp.local` / `collector@cyp.local`, contraseña `Demo-CyP-2026!`. Fuera de demo se requiere PostgreSQL y administrador configurado por entorno; la gestión completa de identidades, revocación de sesiones y aprovisionamiento de cobradores son extensiones pendientes.

Los tokens están ligados criptográficamente al modo y configuración de credenciales; desactivar demo o cambiar credenciales invalida las sesiones anteriores. Solo se aceptan las identidades configuradas para el modo activo.

Errores: `{error:{code,message}}`. HTTP 400 validación, 401 sin sesión, 403 rol/ruta, 404 inexistente, 409 conflicto/cuadre/límite, 422 saldo o regla inválida, 429 tasa, 500 error interno. No hay stack traces en respuestas. Login limitado a 10 intentos/minuto/IP; API 120/minuto/IP.

Todos los POST financieros requieren cabecera `Idempotency-Key` (8–100 caracteres, recomendado UUID). Repetir exactamente la clave y payload ante resultado de red incierto. POST tracking y revocación de recibo son idempotentes por su estado y no requieren clave.

## Endpoints implementados

| Método/ruta                                    | Entrada                                               | Resultado / permiso                                                                                       |
| ---------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| GET `/health`                                  | —                                                     | estado, fecha y modo                                                                                      |
| GET `/snapshot`                                | —                                                     | clientes, rutas, cobradores, cargos, descargos, movimientos, cierres, totales, historia; filtrado por rol |
| GET `/clientes`, `/rutas`                      | —                                                     | listas autorizadas                                                                                        |
| GET `/cargos`, `/descargos`                    | —                                                     | autorizaciones visibles                                                                                   |
| POST `/cargos`                                 | clientId, service, concept, currency, note, amount, dueDate, required | cargo pendiente / admin                                                                    |
| POST `/cargos/{id}`                            | mismos campos que crear                              | modifica cargo sin cobros asociados / admin                                                               |
| POST `/cargos/recurrentes`                     | clientIds[1..100], service, amount, dueDate, required | `{charges,count}` atómico / admin                                                                         |
| POST `/descargos`                              | clientId, collectorId, concept, amount                | autorización pendiente / admin                                                                            |
| GET `/cobros`, `/pagos`                        | —                                                     | movimientos visibles por tipo                                                                             |
| POST `/cobros`                                 | chargeId, amount                                      | `{movement,receipt:{token,url}}` / admin o cobrador asignado                                              |
| POST `/pagos`                                  | payoutId, amount                                      | `{movement,receipt:{token,url}}` / admin o cobrador asignado                                              |
| POST `/depositos`                              | collectorId, amount                                   | `{movement}` / admin                                                                                      |
| POST `/entregas`                               | collectorId, amount                                   | `{movement}` / admin                                                                                      |
| POST `/cargos/cancelar`, `/descargos/cancelar` | id, reason?                                           | autorización cancelada sin movimientos / admin; cargos conservan el motivo de cancelación                 |
| GET `/cuadres/preview`                         | query collectorId, date                               | collected, deposited, officeDelivered, paidToClients, difference                                          |
| GET `/cuadres`                                 | —                                                     | cierres visibles                                                                                          |
| POST `/cuadres`                                | collectorId, date                                     | cierre derivado de ledger / admin                                                                         |
| GET `/tracking`                                | —                                                     | posiciones/efectivo/estado autorizados                                                                    |
| POST `/tracking`                               | lat[-90..90], lng[-180..180]                          | `{ok:true}` / cobrador propio                                                                             |
| GET `/recibos/:token`                          | token aleatorio                                       | id, clientName, collectorName, concept, amount, createdAt, type                                           |
| GET `/recibos/:token/escpos`                   | query width=58 o 80                                   | binario ESC/POS ASCII                                                                                     |
| POST `/recibos/:token/revocar`                 | —                                                     | `{ok:true}` / admin                                                                                       |

`required` por defecto false; fechas ISO YYYY-MM-DD validadas. Cadenas de negocio 1–160 caracteres; ids 1–80; importe entero positivo máximo 1,000,000,000. Campos inesperados rechazados. El frontend no fija collectorId al cobrar: el backend lo obtiene del cargo y la ruta. Generación recurrente crea un lote explícito; no incluye scheduler automático.

## Ejemplo reproducible

```powershell
$login = Invoke-RestMethod http://127.0.0.1:3001/api/auth/login -Method Post -ContentType 'application/json' -Body '{"email":"collector@cyp.local","password":"Demo-CyP-2026!"}'
$headers = @{ Authorization = "Bearer $($login.token)"; 'Idempotency-Key' = [guid]::NewGuid().ToString() }
Invoke-RestMethod http://127.0.0.1:3001/api/cobros -Method Post -Headers $headers -ContentType 'application/json' -Body '{"chargeId":"chg-1","amount":10000}'
```

## Límites del contrato inicial

Lecturas operacionales completas con paginación/filtros en UI; antes de escalar añadir cursores y filtros de servidor. Seguimiento por actualización HTTP, no streaming GPS continuo. No existe importación automática de datos legados, integración bancaria, puente de impresión instalado, gestión de contraseñas completa ni modo financiero offline. El API no ejecuta SQL procedente del cliente.

Fuentes técnicas consultadas: [Fastify validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html).
