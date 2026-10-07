# Asignaciones de permisos legacy

El catálogo común vive en `app/shared/permission-catalog.json`: 119 permisos con
sus nombres originales y códigos entre 1 y 501. Los huecos son parte del catálogo;
no hay 501 permisos consecutivos ni nombres inventados.

Estas asignaciones se conservan por cuenta. No sustituyen las restricciones por
rol de la API, no amplían operaciones financieras ni cambian JWT, contraseña,
versión de credenciales o sesiones. Admin puede guardar; Supervisor puede consultar.

## Contrato

- `GET /api/permisos`: `{ categories, permissions: [{ id, name, category }] }`.
- `GET /api/usuarios/:id/permisos`: `{ userId, permissionIds, revision }`.
- `POST /api/usuarios/:id/permisos`: `{ permissionIds: number[], revision: number }`,
  con JWT e `Idempotency-Key` de 8 a 100 caracteres.

El cuerpo es estricto: solo acepta códigos enteros existentes, sin duplicados, y
una revisión entera no negativa. Un usuario inexistente devuelve 404. Una revisión
desactualizada devuelve 409 `PERMISSIONS_CHANGED` sin cambiar los datos. Reintentar
con la misma clave y cuerpo recupera la respuesta original sin duplicar la escritura.
El contrato de solicitudes también está publicado en `/api/openapi.json`.

El modal carga las asignaciones del servidor y mantiene un borrador. Seleccionar
o desmarcar todos afecta solo la categoría visible; cambiar de categoría conserva
las demás selecciones. Guardar reemplaza el conjunto del usuario elegido. Cancelar,
Escape y X descartan el borrador. Si el resultado de un guardado es incierto, el
formulario conserva la solicitud y permite reintentar antes de cerrarse.

## Persistencia

Aplicar `pnpm db:migrate --apply` en la base local configurada para incorporar
`023_user_permissions.sql`. La migración añade dos columnas a `users`, sin cambiar
registros, roles o credenciales existentes. `NULL` conserva los valores iniciales
(todos para Admin, ninguno para otros roles); `[]` significa ninguno explícitamente.
FileStore y el modo mock también conservan la selección en sus almacenes respectivos.

Las pruebas usan cuentas ficticias y almacenes aislados. La prueba PostgreSQL
opcional requiere `CYP_PERMISSION_TEST_DATABASE_URL` y acepta exclusivamente la
base de QA `cyp_permissions_qa` en `127.0.0.1:55436`, usuario `qa_cyp`.
