# Mejoras de Dionel: captura de remesas y permisos efectivos

Alcance aprobado el 18 de octubre de 2026, a partir de la transcripción de la
revisión. Se conserva el grupo Remesas, los registros históricos, la separación
entre el libro de cobros/pagos y la caja de remesas, y la aritmética monetaria
del servidor.

## Uso del flujo

1. Abrir **Envíos de Dinero** deja disponible el formulario y enfoca Remitente.
2. Buscar por teléfono, código, nombre o identificación. Elegir una coincidencia
   carga el contacto para consulta; no convierte el formulario en edición de la ficha.
   Si hay varias coincidencias, Enter no elige la primera sin una selección explícita.
3. **Registrar cliente nuevo** abre una captura breve de nombre, documento,
   teléfono, dirección, ruta autorizada y moneda habitual. **Usar estos datos**
   prepara la ficha, sin guardarla todavía. Cancelar no crea registros.
4. Cotizar por origen o destino, revisar y confirmar explícitamente. El servidor
   asigna código e identificación interna y guarda las fichas nuevas y el envío
   en una sola transacción. Una identificación documental duplicada pide buscar
   la ficha existente. Un rechazo o reintento no deja fichas sueltas ni duplica el envío.
5. Tras la respuesta confirmada se ofrece imprimir y se limpian ambos clientes,
   teléfonos, importe, nota, monedas y operador. El formulario continúa abierto
   y vuelve al remitente; un resultado incierto conserva el intento y su misma clave.
6. En los inputs de captura, Enter avanza y Shift+Enter retrocede. Tab funciona
   normalmente; selectores nativos, selección de clientes y notas multilínea
   conservan su comportamiento. Recorrer campos nunca confirma una operación monetaria.
7. **Recibos** enfoca la búsqueda. El pago completo sigue requiriendo revisión,
   permiso, caja, saldo y estado válidos en el servidor.

## Mantenimiento administrativo único

- **Archivos → Admin. → Tasas de cambio**: alta/edición autorizada, valores
  de compra y venta separados, historial con hora de Santo Domingo y actor.
- **Archivos → Admin. → Comisiones de remesas**: configuración central del
  porcentaje total y del gestor, con revisión y reintento seguro.
- La captura de remesas no contiene pestañas de mantenimiento de tasas o
  comisiones, tampoco cuando la usa un administrador. Se conservan la cotización
  inversa, sus redondeos, las tasas congeladas y el reparto de las remesas anteriores.

## Roles y permisos

**Usuarios → Permisos** ofrece dos modos:

- **Perfil del rol** conserva el perfil inicial compatible con el acceso anterior.
- **Permisos personalizados** aplica las selecciones de esa cuenta, dentro del
  alcance permitido por su rol. Supervisor continúa sin escrituras y Cobrador
  conserva las restricciones de su ruta y caja. «Usuario» puede trabajar como
  cajero de remesas al recibir permisos explícitos, sin administrar catálogos.

El catálogo legacy mantiene sus 119 códigos y nombres originales; no se inventan
nombres para los huecos del intervalo 1–501. La categoría adicional **Remesas**
usa las siguientes claves propias:

| Clave | Acción |
| --- | --- |
| `remittances.view` | Consultar envíos |
| `remittances.create` | Registrar envíos |
| `remittances.receipts` | Consultar recibos |
| `remittances.pay` | Entregar al destinatario |
| `remittances.cancel` | Cancelar envíos pendientes |
| `remittances.clients.create` | Alta de clientes durante un envío |
| `remittances.cash.view` | Consultar caja |
| `remittances.cash.open` | Apertura administrativa de cajas |
| `remittances.cash.close` | Cierre autorizado de caja |
| `remittances.reports` | Consultar, exportar e imprimir reportes |
| `remittances.rates.view` | Consultar tasas |
| `remittances.rates.manage` | Mantener tasas |
| `remittances.commissions.view` | Consultar configuración de comisiones |
| `remittances.commissions.manage` | Mantener comisiones |

Crear necesita consultar envíos; pagar necesita consultar recibos; altas rápidas
necesitan crear y consultar envíos; mantener tasas/comisiones requiere su consulta;
abrir/cerrar caja requiere consultar caja. El selector agrega las dependencias de
consulta al activar la acción. La entrada al sistema sigue dependiendo del código 1.
La gestión de tasas conserva además el código legacy 201; su ventana requiere 200.

La misma política gobierna menú, accesos rápidos, panel de administración,
ventanas, acciones y API. Las mutaciones vuelven a leer los permisos dentro de
la transacción, antes incluso de devolver una respuesta idempotente. Se filtran
las proyecciones operativas para no mostrar datos de módulos retirados. Los
reportes de un cajero incluyen sus operaciones enviadas/pagadas, no toda la cola
pendiente que tiene autorización para entregar.

El permiso 106 permite gestionar perfiles. Crear/promover una cuenta con un rol
que concede acceso inicial requiere también ese permiso, evitando una elevación
indirecta desde «Agregar usuario». Un administrador no puede retirarse su propio
acceso a la pantalla de permisos. El cambio no modifica contraseñas ni el rol
de la cuenta objetivo; los permisos se consultan nuevamente con la sesión vigente.

## Contratos añadidos

`GET /api/auth/me` devuelve `access: {mode, revision, legacy, remittances}`.
Los grants de un token no sustituyen la comprobación del estado persistido.

`GET /api/usuarios/:id/permisos` añade `mode` y `remittancePermissions`.
`POST` conserva `permissionIds` y `revision` obligatorios, y admite:

```json
{
  "permissionIds": [1, 2],
  "revision": 0,
  "mode": "custom",
  "remittancePermissions": ["remittances.view", "remittances.create"]
}
```

`POST /api/envios` admite, por cada participante, **exactamente una** alternativa:
`senderClientId` o `newSenderClient`, y `recipientClientId` o `newRecipientClient`.
Cada ficha nueva contiene `name`, `identification`, `phone`, `address`, `routeId`
y `preferredCurrency?`. No acepta códigos, roles, IDs técnicos o saldos digitados.
El documento conserva el requisito de la validación general de clientes; no se
fabrican cédulas cuando falta. La respuesta incluye los IDs asignados y los
contactos congelados, comprobados antes de ofrecer imprimir.

Las demás validaciones de dinero, comisión, frecuencia, contactos, estado, caja,
idempotencia y permisos de ruta permanecen vigentes.

## Migración y transición

Aplicar **034_effective_user_permissions.sql** con el mecanismo habitual de
migraciones antes de arrancar esta versión sobre PostgreSQL. Añade
`users.permission_mode` y `users.remittance_permissions`, con restricciones de
valores y longitud. No modifica las migraciones 001–033 ni borra datos.

Las antiguas listas eran referenciales. Se conservan, con modo inicial `role`,
para no bloquear cuentas al actualizar. Administración debe revisar cada cuenta
y guardar **Permisos personalizados** cuando quiera hacer efectiva su selección.
Seleccionar otra vez **Perfil del rol** recupera ese perfil, sin editar datos financieros.

## Revisión funcional sugerida

1. Aplicar las migraciones con `pnpm db:migrate` en la instalación de prueba y
   arrancar la versión actualizada.
2. Crear dos cuentas de rol **Usuario**. En **Usuarios → Permisos**, elegir
   **Permisos personalizados** y conservar «Entrar al sistema». En **Remesas**,
   conceder a la primera consulta, registro, alta de clientes y entrega; a la
   segunda, solo consulta. Las dependencias de consulta se marcan automáticamente.
3. Con Administración, abrir la caja del primer operador en la moneda de prueba.
   Iniciar sesión con esa cuenta y registrar un envío con dos fichas nuevas.
   Cancelar una captura primero debe dejar intacto el catálogo. Confirmar el envío
   debe guardar ambas fichas y dejar listo el siguiente formulario.
4. Buscar y entregar el recibo con revisión explícita. La segunda cuenta debe
   poder consultar únicamente su alcance y no registrar ni pagar operaciones.
5. Retirar el permiso de registro a la primera cuenta y actualizar su pantalla:
   la captura deja de estar disponible. Una petición directa también se rechaza
   con la sesión existente, aunque la pantalla todavía no se haya actualizado.
6. Comprobar que tasas y comisiones se mantienen únicamente desde Administración,
   y que los envíos anteriores conservan sus valores originales.

## Comprobación

Ejecución local del 18 de octubre de 2026: `npm run check` terminó con código 0.
API: **335 aprobadas, 14 omitidas, 0 fallos**; PWA: **12 aprobadas, 0 fallos**;
Administración: **212 aprobadas, 0 fallos**. Tipos y compilaciones de los tres
paquetes aprobados. `git diff --check` sin errores. Las 14 pruebas omitidas
requieren otros entornos PostgreSQL específicos; no se cuentan como ejecutadas.

- Pruebas de API con MemoryStore: perfiles distintos del mismo rol, revocación
  con el mismo token, contratos estrictos, protección contra elevación de roles,
  filtrado de reportes, altas atómicas, duplicados y reintentos.
- Prueba PostgreSQL dedicada en loopback: migraciones 001–034, persistencia al
  reabrir el almacén y rechazo de claves/modos no válidos, sin alterar credenciales.
  Una prueba transaccional adicional guardó dos clientes y una remesa, verificó
  la relectura desde otro almacén y el reintento sin duplicados. El intento sin
  caja abierta no dejó clientes, reservas ni movimientos.
- Navegador Edge con perfil temporal y API local de datos ficticios: Admin/PWA,
  cotización directa/inversa, cancelación, CSV/impresión aislada, cajero limitado,
  alta integrada, teclado, foco, modales bloqueantes y revocación de creación.
- Las pruebas de seguridad previas se mantienen; las expectativas de interfaz y
  contrato se actualizan donde cambió deliberadamente el flujo.

No se introducen privilegios especiales por GUID, un SuperAdmin nuevo ni edición
de remesas registradas. La reserva exacta de facultades del propietario/soporte
requiere una definición adicional de Gerencia. La impresión física y el GPS
físico no quedan acreditados por estas pruebas de navegador. Estos cambios
locales no constituyen evidencia de publicación en Render.
