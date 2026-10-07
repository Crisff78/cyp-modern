# Roles y selección de cuentas de cobradores

Los formularios de usuarios y las solicitudes `POST /api/usuarios` y
`POST /api/usuarios/:id` comparten los valores `undefined` (No definido), `admin`
(Admin), `supervisor` (Supervisor), `collector` (Cobrador) y `user` (Usuario).
Los valores históricos `admin` y `collector` se conservan. El formulario nuevo
propone `undefined`; la API continúa requiriendo un rol explícito.

Supervisor consulta información administrativa en lectura. No definido y Usuario
no adquieren acceso operativo. Las mutaciones administrativas siguen requiriendo
Admin y las operaciones móviles conservan el ámbito del Cobrador. Cambiar el rol
o la asignación de una cuenta sigue revocando sus sesiones anteriores.

El selector de Cuenta consulta `GET /api/usuarios` sin secretos y ofrece los cuatro
roles distintos de Admin. OK copia el ID al borrador del cobrador; Cancelar no lo
modifica. El guardado principal persiste `accountId` mediante `/api/cobradores`.
La API comprueba referencias nuevas y rechaza Admin. Una cuenta de rol Cobrador
debe corresponder al mismo cobrador de su asignación operativa. Los códigos
históricos sin correspondencia se conservan al editar otros campos, pero no pueden
asignarse de nuevo. Cambiar un usuario enlazado a Admin requiere retirar antes el
enlace informativo desde Cobradores.

La migración `022_account_roles.sql` amplía únicamente las restricciones de roles
en `users` y `auth_sessions`, conservando datos y credenciales. Revisar su estado
con `pnpm db:migrate --status` y aplicarla a la base local dedicada con
`pnpm db:migrate --apply`. Las pruebas usan datos sintéticos aislados.
