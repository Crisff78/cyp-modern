# Permisos adicionales al perfil del rol

El rol propone los permisos iniciales de cada cuenta. Administración puede
autorizar acciones adicionales sin cambiar el rol, la contraseña ni la identidad
de la sesión. La asignación de rutas y las restricciones sobre movimientos y
cajas de otros operadores siguen vigentes.

## Uso

1. En Usuarios, selecciona la cuenta y abre Permisos.
2. Selecciona un permiso del catálogo y pulsa Agregar.
3. Si no viene por defecto en su rol, confirma la advertencia. Todavía no se guarda.
4. Revisa Permisos asignados y confirma Guardar. Quitar también pide confirmación.

Cancelar, cerrar la ventana o rechazar la advertencia no conceden el permiso.
Las dependencias de acceso a la pantalla se agregan con la acción. Las tasas
necesitan tanto sus códigos del catálogo como sus permisos de Remesas.

## Contrato y conservación de accesos

- La migración aditiva `040_confirmed_role_exceptions.sql` agrega
  `users.role_exceptions`, inicialmente `false`. En la instalación local se aplica
  con `pnpm db:migrate --apply`; el arranque publicado aplica sus migraciones.
- `POST /api/usuarios/:id/permisos` acepta el campo booleano opcional
  `roleExceptions`. Una nueva excepción requiere `true`, modo `custom`, revisión
  vigente y una cuenta autorizada con el permiso 106. El esquema sigue siendo estricto.
- Las listas históricas guardadas fuera del perfil siguen sin activarse por sí
  solas. La interfaz solo adopta lo previamente efectivo o confirmado.
- Un administrador limitado no puede conceder permisos que no posee ni recuperar
  permisos retirados eligiendo el perfil del rol. Crear o cambiar un rol tampoco
  puede utilizarse para fabricar acceso superior. Un cobrador no puede delegar
  permisos a una identidad con otra ruta o un alcance de oficina más amplio.
- Las operaciones con permisos adicionales se vuelven a autorizar dentro de la
  transacción. Los controles de dominio solo aceptan la autoridad local establecida
  por esa comprobación de ruta; no existe una elevación del rol en el token.
- Las cajas adicionales se abren únicamente para el propio operador. Un cobrador
  mantiene su ámbito sobre clientes y movimientos, incluso al editar o reasignar.
- El perfil del rol no aplica excepciones. Al retirar la última excepción del
  borrador, la interfaz desactiva expresamente su autorización al guardar.
- Los permisos heredados que no tienen una acción implementada conservan su
  referencia; asignarlos no crea una función nueva. Las operaciones sin un permiso
  individual de modificación, como mantenimiento de bancos, siguen requiriendo
  una cuenta de administración.

Las respuestas inciertas reutilizan el mismo cuerpo y clave de idempotencia.
Guardar conserva la ventana abierta; las confirmaciones y revisiones evitan
sobrescribir el trabajo de otro operador.
