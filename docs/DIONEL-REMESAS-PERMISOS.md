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
- **Correcciones de la revisión del PR 36**: ver la sección del mismo nombre.

## Correcciones de la revisión del PR 36

La revisión del PR 36 (18 y 19 de octubre de 2026) dejó estos comportamientos,
comprobados en el código y con pruebas:

**Cuentas y permisos**

- Gestionar otra cuenta exige que el acceso efectivo de quien lo hace incluya
  todos los permisos de esa cuenta, en códigos y en claves de envíos. Eso vale
  para cambiar su clave, su nombre, su usuario de inicio, su rol o su cobrador,
  desactivarla o reactivarla y cerrar sus sesiones. Si no, la API responde 403
  `ACCOUNT_MORE_PRIVILEGED` y no cambia nada. El apodo y la nota siguen con el 103.
- La cuenta principal de administración (`configured-admin`; en la demo,
  `demo-admin`) solo la modifica ella misma: datos, clave, estado, permisos y
  sesiones. Si lo intenta otra cuenta, la respuesta es 403 `ACCOUNT_PROTECTED`.
- Todo cambio de rol exige el 106, también hacia Usuario o Cajero. Solo el paso
  entre No definido y Usuario, cuando ninguno de los dos tiene acceso, sigue con el 103.
- Con «Perfil del rol» toda cuenta cambia su propia clave. Con permisos
  personalizados lo decide el código 2.
- `POST /api/usuarios/:id/permisos` sin `mode` conserva el modo actual de la cuenta.
- En «Perfil del rol», el diálogo de permisos muestra la selección anterior
  guardada, sin efecto, y la conserva al guardar. Solo se aplica con «Aplicar
  selección anterior» (ver «Migración y transición»).

**Requisitos que ahora coinciden en la interfaz y en la API**

- Cambiar los límites de un cobrador: 156, también desde la edición completa de su ficha.
- Generar cargos recurrentes: 350, 351, 300 y 301.
- Cerrar la jornada de un cobrador (`POST /api/cuadres`): 402 y 403.
- Activar o inactivar desde la edición completa: PCP 173, estación 114. Archivar o
  desarchivar un descargo recurrente: 393. En la edición de PCP y estación, `active`
  es opcional: si no se envía, se conserva el estado actual.
- Monitor de cobradores: 501. Los monitores de zonas y rutas siguen con el 500.
- Subir un archivo de cargos: 304 (descargos: 364). Aceptar un depósito: 334, sin
  el 332. Cerrar sesiones ajenas: 116.

**Envíos de Dinero**

- Un Cobrador con permisos personalizados recibe siempre su propia ficha, sus
  rutas, movimientos, jornadas y totales. Su terminal ya no muestra RD$0 ni límites 0.
- Supervisor consulta todos los envíos, recibos, cajas y reportes, sin pagar,
  cancelar ni cerrar cajas.
- Una cuenta de solo consulta (`remittances.view`) recibe los nombres de los
  clientes de sus envíos. El listado y la confirmación de pago usan primero los
  nombres guardados con cada envío.
- «Operador del envío» ofrece solo las cuentas que pueden registrar envíos.
- Una cédula o pasaporte repetido en el alta rápida dice cómo continuar (ver «Uso del flujo»).
- Un destinatario nuevo sin teléfono propio guarda el número escrito en
  «Teléfono del destinatario».
- El teléfono del destinatario se compara por dígitos. El mismo número con otro
  formato ya no deja el envío «sin confirmar».

**Administración y terminal del cobrador**

- Quien puede ver una pantalla, pero no modificar el registro, abre la ficha con
  «Consultar», en solo lectura: Clientes, catálogos, Estaciones, Grupos y PCPs.
- La campana avisa de cobros sin depósito confirmado solo si la cuenta puede ver
  cobros, depósitos y cuadres (320, 330 y 401).
- Un reporte abierto sin el permiso de alguno de sus datos lo avisa, en lugar de
  mostrar ceros. Los códigos 410–415 se conservan, pero los reportes se abren con el 400.
- Si la cuenta pierde el acceso al portal de administración con la sesión abierta,
  el siguiente refresco cierra la sesión y explica el motivo.
- En la terminal del cobrador, si falta el permiso de la vista pedida (por
  ejemplo «Mi ruta», 300), se abre la primera vista permitida. «Mi bolsillo»
  siempre está disponible.

**Se mantienen por decisión**

- El Cobrador conserva `remittances.clients.create`: el alta rápida durante un
  envío, siempre en su propia ruta. No recibe el 141 del catálogo general.
- El 106 sigue siendo el permiso superior de gestión de perfiles: quien lo tiene
  puede ampliar sus propios permisos dentro de su rol. Conviene concederlo solo a
  quien administre perfiles.

## Dónde está cada función

| Función | Ubicación en Administración | Requisito |
| --- | --- | --- |
| Registrar envíos y cancelar los pendientes | Envíos → Envíos de Dinero (lanzador ENVÍO DE DINERO) | `remittances.view`; registrar con `remittances.create`, cancelar con `remittances.cancel` |
| Entregar un envío a su destinatario | Envíos → Pagos de Envíos | `remittances.receipts`; pagar con `remittances.pay` |
| Entregas de efectivo de la oficina al cobrador | Envíos → Entregas de Dinero | 380; el buscador «Buscar envío para entregar» solo con `remittances.receipts` |
| Abrir, contar y cerrar la caja de envíos | Reportes & Monitoreo → Cuadres Diarios → Caja de envíos (lanzador CUADRES) | `remittances.cash.view`; abrir con `remittances.cash.open`, cerrar con `remittances.cash.close` |
| Cuadres de cobradores | Reportes & Monitoreo → Cuadres Diarios → Cuadres de cobradores | 401; cerrar la jornada con 402 y 403 |
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
   Con el buscador vacío, Enter pasa al campo siguiente. Con una búsqueda escrita,
   Enter elige la única coincidencia; si hay varias, el primer Enter resalta la
   primera y el segundo la elige (también se resalta con las flechas). Si la
   búsqueda encuentra clientes recientes que aún no están en la vista, aparece un
   aviso dentro de la lista y Enter no elige ni resalta ninguno: hay que pulsar
   Actualizar. Volver al cliente ya elegido y pulsar Enter no cambia las
   monedas ni la cotización.
3. **Registrar cliente nuevo** abre una captura breve de nombre, documento,
   teléfono, dirección, ruta autorizada y moneda habitual, con el cursor en
   «Cliente:». **Usar estos datos** prepara la ficha, sin guardarla todavía.
   Cancelar no crea registros y devuelve el cursor al botón. El botón queda en su
   sitio, deshabilitado, mientras la búsqueda está en curso, falla o encuentra
   clientes que faltan en la vista.
4. Cotizar por origen o destino, revisar y confirmar explícitamente. La revisión
   final muestra, para cada ficha nueva, su cédula o pasaporte y su ruta. El
   servidor asigna código e identificación interna y guarda las fichas nuevas y
   el envío en una sola transacción. Un rechazo o reintento no deja fichas sueltas
   ni duplica el envío. Si la cédula o el pasaporte ya existen:
   - ficha activa que la búsqueda muestra: 409 `CLIENT_ALREADY_EXISTS`, buscar y
     seleccionar ese cliente;
   - ficha inactiva: 409 `CLIENT_INACTIVE_EXISTS`, pedir a Administración que la reactive;
   - para un Cobrador, remitente registrado en otra ruta: 409 `CLIENT_OTHER_ROUTE`,
     pedir a Administración que revise su ruta o que otro operador registre el envío;
   - el mismo documento en remitente y destinatario: 422 `SAME_CLIENT`.
   En Administración, «Operador del envío» ofrece solo las cuentas que pueden
   registrar envíos.
5. Tras la respuesta confirmada se ofrece imprimir y se limpian ambos clientes,
   teléfonos, importe, nota, monedas y operador. El formulario continúa abierto
   y vuelve al remitente. Un resultado incierto (sin respuesta o con error del
   servidor) conserva el intento y su misma clave. Dos casos dejan de ser inciertos:
   - Una respuesta correcta que no coincide con lo enviado: la API ya registró el
     envío. La ventana cierra la confirmación, limpia el formulario, recarga el
     listado y avisa con la referencia ENV… para revisarlo antes de registrar otro.
     No ofrece imprimir; el comprobante se imprime desde el detalle del listado.
   - Un reintento rechazado por falta de permiso (403): la ventana se desbloquea,
     avisa de que no se pudo confirmar si el intento anterior quedó registrado y
     recarga el listado. Un 401 conserva el reintento hasta volver a entrar.
6. En los campos de captura, Enter avanza y Shift+Enter retrocede, solo entre
   campos: nunca dejan el cursor en un botón. En un campo de solo lectura, Enter
   continúa desde ese campo. Tab funciona normalmente y sigue alcanzando los
   botones; selectores nativos, selección de clientes y notas multilínea
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
| Supervisor | Códigos de consulta; `view`, `receipts`, `cash.view`, `reports`, `rates.view`, `commissions.view`. Consulta todos los envíos, recibos, cajas y reportes | Igual que el perfil; nunca escribe |
| Cobrador | Sus códigos de terminal; todas las claves salvo `cash.open`, `rates.manage`, `commissions.view` y `commissions.manage`. `clients.create` es el alta rápida durante un envío, solo en su ruta; no incluye el 141 | Igual que el perfil |
| Cajero | Códigos 1 y 2; `view`, `create`, `receipts`, `pay`, `cancel`, `clients.create`, `cash.view`, `cash.open`, `cash.close` | Lo mismo más `remittances.reports` |
| Usuario | Sin acceso | Códigos 1 y 2; todas las claves salvo `cash.open`, `rates.manage` y `commissions.manage` |
| No definido | Sin acceso | Sin acceso |

Ningún rol distinto de Admin puede recibir `remittances.cash.open`, salvo el Cajero
para su propia caja. Una cuenta Usuario con solo recibos abre Pagos de Envíos; con
solo caja, Cuadres Diarios → Caja de envíos; con solo reportes, Reportes.

La misma política gobierna menú, accesos rápidos, panel de administración,
ventanas, acciones y API. Las mutaciones vuelven a leer los permisos dentro de
la transacción, antes incluso de devolver una respuesta idempotente. Se filtran
las proyecciones operativas para no mostrar datos de módulos retirados; un
Cobrador conserva siempre sus propios datos de terminal (ficha, rutas,
movimientos, jornadas y totales). Los reportes de un Usuario o Cajero incluyen sus
operaciones enviadas/pagadas, no toda la cola pendiente que tiene autorización
para entregar.

El permiso 106 permite gestionar perfiles. Crear una cuenta con un rol que
concede acceso inicial (Admin, Supervisor, Cobrador o Cajero) requiere también ese
permiso, evitando una elevación indirecta desde «Agregar usuario». Cambiar el rol
de una cuenta existente requiere el 106 en todos los casos, salvo el paso entre No
definido y Usuario cuando ninguno de los dos tiene acceso. Un administrador no
puede retirarse su propio acceso a la pantalla de permisos (códigos 1, 10, 101 y
106): 409 `OWN_ADMIN_ACCESS`. Guardar permisos no modifica contraseñas ni el rol
de la cuenta objetivo; los permisos se consultan nuevamente con la sesión vigente.
Quien tiene el 106 puede ampliar sus propios permisos dentro de su rol.

Para gestionar otra cuenta (su clave, nombre, usuario de inicio, rol o cobrador,
su estado o sus sesiones) el acceso efectivo de quien lo hace debe incluir todos
los permisos de esa cuenta; si no, 403 `ACCOUNT_MORE_PRIVILEGED`. La cuenta
principal de administración solo la modifica ella misma (403 `ACCOUNT_PROTECTED`).
Con «Perfil del rol», toda cuenta cambia su propia clave; con permisos
personalizados, solo si conserva el código 2.

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
  ni movimientos del libro de cobros. Puede cambiar su propia clave; con permisos
  personalizados, solo si conserva el código 2.

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

Si se omite `mode`, la cuenta conserva su modo actual. En modo `role`, la lista
enviada se guarda como referencia y no tiene efecto; solo `mode: "custom"`
explícito la aplica. Sin `remittancePermissions` se toman las claves del rol si la
cuenta estaba en modo `role`, o las que ya tenía si estaba en `custom`.

`POST /api/usuarios` y `POST /api/usuarios/:id` admiten el rol `cashier`. Errores
de la gestión de cuentas (403, sin cambiar nada):

- `PERMISSION_REQUIRED`: falta el código que pide la acción; por ejemplo, el 106
  para cambiar un rol.
- `ACCOUNT_MORE_PRIVILEGED`: la cuenta objetivo tiene permisos que quien actúa no
  tiene. Se aplica a `POST /api/usuarios/:id` cuando cambian nombre, usuario de
  inicio, rol o cobrador, y a `/clave`, `/estado` y `POST /api/sesiones/:id/cerrar`.
- `ACCOUNT_PROTECTED`: otra cuenta intenta modificar la cuenta principal de
  administración, incluidos sus permisos y sesiones.

`POST /api/envios/cajas/abrir` lo usan Admin, para cualquier operador activo, y
el Cajero con `remittances.cash.open`, solo con `operatorId` igual a su propia
cuenta. Otro operador devuelve 403 `FORBIDDEN` «Solo puedes abrir tu propia caja
de envíos.». Cobrador, Usuario y Supervisor reciben 403.

`POST /api/envios` admite, por cada participante, **exactamente una** alternativa:
`senderClientId` o `newSenderClient`, y `recipientClientId` o `newRecipientClient`.
Cada ficha nueva contiene `name`, `identification`, `phone`, `address`, `routeId`
y `preferredCurrency?`. No acepta códigos, roles, IDs técnicos o saldos digitados.
El documento conserva el requisito de la validación general de clientes; no se
fabrican cédulas cuando falta. Registrar una ficha nueva exige
`remittances.clients.create` y una ruta existente; para un Cobrador, de su propia
ruta (422 `ROUTE_NOT_FOUND`). Los documentos se comparan sin espacios ni guiones
y sin distinguir mayúsculas; los duplicados devuelven `CLIENT_ALREADY_EXISTS`,
`CLIENT_INACTIVE_EXISTS`, `CLIENT_OTHER_ROUTE` o `SAME_CLIENT`, como se explica en
«Uso del flujo». `recipientPhone?` es el teléfono escrito para el destinatario: se
compara por dígitos y, si la ficha nueva del destinatario no trae teléfono, la
ficha guarda ese número. La respuesta incluye los IDs asignados y los contactos
congelados, comprobados antes de ofrecer imprimir.

`GET /api/envios/snapshot` añade `sendingOperatorIds`: los operadores de
`operators` que pueden registrar envíos. Las cuentas de solo consulta reciben en
`clients` únicamente los clientes de sus operaciones visibles.

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
para no bloquear cuentas al actualizar. Mientras la cuenta use **Perfil del rol**,
el diálogo de permisos muestra el perfil del rol, que es lo que se aplica. Si la
lista guardada difiere de ese perfil, encima aparece el grupo «Selección anterior
de permisos» con los códigos y las claves de Envíos guardados y los que quedan
fuera del alcance del rol.
Guardar con **Perfil del rol** conserva esas listas. Para hacerlas efectivas, Administración pulsa **Aplicar selección anterior**:
el diálogo pasa a **Permisos personalizados** con los códigos y las claves de
Envíos que el rol admite (sin claves guardadas, las del perfil del rol), y al
guardar se aplican. Seleccionar otra vez **Perfil del rol** recupera ese perfil y
guarda la selección personalizada, códigos y claves de Envíos, como referencia,
sin editar datos financieros; volver a **Permisos personalizados** sin guardar
muestra otra vez la selección con la que se abrió el diálogo. Para Cajero y
Usuario, cuyo techo de códigos es 1 y 2, las claves de Envíos son casi toda su
personalización: por eso se conservan igual que los códigos. Al cambiar el rol de
una cuenta en **Perfil del rol**, la copia del perfil del rol anterior que guardó
el diálogo se descarta, para que no aparezca como selección anterior; una lista
distinta de ese perfil (por ejemplo, la de la migración 034) se conserva.

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
8. Dar a una cuenta Admin permisos personalizados con solo los códigos 1, 10, 101,
   103, 104 y 107 («Entrar al sistema», Panel de Control, «Visualizar Usuarios»,
   «Modificar usuario», «Inactivar usuario» y «Cambiar Clave de Usuario»). Con
   ella, intentar cambiar la clave o desactivar otra cuenta Admin con acceso
   completo: debe rechazarse con «Esa cuenta tiene permisos que la tuya no tiene»
   y la otra cuenta debe seguir con su sesión abierta. Cambiar su rol debe pedir
   el 106.

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
- Prueba PostgreSQL dedicada en loopback (`user-permissions.test.ts`, con
  `CYP_PERMISSION_TEST_DATABASE_URL`): migraciones 001–034, persistencia al
  reabrir el almacén y rechazo de claves/modos no válidos, sin alterar credenciales.
- **Corrección del 19 de octubre.** Este registro citaba además una prueba
  transaccional con PostgreSQL del alta de dos clientes junto con el envío. Esa
  prueba no está en el repositorio: no se puede repetir y no cuenta como evidencia.
  El alta atómica solo está probada con MemoryStore, en `effective-access.test.ts`
  («new remittance clients and the remittance commit together…» y «a failed cash
  validation rolls back new clients and reservations»). Con MemoryStore el
  rechazo descarta la copia de trabajo, así que esas pruebas no ejercitan el orden
  de guardado de PostgresStore (`clients`, `client_identity_reservations` y
  `remittance_transfers`) ni su ROLLBACK. Ver «Prueba pendiente con PostgreSQL».
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

Ejecución local del 19 de octubre de 2026 con las correcciones de la revisión del
PR 36 (sin publicar): `pnpm check` terminó con código 0. API: **361 aprobadas,
15 omitidas, 0 fallos**; PWA: **12 aprobadas, 0 fallos**; Administración: **256
aprobadas, 0 fallos**. Tipos y compilaciones de los tres paquetes aprobados; la
compilación solo avisa de chunks de más de 500 kB. Incluye las pruebas nuevas
`access-corrections.test.ts` (API), `createdTransferResponse.test.ts`,
`remittance-workspace-corrections-ui.test.ts` y `admin-access-corrections-ui.test.ts`
(Edge). Las 15 omitidas siguen siendo las de PostgreSQL. En un primer intento de
ese día, con el equipo cargado, la prueba «server refuses invalid selected
PostgreSQL…» de `remittances.test.ts` agotó su límite de 15 s al arrancar el
servidor (`spawnSync … ETIMEDOUT`); sola pasó en 9 s, y también pasó en la
repetición completa que dio estos números.

### Prueba pendiente con PostgreSQL

El alta de fichas nuevas junto con el envío no tiene todavía una prueba versionada
con PostgreSQL, y en este equipo no hay un clúster de pruebas para escribirla y
ejecutarla. Para hacerla:

1. Usar un clúster PostgreSQL desechable en loopback, distinto del servicio
   habitual, como el de las demás pruebas (`127.0.0.1:55436`, usuario `qa_cyp`),
   con una base dedicada y vacía para esta prueba.
2. Aplicar las migraciones a esa base:

   ```powershell
   $env:DATABASE_URL = "postgresql://qa_cyp@127.0.0.1:55436/<base de prueba>"
   pnpm db:migrate --apply
   ```

3. Añadir la prueba en `app/server/test/`, omitida sin su propia variable
   `*_TEST_DATABASE_URL` y comprobando el destino exacto, como las demás pruebas
   PostgreSQL. Con un `PostgresStore` sobre esa base debe:
   - abrir la caja del operador y registrar `POST /api/envios` con
     `newSenderClient` y `newRecipientClient`;
   - releer desde un segundo `PostgresStore`: dos clientes, sus dos reservas en
     `client_identity_reservations` y el envío;
   - repetir con la misma `Idempotency-Key`: la misma respuesta y ninguna fila nueva;
   - intentar otro envío con fichas nuevas sin caja abierta: 409 `CASH_NOT_OPEN` y
     ninguna fila nueva en `clients`, `client_identity_reservations` ni
     `remittance_transfers`.
4. Ejecutarla desde `app/server`, con la variable apuntando a esa base:

   ```powershell
   $env:<VARIABLE> = "postgresql://qa_cyp@127.0.0.1:55436/<base de prueba>"
   pnpm exec tsx --test test/<archivo>.test.ts
   ```

Hasta entonces, la atomicidad con PostgreSQL de esta alta no está acreditada.

No se introducen privilegios especiales por GUID, un SuperAdmin nuevo ni edición
de envíos registrados. La reserva exacta de facultades del propietario/soporte
requiere una definición adicional de Gerencia. La impresión física y el GPS
físico no quedan acreditados por estas pruebas de navegador. Estos cambios
locales no constituyen evidencia de publicación en Render.
