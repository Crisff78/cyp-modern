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
Admin con permiso 106 puede guardar; Supervisor conserva solo consulta. Sin el
106, el diálogo lo explica: «Tu cuenta no tiene permiso para modificar permisos
(«Modificar permisos de usuario», 106).». Los permisos de la cuenta principal de
administración solo los cambia ella misma (403 `ACCOUNT_PROTECTED`), y un
administrador no puede retirarse los códigos 1, 10, 101 y 106 (409
`OWN_ADMIN_ACCESS`).

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
Si se omite `mode`, la cuenta conserva su modo actual: en modo `role` la lista se
guarda como referencia sin efecto, y solo `mode: "custom"` explícito la aplica.
El contrato de solicitudes también está publicado en `/api/openapi.json`.

El modal carga las asignaciones del servidor y mantiene un borrador. Seleccionar
o desmarcar todos afecta solo la categoría visible; cambiar de categoría conserva
las demás selecciones. Guardar reemplaza el conjunto del usuario elegido, envía
siempre `mode` y mantiene abierta la ventana. La respuesta confirmada actualiza
la revisión del borrador para poder guardar otro cambio sin cerrar ni reabrir.
Cancelar, Escape y X descartan solo los cambios posteriores al último guardado.
Si el resultado de un
guardado es incierto, el formulario conserva la solicitud y permite reintentar
antes de cerrarse. Si ese reintento se rechaza porque la cuenta perdió el permiso
(403), el diálogo y su ventana se pueden cerrar: el intento se conserva, con su
clave y sus datos, y al recuperar el permiso «Reintentar guardado» recupera el
resultado sin escribir dos veces.

El catálogo muestra **Asignado** para la selección de cada permiso; no es el
estado activo/inactivo de la cuenta de usuario. Clicar una fila, su nombre o su
casilla cambia esa selección una sola vez; Enter o Espacio funcionan sobre la
fila. Los permisos que el rol no permite y los que protegen el acceso propio
siguen bloqueados y explican el motivo.

El panel **Permisos asignados** permanece visible al cambiar de categoría. Muestra
los nombres, categoría y estado: **Guardado**, **Del perfil del rol**, **Por
agregar** o **Por quitar**. Permite quitar una selección y restaurar una retirada
pendiente. El catálogo marca los permisos guardados como **Ya asignado**, evitando
confundirlos con uno nuevo. Nada del borrador se aplica hasta pulsar Guardar;
guardar una asignación no activa automáticamente una cuenta inactiva ni supera
los límites de su rol.

En «Perfil del rol», si la cuenta tiene guardada una lista distinta del perfil, el
diálogo la muestra en el grupo «Selección anterior de permisos», sin efecto, con
los códigos que quedan fuera del alcance del rol. Guardar con el perfil del rol la
conserva; «Aplicar selección anterior» la convierte en permisos personalizados
(ver [DIONEL-REMESAS-PERMISOS.md](DIONEL-REMESAS-PERMISOS.md#migración-y-transición)).
Lo mismo vale para las claves de Envíos: en modo `role`, `GET /usuarios/:id/permisos`
devuelve en `remittancePermissions` las claves guardadas como referencia (las del
perfil del rol si la cuenta no guardó ninguna), y un `POST` sin
`remittancePermissions` las conserva. Lo que se aplica sigue siendo el perfil del
rol (`/api/auth/me`). Al cambiar el rol de una cuenta en «Perfil del rol» se
descarta la copia guardada del perfil del rol anterior.

## Persistencia

Aplicar `pnpm db:migrate --apply` en la base local configurada para incorporar
`023_user_permissions.sql`, `034_effective_user_permissions.sql` y
`035_cashier_role.sql`; sin `--apply`, `pnpm db:migrate` solo muestra las
migraciones registradas y pendientes. La 035 admite el rol `cashier` en cuentas
y sesiones sin tocar las asignaciones. Se conservan
los datos de las asignaciones antiguas y se añade un modo explícito. `role`
aplica el perfil inicial; `custom` aplica las selecciones dentro del alcance del
rol y `[]` significa ninguno. Las listas antiguas se revisan antes de pasar a
modo personalizado; no se activan silenciosamente al actualizar ni al guardar sin
`mode`.
FileStore y el modo mock también conservan la selección en sus almacenes respectivos.

Las pruebas usan cuentas ficticias y almacenes aislados. La prueba PostgreSQL
opcional requiere `CYP_PERMISSION_TEST_DATABASE_URL` y acepta exclusivamente la
base de QA `cyp_permissions_qa` en `127.0.0.1:55436`, usuario `qa_cyp`.
