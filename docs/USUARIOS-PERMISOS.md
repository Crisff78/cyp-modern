# Permisos individuales de usuario

La autorización efectiva, la captura de envíos y el perfil de cada rol están
descritos en [DIONEL-REMESAS-PERMISOS.md](DIONEL-REMESAS-PERMISOS.md). Esta
versión necesita las migraciones aditivas **034** y **035** (rol Cajero), además
de la 023 original.

El catálogo común vive en `app/shared/permission-catalog.json`: 119 permisos con
sus nombres originales y códigos entre 1 y 501. Los huecos son parte del catálogo;
no hay 501 permisos consecutivos ni nombres inventados.

Las selecciones personalizadas restringen las acciones efectivas de cada cuenta,
dentro del alcance de su rol, y se comprueban en la interfaz y en cada petición.
No cambian el rol, contraseña, versión de credenciales o identidad de sesión.
Admin con permiso 106 puede guardar; Supervisor conserva solo consulta.

Además de las categorías del catálogo, el diálogo ofrece la categoría **Envíos de
Dinero** con las claves `remittances.*`; cada casilla se anuncia como «Envíos de
Dinero: {nombre}». Las acciones que superan el máximo del rol aparecen
desactivadas. El Cajero parte de los códigos 1 y 2 y de nueve claves de envíos
(consultar, registrar, recibos, pagar, cancelar, alta de clientes, y consultar,
abrir y cerrar su caja); en permisos personalizados solo puede ganar además
`remittances.reports`. Nunca recibe tasas, comisiones ni códigos de catálogo.
Usuario no tiene acceso con el perfil del rol; con permisos personalizados puede
recibir los códigos 1 y 2 y las claves de envíos, salvo abrir cajas y administrar
tasas o comisiones.

## Contrato

- `GET /api/permisos`: `{ categories, permissions: [{ id, name, category }] }`.
- `GET /api/usuarios/:id/permisos`: `{ userId, permissionIds, revision, mode, remittancePermissions }`.
- `POST /api/usuarios/:id/permisos`: `{ permissionIds: number[], revision: number, mode?, remittancePermissions? }`,
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
`023_user_permissions.sql`, `034_effective_user_permissions.sql` y
`035_cashier_role.sql`; sin `--apply`, `pnpm db:migrate` solo muestra las
migraciones registradas y pendientes. La 035 admite el rol `cashier` en cuentas
y sesiones sin tocar las asignaciones. Se conservan
los datos de las asignaciones antiguas y se añade un modo explícito. `role`
aplica el perfil inicial; `custom` aplica las selecciones dentro del alcance del
rol y `[]` significa ninguno. Las listas antiguas se revisan antes de pasar a
modo personalizado; no se activan silenciosamente al actualizar.
FileStore y el modo mock también conservan la selección en sus almacenes respectivos.

Las pruebas usan cuentas ficticias y almacenes aislados. La prueba PostgreSQL
opcional requiere `CYP_PERMISSION_TEST_DATABASE_URL` y acepta exclusivamente la
base de QA `cyp_permissions_qa` en `127.0.0.1:55436`, usuario `qa_cyp`.
