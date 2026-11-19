# Resoluciones de la revisión EGM

Dos revisores contrastaron los formularios, las rutas de acceso y la instalación firmada con el plan.

- El catálogo previo ofrece número y nombre activos en un GET. El POST que comprueba vínculos sigue requiriendo sesión. En Render la invitación cubre ambos.
- La opción automática permite el ingreso habitual, incluso cuando no hay catálogo o estación. Con varias estaciones no escoge ninguna. La cabecera verifica el vínculo real con la sesión. «Última usada» es una pista del navegador, nunca una orden de registrar.
- Para una elección expresa, cotejar primero el vínculo. Usar uno existente no requiere editar estaciones. Un alta requiere los permisos 111 y 113 y la autorización de la API. Si el vínculo difiere, hay varios, falta almacenamiento o cae la conexión, explicar el problema en el formulario. El operador puede volver a la opción automática.
- Reusar la misma sesión provisional y la petición firmada ante un fallo. En ese estado se bloquean las credenciales hasta «Cambiar cuenta». El token se mantiene en memoria durante esta fase. Al terminar se entrega al portal que corresponde; al cambiar de cuenta se solicita el cierre de la sesión provisional.
