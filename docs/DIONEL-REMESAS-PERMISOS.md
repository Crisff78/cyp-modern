# Mejoras de Dionel: captura de envíos y permisos efectivos

Alcance aprobado el 18 de octubre de 2026, a partir de la transcripción de la
revisión. Se conservan los registros históricos, la separación entre el libro
de cobros/pagos y la caja de envíos, y la aritmética monetaria del servidor.

## Revisión del 19 de octubre de 2026

Cambios hechos encima de ese alcance por petición de Rardiel (alcance del 15 de
octubre de 2026):

- **Nombre visible del módulo.** El alcance del 18 de octubre conservaba el grupo
  «Remesas». Prevalece la petición de Rardiel: el grupo del menú se muestra como
  **ENVÍOS** (abreviatura «EN») y los textos visibles «Remesas» pasan a «Envíos»
  o «Envíos de Dinero»: categoría y nombres de permisos, «Comisiones de envíos»,
  «Tasa de envíos», el buscador de Entregas de Dinero, el comprobante de comisiones
  y los mensajes del servidor. Las claves internas no cambian: grupo `REMESAS`,
  permisos `remittances.*`, rutas `/api/envios` y nombres de archivos. Los textos
  de descargos legacy, los datos guardados y las reglas que reconocen servicios
  «remesa» se conservan.
- **Envíos de Dinero solo envía.** Pagos, caja y reportes pasan a sus lugares del
  sistema (ver «Dónde está cada función»).
- **Rol Cajero** (`cashier`): atiende Envíos de Dinero para cualquier cliente y
  abre y cierra su propia caja. Requiere la migración 035.

## Dónde está cada función

| Función | Ubicación en Administración | Requisito |
| --- | --- | --- |
| Registrar envíos y cancelar los pendientes | Envíos → Envíos de Dinero (lanzador ENVÍO DE DINERO) | `remittances.view`; registrar con `remittances.create`, cancelar con `remittances.cancel` |
| Entregar un envío a su destinatario | Envíos → Pagos de Envíos | `remittances.receipts`; pagar con `remittances.pay` |
| Entregas de efectivo de la oficina al cobrador | Envíos → Entregas de Dinero | 380; el buscador «Buscar envío para entregar» solo con `remittances.receipts` |
| Abrir, contar y cerrar la caja de envíos | Reportes & Monitoreo → Cuadres Diarios → Caja de envíos (lanzador CUADRES) | `remittances.cash.view`; abrir con `remittances.cash.open`, cerrar con `remittances.cash.close` |
| Cuadres de cobradores | Reportes & Monitoreo → Cuadres Diarios → Cuadres de cobradores | 401 |
| Reportes de envíos | Reportes & Monitoreo → Reportes, grupo «-- Envíos de Dinero --» | `remittances.reports` |
| Tasas del día e historial | Archivos → Admin. → Tasas de cambio | 200 y `remittances.rates.view`; registrar con 201 y `remittances.rates.manage` |
| Comisiones de envíos | Archivos → Admin. → Comisiones de envíos | rol Admin y `remittances.commissions.view`; cambiar con `remittances.commissions.manage` |

- **Envíos de Dinero** no tiene pestañas ni botón «Nuevo envío»: el formulario
  queda fijo arriba, con el cursor en Remitente, y el listado de envíos debajo,
  con Buscar y Estado. «Limpiar formulario», dentro del propio formulario, vacía
  la captura y vuelve al remitente. El detalle de un envío permite cancelarlo,
  pero no pagarlo.
- **Pagos de Envíos** es una ventana propia. Abre con el cursor en Buscar y el
  detalle ofrece «Registrar pago completo»; al cerrarlo, el cursor vuelve a Buscar.
  En Entregas de Dinero, «Buscar envío» abre esta ventana con los envíos pendientes
  que coinciden.
- **Cuadres Diarios** muestra el conmutador «Cuadres de cobradores» / «Caja de
  envíos» solo si la cuenta tiene las dos secciones. Cada sección se carga solo
  mientras se ve; sin el 401 no se consultan los cuadres de cobradores. El aviso
  «Cuadre al día» de la barra superior depende del 401.
- **Aviso de caja.** Para cuentas con `remittances.cash.view`: si no hay caja
  abierta hoy del operador en la moneda de origen, Envíos de Dinero lo indica
  antes del formulario; si sigue abierta una caja de un día anterior, pide cerrarla
  primero. Pagos de Envíos avisa igual en la moneda de destino de quien paga. El
  botón «Ir a Caja de envíos» abre Cuadres Diarios en esa sección. El servidor
  sigue decidiendo (`CASH_NOT_OPEN`, `PREVIOUS_CASH_OPEN`).
- Envíos de Dinero, Pagos de Envíos y Caja de envíos abiertas a la vez se
  actualizan solas después de cada operación confirmada.
- La barra superior muestra «cobradores en calle» solo con el 501 y la búsqueda
  global (Ctrl/Cmd+K) solo si la cuenta puede abrir Clientes o Rutas. Reportes
  no dibuja grupos sin reportes visibles.
- La terminal del cobrador no cambia: conserva sus pestañas Envíos, Recibos, Caja
  y Reportes, y el botón «Nuevo envío». El cobrador no abre cajas.

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
7. **Pagos de Envíos** enfoca la búsqueda. El pago completo sigue requiriendo
   revisión, permiso, caja, saldo y estado válidos en el servidor.

## Mantenimiento administrativo único

- **Archivos → Admin. → Tasas de cambio**: alta/edición autorizada, valores
  de compra y venta separados, historial con hora de Santo Domingo y actor. La
  columna de la tasa que usan los envíos se llama «Tasa de envíos».
- **Archivos → Admin. → Comisiones de envíos**: configuración central del
  porcentaje total y del gestor, con revisión y reintento seguro.
- La captura de envíos no contiene pestañas de mantenimiento de tasas o
  comisiones, tampoco cuando la usa un administrador. Se conservan la cotización
  inversa, sus redondeos, las tasas congeladas y el reparto de los envíos anteriores.

## Roles y permisos

**Usuarios → Permisos** ofrece dos modos:

- **Perfil del rol** conserva el perfil inicial compatible con el acceso anterior.
- **Permisos personalizados** aplica las selecciones de esa cuenta, dentro del
  alcance permitido por su rol. Supervisor continúa sin escrituras, Cobrador
  conserva las restricciones de su ruta y caja, y Cajero queda limitado a Envíos
  de Dinero y su propia caja. «Usuario» puede trabajar como operador de envíos al
  recibir permisos explícitos, sin administrar catálogos.

El catálogo legacy mantiene sus 119 códigos y nombres originales; no se inventan
nombres para los huecos del intervalo 1–501. La categoría adicional **Envíos de
Dinero** (antes «Remesas») usa las siguientes claves propias. El diálogo muestra
cada casilla como «Envíos de Dinero: {nombre}» y la columna Código como «Envíos».

| Clave | Nombre en el diálogo |
| --- | --- |
| `remittances.view` | Consultar envíos |
| `remittances.create` | Registrar envíos |
| `remittances.receipts` | Consultar recibos pendientes |
| `remittances.pay` | Entregar dinero al destinatario |
| `remittances.cancel` | Cancelar envíos pendientes |
| `remittances.clients.create` | Registrar clientes durante un envío |
| `remittances.cash.view` | Consultar caja de envíos |
| `remittances.cash.open` | Abrir cajas de envíos |
| `remittances.cash.close` | Cerrar la caja propia de envíos |
| `remittances.reports` | Consultar e imprimir reportes de envíos |
| `remittances.rates.view` | Consultar tasas de envíos |
| `remittances.rates.manage` | Administrar tasas de envíos |
| `remittances.commissions.view` | Consultar la configuración de comisiones |
| `remittances.commissions.manage` | Administrar comisiones de envíos |

Crear necesita consultar envíos; pagar necesita consultar recibos; altas rápidas
necesitan crear y consultar envíos; mantener tasas/comisiones requiere su consulta;
abrir/cerrar caja requiere consultar caja. El selector agrega las dependencias de
consulta al activar la acción. La entrada al sistema sigue dependiendo del código 1.
La gestión de tasas conserva además el código legacy 201; su ventana requiere 200.

Perfil de cada rol y máximo que admiten sus permisos personalizados (fuente:
`app/shared/access.mjs`). Lo que queda fuera del máximo aparece desactivado en el
diálogo y el servidor lo descarta.

| Rol | Perfil del rol | Máximo con permisos personalizados |
| --- | --- | --- |
| Admin | Todos los códigos y las 14 claves | Igual que el perfil |
| Supervisor | Códigos de consulta; `view`, `receipts`, `cash.view`, `reports`, `rates.view`, `commissions.view` | Igual que el perfil; nunca escribe |
| Cobrador | Sus códigos de terminal; todas las claves salvo `cash.open`, `rates.manage`, `commissions.view` y `commissions.manage` | Igual que el perfil |
| Cajero | Códigos 1 y 2; `view`, `create`, `receipts`, `pay`, `cancel`, `clients.create`, `cash.view`, `cash.open`, `cash.close` | Lo mismo más `remittances.reports` |
| Usuario | Sin acceso | Códigos 1 y 2; todas las claves salvo `cash.open`, `rates.manage` y `commissions.manage` |
| No definido | Sin acceso | Sin acceso |

Ningún rol distinto de Admin puede recibir `remittances.cash.open`, salvo el Cajero
para su propia caja. Una cuenta Usuario con solo recibos abre Pagos de Envíos; con
solo caja, Cuadres Diarios → Caja de envíos; con solo reportes, Reportes.

La misma política gobierna menú, accesos rápidos, panel de administración,
ventanas, acciones y API. Las mutaciones vuelven a leer los permisos dentro de
la transacción, antes incluso de devolver una respuesta idempotente. Se filtran
las proyecciones operativas para no mostrar datos de módulos retirados. Los
reportes de un Usuario o Cajero incluyen sus operaciones enviadas/pagadas, no toda
la cola pendiente que tiene autorización para entregar.

El permiso 106 permite gestionar perfiles. Crear/promover una cuenta con un rol
que concede acceso inicial (Admin, Supervisor, Cobrador o Cajero) requiere también
ese permiso, evitando una elevación indirecta desde «Agregar usuario». Un
administrador no puede retirarse su propio acceso a la pantalla de permisos. El
cambio no modifica contraseñas ni el rol de la cuenta objetivo; los permisos se
consultan nuevamente con la sesión vigente.

### Rol Cajero

- Se crea en **Archivos → Admin. → Usuarios** con el rol «Cajero» y sin cobrador.
  Una cuenta de Cajero no se asocia a un cobrador: la API responde 422
  `COLLECTOR_NOT_ALLOWED` si se le asigna uno, 422 `ACCOUNT_ROLE_FORBIDDEN` si se
  elige desde Cobradores y 409 `ACCOUNT_LINKED_COLLECTOR` al cambiar a Cajero una
  cuenta que un cobrador tiene enlazada.
- Atiende a cualquier cliente: elige remitentes y destinatarios de cualquier ruta
  y, con el alta rápida, registra clientes en cualquier ruta.
- En Envíos de Dinero ve solo los envíos que realizó y cancela solo esos. En Pagos
  de Envíos ve todos los envíos pendientes de cualquier operador y los que él pagó.
  Envía siempre a su nombre: no ve «Operador del envío».
- Abre su propia caja en Cuadres Diarios → Caja de envíos, con el operador fijo
  en su nombre, una por moneda y día. Si dejó abierta una caja de un día anterior,
  la sección la muestra y avisa: hay que cerrarla antes de abrir la de hoy. Cierra
  su caja con el contado exacto.
- En el portal ve el menú **ENVÍOS** (Envíos de Dinero y Pagos de Envíos) y
  **REPORTES & MONITOREO** (Cuadres Diarios, solo con la Caja de envíos), ambos
  desplegados al entrar, y los lanzadores ENVÍO DE DINERO y CUADRES. Si se le
  concede `remittances.reports`, Reportes muestra solo el grupo de envíos, con sus
  propias operaciones y su caja. No ve Clientes, Entregas de Dinero, catálogos,
  tasas, comisiones ni la búsqueda global.
- `GET /api/snapshot` llega recortado para Cajero y Usuario aunque estén en
  «Perfil del rol»: sin bancos, servicios, motivos, clientes, rutas, cobradores
  ni movimientos del libro de cobros. Puede cambiar su propia clave (código 2).

## Contratos añadidos

`GET /api/auth/me` devuelve `access: {mode, revision, legacy, remittances}`.
Los grants de un token no sustituyen la comprobación del estado persistido. Un
Cajero con perfil del rol recibe `role: "cashier"`, `legacy: [1, 2]` y las nueve
claves de su perfil.

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

`POST /api/usuarios` y `POST /api/usuarios/:id` admiten el rol `cashier`.

`POST /api/envios/cajas/abrir` lo usan Admin, para cualquier operador activo, y
el Cajero con `remittances.cash.open`, solo con `operatorId` igual a su propia
cuenta. Otro operador devuelve 403 `FORBIDDEN` «Solo puedes abrir tu propia caja
de envíos.». Cobrador, Usuario y Supervisor reciben 403.

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

Aplicar **034_effective_user_permissions.sql** y **035_cashier_role.sql** con el
mecanismo habitual de migraciones antes de arrancar esta versión sobre PostgreSQL.
La 034 añade `users.permission_mode` y `users.remittance_permissions`, con
restricciones de valores y longitud. La 035 vuelve a crear `users_role_check` y
`auth_sessions_role_check` admitiendo `cashier`; no reescribe filas ni
credenciales. Ninguna modifica las migraciones anteriores ni borra datos.

- `pnpm db:migrate` solo muestra el estado: las migraciones registradas y las
  pendientes, sin cambiar la base.
- `pnpm db:migrate --apply` aplica las pendientes en una sola transacción.
- La demo de Render las aplica al arrancar: su comando de inicio ejecuta
  `db:migrate --apply` antes de iniciar el servidor.
- Con `DEMO_MODE=true` sobre PostgreSQL, el arranque crea la cuenta de Cajero de
  práctica; si falta la 035 el servidor no inicia y avisa de que faltan migraciones.

Las antiguas listas eran referenciales. Se conservan, con modo inicial `role`,
para no bloquear cuentas al actualizar. Administración debe revisar cada cuenta
y guardar **Permisos personalizados** cuando quiera hacer efectiva su selección.
Seleccionar otra vez **Perfil del rol** recupera ese perfil, sin editar datos financieros.

## Revisión funcional sugerida

1. Aplicar las migraciones con `pnpm db:migrate --apply` en la instalación de
   prueba y arrancar la versión actualizada.
2. Crear dos cuentas de rol **Usuario**. En **Usuarios → Permisos**, elegir
   **Permisos personalizados** y conservar «Entrar al sistema». En **Envíos de
   Dinero**, conceder a la primera consulta, registro, alta de clientes y entrega;
   a la segunda, solo consulta. Las dependencias de consulta se marcan automáticamente.
3. Con Administración, abrir la caja del primer operador en la moneda de prueba,
   en Reportes & Monitoreo → Cuadres Diarios → Caja de envíos. Iniciar sesión con
   esa cuenta y registrar un envío con dos fichas nuevas en Envíos de Dinero.
   Cancelar una captura primero debe dejar intacto el catálogo. Confirmar el envío
   debe guardar ambas fichas y dejar listo el siguiente formulario.
4. En Pagos de Envíos, buscar y entregar el recibo con revisión explícita. La
   segunda cuenta debe poder consultar únicamente su alcance y no registrar ni
   pagar operaciones.
5. Retirar el permiso de registro a la primera cuenta y actualizar su pantalla:
   la captura deja de estar disponible. Una petición directa también se rechaza
   con la sesión existente, aunque la pantalla todavía no se haya actualizado.
6. Crear una cuenta **Cajero** (en la demo, `cajero@cyp.local`). Con ella, abrir
   su caja en Cuadres Diarios → Caja de envíos, enviar desde un remitente de
   cualquier ruta, pagar en Pagos de Envíos un recibo pendiente de otro operador y
   cerrar la caja con el contado exacto. Abrir la caja de otro operador debe
   rechazarse.
7. Comprobar que tasas y comisiones se mantienen únicamente desde Administración,
   y que los envíos anteriores conservan sus valores originales.

## Comprobación

Ejecución local del 18 de octubre de 2026 (alcance de Dionel): el script `check`
del repositorio, que se ejecuta con `pnpm check`, terminó con código 0.
API: **335 aprobadas, 14 omitidas, 0 fallos**; PWA: **12 aprobadas, 0 fallos**;
Administración: **212 aprobadas, 0 fallos**. Tipos y compilaciones de los tres
paquetes aprobados. `git diff --check` sin errores. Las 14 pruebas omitidas
requieren otros entornos PostgreSQL específicos; no se cuentan como ejecutadas.

- Pruebas de API con MemoryStore: perfiles distintos del mismo rol, revocación
  con el mismo token, contratos estrictos, protección contra elevación de roles,
  filtrado de reportes, altas atómicas, duplicados y reintentos.
- Prueba PostgreSQL dedicada en loopback: migraciones 001–034, persistencia al
  reabrir el almacén y rechazo de claves/modos no válidos, sin alterar credenciales.
  Una prueba transaccional adicional guardó dos clientes y un envío, verificó
  la relectura desde otro almacén y el reintento sin duplicados. El intento sin
  caja abierta no dejó clientes, reservas ni movimientos.
- Navegador Edge con perfil temporal y API local de datos ficticios: Admin/PWA,
  cotización directa/inversa, cancelación, CSV/impresión aislada, cajero limitado,
  alta integrada, teclado, foco, modales bloqueantes y revocación de creación.
- Las pruebas de seguridad previas se mantienen; las expectativas de interfaz y
  contrato se actualizan donde cambió deliberadamente el flujo.

Ejecución local del 19 de octubre de 2026 (revisión de esta fecha, sin publicar):
`pnpm check` terminó con código 0. API: **343 aprobadas, 15 omitidas, 0 fallos**;
PWA: **12 aprobadas, 0 fallos**; Administración: **221 aprobadas, 0 fallos**.
Tipos y compilaciones de los tres paquetes aprobados. Incluye las pruebas del rol
Cajero en la API (`cashier-role.test.ts`) y en Edge (`cashier-shell-ui.test.ts`:
menú ENVÍOS, Cuadres con solo la Caja, abrir, enviar, pagar y cerrar su caja, y la
PWA con sus cuatro pestañas). Las 15 omitidas requieren PostgreSQL dedicado, entre
ellas la que recorre los roles contra las restricciones de la 035; no se
ejecutaron en este equipo.

No se introducen privilegios especiales por GUID, un SuperAdmin nuevo ni edición
de envíos registrados. La reserva exacta de facultades del propietario/soporte
requiere una definición adicional de Gerencia. La impresión física y el GPS
físico no quedan acreditados por estas pruebas de navegador. Estos cambios
locales no constituyen evidencia de publicación en Render.
