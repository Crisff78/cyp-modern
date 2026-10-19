# Roles y selección de cuentas de cobradores

Los formularios de usuarios y las solicitudes `POST /api/usuarios` y
`POST /api/usuarios/:id` comparten los valores `undefined` (No definido), `admin`
(Admin), `supervisor` (Supervisor), `collector` (Cobrador), `user` (Usuario) y
`cashier` (Cajero). Los valores históricos `admin` y `collector` se conservan. El
formulario nuevo propone `undefined`; la API continúa requiriendo un rol explícito.

Supervisor consulta información administrativa en lectura. No definido no
adquiere acceso. Usuario solo trabaja en Envíos de Dinero cuando Administración
le asigna permisos personalizados. Cajero atiende Envíos de Dinero para cualquier
cliente: envía, paga recibos, cancela sus envíos, da de alta clientes durante un
envío y abre y cierra su propia caja; no administra catálogos, tasas ni
comisiones. Las mutaciones administrativas siguen requiriendo Admin y las
operaciones móviles conservan el ámbito del Cobrador. Cambiar el rol o la
asignación de una cuenta sigue revocando sus sesiones anteriores. El perfil y el
máximo de permisos de cada rol están en
[DIONEL-REMESAS-PERMISOS.md](DIONEL-REMESAS-PERMISOS.md#roles-y-permisos).

Crear una cuenta como Admin, Supervisor, Cobrador o Cajero requiere el permiso
106; crearla como Usuario o No definido no lo requiere, porque esos roles no
conceden acceso inicial. Cambiar el rol de una cuenta existente requiere el 106
en todos los casos, también hacia Usuario o Cajero: el cambio puede dar, cambiar o
quitar acceso. Solo el paso entre No definido y Usuario, cuando ninguno de los dos
tiene acceso, sigue con el 103.

Cambiar el nombre, el usuario de inicio, el rol o el cobrador de otra cuenta, su
clave o su estado, o cerrar sus sesiones, exige además que el acceso efectivo de
quien lo hace incluya todos los permisos de esa cuenta: si no, 403
`ACCOUNT_MORE_PRIVILEGED`. El apodo y la nota siguen con el 103. La cuenta
principal de administración solo la modifica ella misma (403 `ACCOUNT_PROTECTED`).

Una cuenta de Admin o de Cajero no se asocia a un cobrador. `POST /api/usuarios`
y `POST /api/usuarios/:id` con `collectorId` devuelven 422 `COLLECTOR_NOT_ALLOWED`
(«Una cuenta de Cajero no se asocia a un cobrador.» en el caso del Cajero).

El selector de Cuenta consulta `GET /api/usuarios` sin secretos y ofrece las
cuentas activas de rol No definido, Supervisor, Cobrador y Usuario; nunca Admin
ni Cajero. OK copia el ID al borrador del cobrador; Cancelar no lo modifica. El
guardado principal persiste `accountId` mediante `/api/cobradores`. La API
comprueba referencias nuevas y rechaza Admin y Cajero con 422
`ACCOUNT_ROLE_FORBIDDEN` («Una cuenta Admin o Cajero no puede enlazarse a un
cobrador.»). Una cuenta de rol Cobrador debe corresponder al mismo cobrador de su
asignación operativa. Los códigos históricos sin correspondencia se conservan al
editar otros campos, pero no pueden asignarse de nuevo. Cambiar a Admin o Cajero
un usuario enlazado devuelve 409 `ACCOUNT_LINKED_COLLECTOR`: hay que retirar antes
el enlace informativo desde Cobradores.

La migración `022_account_roles.sql` amplía únicamente las restricciones de roles
en `users` y `auth_sessions`, conservando datos y credenciales; la
`035_cashier_role.sql` vuelve a crear esas mismas restricciones para admitir
`cashier`. Revisar su estado con `pnpm db:migrate --status` (solo muestra las
migraciones registradas y pendientes) y aplicarlas a la base local dedicada con
`pnpm db:migrate --apply`. Las pruebas usan datos sintéticos aislados.
