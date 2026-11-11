# Envíos de Dinero: contrato local

El flujo de captura continua, el alta transaccional de clientes y la autorización
individual están documentados en [DIONEL-REMESAS-PERMISOS.md](DIONEL-REMESAS-PERMISOS.md).
Esta versión requiere también las migraciones aditivas **034** y **035** (rol
Cajero) y **037–039** (tasas aplicadas, medios de pago y recibos) antes de iniciar el servidor
con PostgreSQL. Tasas y comisiones se
mantienen desde Administración, fuera de la captura de envíos.

La comisión de los envíos nuevos se toma de la configuración central de Admin,
sin edición por operación. Ver [COMISIONES-CONFIGURACION.md](COMISIONES-CONFIGURACION.md)
para contrato y migración aditiva 026. Las referencias inferiores a
`commissionBps` en solicitudes son compatibles solo cuando coinciden con la
tasa registrada; ese campo ya es opcional en cotización y alta.

El contrato vigente de entrada por origen/destino, redondeos y reparto devengado
está en [REMESAS-COTIZACION-REPARTO.md](REMESAS-COTIZACION-REPARTO.md). Requiere la
migración aditiva `024_remittance_commission_allocation.sql` antes de iniciar esta
versión con PostgreSQL. Las referencias a comisión manual describen información
histórica: los envíos nuevos usan el reparto calculado en el servidor.

Todas las rutas requieren sesión. Base `/api`. Todos los POST requieren
`Idempotency-Key` (UUID recomendado; reutilizar al reintentar el mismo payload).
Errores: `{error:{code,message}}`. Importes son centavos enteros no negativos,
con máximo seguro de JavaScript; un principal debe ser positivo. Monedas: DOP,
USD, EUR, todas a dos decimales. Fechas de negocio: America/Santo_Domingo.
Este módulo tiene caja propia y no altera el ledger DOP de cobros/entregas.

### Formatos de captura y validación

- Los importes de captura admiten dígitos y un punto con hasta dos decimales.
  Principal, dinero recibido, efectivo inicial y contado comparten el mismo
  máximo exacto: `90071992547409.91`. La captura rechaza letras, signos,
  exponentes, separadores de miles y valores fuera de rango, tanto al escribir
  como al pegar. Una entrada rechazada debe corregirse antes de confirmar;
  no se confirma silenciosamente el importe anterior.
  La cotización recibe `amount` en centavos como cadena de dígitos ASCII (máximo
  16 y dentro del entero seguro); rechaza signos, exponentes, hexadecimal,
  espacios y decimales. Los POST mantienen importes numéricos enteros en centavos.
- Teléfonos: 8 a 15 dígitos, `+` al inicio y separadores de espacio, guion o
  paréntesis; no letras, puntos ni extensiones. Se permite vacío donde es opcional.
- Cédula/pasaporte de una ficha nueva de remesa: hasta 80 caracteres, con letras,
  números, espacios, guiones, puntos o barras, y al menos una letra o número.
  Se conserva como texto, incluidos sus ceros iniciales.
- El nombre de una ficha nueva debe incluir letras. Conserva Unicode, acentos,
  apóstrofes y puntuación legítima, incluidos números en nombres comerciales.
  Direcciones y notas admiten texto normal; no se bloquean palabras por parecer SQL.
- El pegado se comprueba antes de que `maxLength` pueda recortar un importe,
  teléfono o documento. La API valida de nuevo, incluso al omitir la interfaz.
  Los valores de remesas siguen enviándose a PostgreSQL mediante parámetros,
  nunca concatenados dentro de la sentencia SQL.
- Compra y Venta admiten un decimal positivo de hasta doce dígitos enteros y
  seis decimales. La captura acepta punto o coma decimal y envía punto a la API;
  no convierte exponentes ni recorta precisión. Fecha y DOP=1 siguen bloqueados.
- Referencias de pago/devolución y banco/proveedor son texto alfanumérico de
  hasta 160 caracteres: conservan ceros iniciales, espacios y puntuación.
  La interfaz y la API rechazan controles, saltos de línea y marcas invisibles
  antes de normalizar el texto. No se solicitan datos completos de tarjetas.
- Las búsquedas admiten texto mixto de hasta 160 caracteres en una sola línea;
  no se restringen a números porque también localizan nombres y referencias.

Matriz por campo y comprobaciones de este ajuste:
[REMESAS-VALIDACION-CAMPOS.md](REMESAS-VALIDACION-CAMPOS.md).

## Tipos compartidos

Versión resumida. Los tipos completos que usan la interfaz y la terminal están en
`app/shared/remittances/types.ts`.

```ts
type Currency = 'DOP' | 'USD' | 'EUR';
type Quote = { date: string; sourceRate: string; destinationRate: string;
  quotedAt?: string; sourceRateChangeId?: string; destinationRateChangeId?: string;
  sourceRateChangedAt?: string; destinationRateChangedAt?: string;
  sourceRateDate?: string; destinationRateDate?: string;
  sourceRateKind?: 'base'|'purchase'|'sale'|'operative';
  destinationRateKind?: 'base'|'purchase'|'sale'|'operative';
  commissionPolicyRevision?: string; managerCommissionBps?: number };
type Rate = { id: string; currency: Currency; rate: string; date: string;
  purchaseRate?: string; saleRate?: string; changeId?: string; updatedAt?: string;
  updatedBy?: string /* solo para Admin */ };
type RateChange = { id: string; currency: Currency; rate: string; date: string;
  purchaseRate?: string; saleRate?: string; createdAt: string; actorId: string };
type Contact = { id: string; code: string; name: string; phone: string;
  cellular: string; address: string; identification?: string };
type Transfer = {
  id: string; sequence: number; envioReference: string; reciboReference: string;
  operatingCode: string; senderClientId: string; recipientClientId: string;
  sendingUserId: string; registeredBy: string;
  sourceCurrency: Currency; destinationCurrency: Currency;
  amount: number; commissionBps: number; commissionAmount: number;
  totalAmount: number; receiveAmount: number; quote: Quote; note: string;
  status: 'pending' | 'paid' | 'cancelled'; createdAt: string;
  paidAt?: string; paidBy?: string; cancelledAt?: string; cancelledBy?: string;
  cancelReason?: string;
  // Copias congeladas al registrar; el comprobante y el listado las usan primero.
  senderContact?: Contact; recipientContact?: Contact;
  amountDop?: number; requestedReceiveAmount?: number; receiveRoundingDifference?: number;
  commissionAllocation?: CommissionAllocation; // ver REMESAS-COTIZACION-REPARTO.md
  managerCommission?: { managerName: string; amount: number; currency: Currency };
  payment?: {version:1;method:'cash'|'card'|'transfer'|'deposit';tenderedAmount:number;
    changeAmount:number;reference?:string;bank?:string;confirmedBy:string;confirmedAt:string};
  receiptIssuer?: {name:string;address:string;phone:string;email:string;footerNote:string;logoDataUrl?:string};
  refund?: {method:'card'|'transfer'|'deposit';reference:string;confirmedBy:string;confirmedAt:string};
};
type TransferView = Transfer & {canPay: boolean; canCancel: boolean};
type CashSession = {
  id: string; operatorId: string; currency: Currency; date: string;
  openingAmount: number; openedBy: string; openedAt: string;
  status: 'open' | 'closed'; closedBy?: string; closedAt?: string;
  countedAmount?: number;
};
type CashView = CashSession & {
  sentTotal: number; cancelRefund: number; paid: number;
  expected: number; canClose: boolean;
};
type Snapshot = {
  businessDate: string; currencies: Currency[];
  access: {mode:'role'|'custom'; revision:number; legacy:number[]; remittances:string[]};
  commissionPolicy: {revision:string; transactionCommissionBps:number;
    managerCommissionBps:number; updatedAt?:string; updatedBy?:string};
  receiptFooterNote: string;
  clients: {id:string; code:string; name:string; routeId:string; active:boolean;
    preferredCurrency:Currency; canSendFrom:boolean; canReceive:boolean}[];
  clientRoutes: {id:string; name:string}[]; // rutas para el alta rápida
  operators: {id:string; name:string; role:'admin'|'collector'|'user'|'cashier'; collectorId?:string}[];
  sendingOperatorIds: string[]; // operadores que pueden registrar envíos
  rates: Rate[]; rateHistory: RateChange[]; // historial solo para Admin con rates.view
  transfers: TransferView[]; cashSessions: CashView[];
};
```

La tasa es DOP por unidad de moneda, string decimal con seis posiciones; DOP
siempre vale `1.000000`. Para cada moneda se usa la última tasa registrada con
fecha menor o igual a la fecha de negocio: sigue vigente si hoy no se ha registrado
otra. Nunca se usa una tasa futura ni se inventa una tasa de USD/EUR cuando no
hay registros. La fecha de cotización (`quote.date`) es la de la operación;
`sourceRateDate` y `destinationRateDate` conservan las fechas reales de las tasas
aplicadas. Las fechas de tasas históricas desconocidas permanecen ausentes.
Desde 039, `sourceRateKind` / `destinationRateKind` identifican `purchase`, `sale`,
`base` o `operative`. Se compra la moneda de origen y se vende la de destino;
si son iguales no se aplica un doble cambio (ambos usan la misma referencia).
Sin pareja compra/venta en un registro antiguo, `operative` conserva su valor
único, identificado como tal. Los envíos aceptados nunca se recalculan al cambiar
la tasa. La pantalla nueva registra Compra/Venta; el campo compatible `rate`
se envía con Compra y sigue disponible para consumidores anteriores.
Comisión: BPS enteros 0..10000 (100 BPS=1%).
Remitente paga `amount + commissionAmount` en origen. Destinatario recibe
`round_half_up(amount * sourceRate / destinationRate)` en destino; la comisión
no se descuenta de su principal. Para repartirla entre empresa y gestor, la
comisión cobrada en origen se expresa también en destino. El backend usa BigInt para
intermedios y rechaza resultados fuera del rango seguro.

## Permisos por ruta

Cada ruta exige las claves `remittances.*` del acceso efectivo de la cuenta
(fuente: `app/server/src/access.ts`). Si falta una, la respuesta es 403
`PERMISSION_REQUIRED` en permisos personalizados y 403 `FORBIDDEN` con el perfil
del rol. Con permisos personalizados, sin el código 1 la respuesta es 403
`ACCESS_REVOKED`.

| Ruta | Claves |
| --- | --- |
| `GET /envios/snapshot` | Una de `view`, `receipts`, `cash.view`, `reports`, `rates.view` o `commissions.view` |
| `GET /envios/clientes/buscar`, `GET /envios/clientes/:id/contacto` | `create` o `receipts` |
| `GET /envios/cotizacion` | `create` y `view` |
| `GET /envios` | `view` |
| `POST /envios` | `create` y `view`; cada ficha nueva, además `clients.create` |
| `GET /envios/recibos` | `receipts` |
| `POST /envios/:id/pagar` | `pay` y `receipts` |
| `POST /envios/:id/cancelar` | `cancel` y `view` |
| `POST /envios/cajas/abrir` | `cash.open` y `cash.view`; rol Admin, o Cajero para su propia caja |
| `POST /envios/cajas/:id/cerrar` | `cash.close` y `cash.view` |
| `GET /envios/reportes`, `GET /envios/reportes/comisiones` | `reports` |
| `POST /envios/tasas` | `rates.manage`, `rates.view` y el código 201; rol Admin |
| `POST /envios/politica-comisiones` | `commissions.manage` y `commissions.view`; rol Admin |

Visibilidad de las operaciones, igual en `snapshot`, listados y reportes:

- Admin y Supervisor ven todas. Supervisor no tiene claves para pagar, cancelar
  ni cerrar, así que sus `canPay`, `canCancel` y `canClose` llegan en falso.
- Cobrador: los envíos que realizó o cuyo remitente es de su ruta, y los recibos
  cuyo destinatario es de su ruta.
- Usuario y Cajero: los envíos que realizaron, todos los recibos pendientes y los
  que ellos pagaron. Sus reportes incluyen solo lo que enviaron o pagaron.
- Cajas: Admin y Supervisor, todas; los demás, solo las propias.

## Consultas, tasas y alta

- `GET /envios/snapshot` → `Snapshot`. Clientes mínimos sirven para seleccionar
  destinatario; solo `canSendFrom` habilita remitente. Con `create` o `receipts`,
  `clients` trae el catálogo completo en esa forma mínima, sin teléfonos ni
  direcciones. Con solo `view`, trae únicamente los clientes de las operaciones
  visibles, para mostrar sus nombres. Sin esas claves llega vacío. Usuario y
  Cajero con acceso de envíos atienden a cualquier cliente (`canSendFrom` y
  `canReceive` verdaderos). `clientRoutes` lista las rutas donde la cuenta puede
  dar de alta clientes (un Cobrador, solo las suyas; vacía sin `clients.create`).
  `operators` del Admin incluye las cuentas activas que pueden operar: Admin,
  Cobrador, y Usuario o Cajero con acceso de envíos. Los demás reciben solo su
  propia cuenta, y Supervisor ninguna. `sendingOperatorIds` es la parte de
  `operators` que tiene `remittances.create`: solo esas cuentas son válidas como
  operador del envío. Las demás siguen en `operators` porque Admin puede abrirles
  la caja para pagar recibos. `operatorNames` (`{id: nombre}`) nombra a todos los
  operadores que aparecen en lo que la cuenta ve: operador, registro, pago y
  cancelación de sus envíos y recibos, sus cajas y, con `remittances.reports`, las
  filas de sus reportes, también de cuentas desactivadas. Solo lleva id y nombre,
  sin rol ni acceso, y no los ofrece como operadores elegibles. Así el detalle, el
  comprobante impreso, las cajas y los reportes muestran nombres, nunca un id.
- `GET /envios/clientes/buscar?query=...&side=sender|recipient&senderId=...`
  → `{ids: string[], hasMore: boolean}`, hasta 100 IDs de clientes activos que
  coinciden por código, nombre o identificación, o por al menos 3 dígitos de su
  código o sus teléfonos. Para un remitente de Cobrador, solo clientes de su ruta; el
  destinatario puede ser de otra ruta y no puede ser `senderId`. No devuelve datos
  de contacto.
- `GET /envios/clientes/:id/contacto?side=sender|recipient&senderId=...`
  devuelve `{id,code,name,phone,cellular,address,identification?}` del cliente
  seleccionado. Requiere cliente activo (`CLIENT_INACTIVE` 409) y, para remitentes
  de Cobrador, ruta propia (`FORBIDDEN` 403). El destinatario puede pertenecer a
  otra ruta, pero debe ser distinto de `senderId` (`SAME_CLIENT` 422). No devuelve
  notas ni un índice global de contactos. Formulario y confirmación muestran estos
  datos actuales; el POST captura la copia definitiva en servidor y el comprobante
  usa los contactos guardados.
- `GET /envios` → `TransferView[]` de envíos visibles (ver «Permisos por ruta»).
- `GET /envios/recibos` → `TransferView[]` de recibos visibles.
- `POST /envios/tasas`: `{currency,rate:string,date:'YYYY-MM-DD',purchaseRate?,saleRate?}`
  → `Rate`. Solo fecha de negocio actual (`RATE_DATE`); DOP solo admite 1
  (`DOP_RATE`). Compra y venta van juntas (`RATE_PAIR_REQUIRED`). Los envíos
  previos retienen su tasa.
- `POST /envios/politica-comisiones`:
  `{transactionCommissionBps?,managerCommissionBps}` → configuración central.
  Cada porcentaje es un entero 0..10000; gestor no puede superar transacción
  (`COMMISSION_EXCEEDS_TOTAL`). Cambios afectan solo envíos futuros y requieren
  recotizar antes de registrar. Desde el 29-10-2026 también acepta `managerShareBps`
  (parte del gestor dentro de la comisión, 0..10000) y `receiveRounding` (`none|normal|up`); un
  `managerCommissionBps` antiguo se convierte a esa parte. Ver [CALCULO-ENVIOS.md](CALCULO-ENVIOS.md).
- `POST /envios/conceptos-entrega` (solo Administración): `{id?,name,commissionBps,active}` → concepto
  de comisión de entrega en destino. «Sin comisión» está reservado (`CONCEPT_RESERVED`); nombres únicos
  (`CONCEPT_EXISTS`); porcentaje 0..9999 (`INVALID_CONCEPT`).
- `GET /envios/cotizacion?sourceCurrency=USD&destinationCurrency=DOP&amount=10000&amountMode=source|total|destination&deliveryConceptId=…`
  → `{sourceCurrency,destinationCurrency,amount,commissionBps,commissionAmount,totalAmount,receiveAmount,quote,...}`.
  `amountMode=total` cotiza desde el total que paga quien envía y `destination` desde lo que recibe la
  persona; `calculation` trae la comisión de entrega, el redondeo, lo que recibe y la ganancia por cambio; ver
  [REMESAS-COTIZACION-REPARTO.md](REMESAS-COTIZACION-REPARTO.md).
  **Comisión de entrega (%)** es de solo lectura en la captura. Administración configura el porcentaje
  central mediante `POST /envios/politica-comisiones`, campo `deliveryCommissionBps` (entero 0..9999;
  550 significa 5.50%). Empieza en 0: la migración 046 no copia porcentajes de prueba de conceptos antiguos.
  El servidor toma este valor aunque el cliente omita el campo. Los parámetros anteriores de porcentaje o
  concepto sirven únicamente como comprobación de compatibilidad: si difieren de la configuración se rechazan
  con `COMMISSION_POLICY_MISMATCH` 409. El catálogo anterior se conserva para compatibilidad e históricos;
  la pantalla de configuración reúne ahora los porcentajes centrales, sin un segundo formulario de entrega.
  Se descuenta del monto convertido en destino antes del redondeo. DOP 100.00 con 10% entrega DOP 90.00;
  pedir DOP 90.00 netos requiere DOP 100.00 de principal. Cambiar la configuración exige volver a cotizar.
  No se modifican las operaciones históricas.
  La captura y el desglose muestran además el **equivalente de la comisión normal en DOP**. Se convierte
  la comisión ya calculada con `quote.sourceRate`, usando enteros y redondeo a centavos, sin tomar una tasa
  posterior ni alterar importes. Es informativo: el cobro y la caja conservan la moneda de origen; no registra
  pagos mezclados en dos monedas. Ejemplo: USD 100 + USD 5 de comisión = USD 105; a 59, la comisión equivale
  a DOP 295.00. Los importes fuera del rango seguro se muestran como no disponibles.
- `POST /envios`:
  `{senderClientId | newSenderClient, recipientClientId | newRecipientClient, sendingUserId?, recipientPhone?, sourceCurrency, destinationCurrency, amount, requestedReceiveAmount? | requestedTotalAmount?, deliveryConceptId? | deliveryCommissionBps?, commissionBps?, managerCommission?, quote, note?, payment?}`
  → `TransferView`, con `senderContact`, `recipientContact`, `payment` y
  `receiptIssuer` congelados. Ver [REMESAS-PAGOS-RECIBOS.md](REMESAS-PAGOS-RECIBOS.md).
  - Por cada participante va **exactamente una** alternativa: el ID de un cliente
    existente o una ficha nueva `{name, identification, phone, address, routeId,
    preferredCurrency?}`. Las dos o ninguna devuelve 400 `VALIDATION`.
  - `quote` debe ser exactamente la cotización recibida. Cambio de
    fecha/tasa/configuración devuelve `QUOTE_CHANGED` 409. Si `commissionBps`
    viene presente, se valida contra la tasa central y no puede reemplazarla.
    La comisión de entrega se toma de la configuración central y se compara con la cotización revisada.
    Los clientes nuevos omiten el porcentaje en el cuerpo de creación; enviarlo no permite reemplazarlo.
    El porcentaje y el descuento quedan congelados en `calculation` para recibos, pagos y reportes.
  - `sendingUserId` omitido usa el usuario autenticado; solo Admin puede
    representar a otro operador activo, y ese operador debe tener
    `remittances.create` (`OPERATOR_FORBIDDEN` 403). `registeredBy` siempre es el
    autenticado.
  - Los clientes deben ser distintos (`SAME_CLIENT` 422), existir
    (`CLIENT_NOT_FOUND` 404) y estar activos (`CLIENT_INACTIVE` 409). El remitente
    debe pertenecer a la ruta del operador si este es Cobrador (`FORBIDDEN` 403);
    Usuario y Cajero pueden usar cualquier cliente.
  - Una ficha nueva exige `remittances.clients.create` y una ruta existente; para
    un Cobrador, de su propia ruta (`ROUTE_NOT_FOUND` 422). Usuario y Cajero dan de
    alta en cualquier ruta. La cédula o el pasaporte se comparan sin espacios ni
    guiones y sin distinguir mayúsculas. Si ya existen: `SAME_CLIENT` 422 (es el
    otro participante), `CLIENT_INACTIVE_EXISTS` 409 (ficha inactiva: pedir a
    Administración que la reactive), `CLIENT_OTHER_ROUTE` 409 (Cobrador, remitente
    de otra ruta) o `CLIENT_ALREADY_EXISTS` 409 (buscar y seleccionar la ficha).
  - `recipientPhone` es el teléfono escrito para el destinatario y se compara por
    dígitos: con los mismos dígitos que la ficha no cambia nada. Si coincide con el
    celular de la ficha, pasa primero en la copia. Si es otro número, va primero en
    la copia y el anterior queda como celular cuando ese hueco está libre. Solo
    Admin completa el teléfono vacío de una ficha existente. Una ficha nueva de
    destinatario sin teléfono propio guarda `recipientPhone`.
  - Necesita caja abierta del operador en moneda origen y fecha actual
    (`CASH_NOT_OPEN` 409). Las fichas nuevas y el envío se guardan en una sola
    transacción: cualquier rechazo, incluida la caja, no deja clientes ni reservas
    de código.

Al confirmar el alta, la interfaz valida la respuesta persistida y pregunta
«¿Quieres imprimir el recibo?». Imprimir reutiliza el mismo comprobante del
detalle, con los contactos y tasas guardados; No imprimir solo cierra la pregunta.
La interfaz solo envía `recipientPhone` cuando sus dígitos difieren de los de la
ficha. Una respuesta incierta (sin respuesta o con error del servidor) conserva
el formulario y la clave para reintentar, sin ofrecer impresión hasta confirmar
el resultado. Dos casos se tratan como definitivos:

- Una respuesta 200 que no coincide con lo enviado: el envío ya quedó registrado y
  un reintento con la misma clave repetiría esa respuesta. La ventana cierra la
  confirmación, limpia el formulario, recarga el listado y muestra la referencia
  ENV… para revisarlo; no ofrece imprimir.
- Un reintento rechazado con 403 (permiso retirado): la ventana se desbloquea,
  avisa de que no se pudo confirmar si el intento anterior quedó registrado y
  recarga el listado. Un 401 conserva el reintento hasta volver a iniciar sesión.

Un error al actualizar el listado no pierde el comprobante confirmado. Si se
bloquea la ventana de impresión, la pregunta conserva el recibo y muestra el aviso
para volver a imprimir, sin otro POST.

## Pago y cancelación

- `POST /envios/:id/pagar` con `{}` → `TransferView`. Pago único y completo,
  solo pendiente, con `remittances.pay` y `remittances.receipts`: Admin, el
  Cobrador de la ruta destino, o un Usuario o Cajero (cualquier recibo pendiente).
  Supervisor no paga. Un recibo fuera del alcance de la cuenta devuelve
  `TRANSFER_NOT_FOUND` 404 o `FORBIDDEN` 403. Usa la caja abierta del usuario
  autenticado en moneda destino y fecha actual (`CASH_NOT_OPEN` 409); requiere
  saldo suficiente (`INSUFFICIENT_CASH` 409).
- `POST /envios/:id/cancelar` con `{reason:string,refund?:{reference:string,verified:true}}` (motivo 1..500) → `TransferView`.
  Solo pendiente, con `remittances.cancel` y `remittances.view`; Admin o el
  operador `sendingUserId` (otro operador: `FORBIDDEN` 403). Devuelve principal
  más comisión contra la caja actual abierta de `sendingUserId` en moneda origen,
  con saldo suficiente para efectivo. Si se pagó por tarjeta/banco, exige una
  devolución externa comprobada (`refund`) y no retira efectivo. No ejecuta el
  reembolso bancario. No modifica una caja cerrada ni el día del envío original.

En Administración el pago se registra en Envíos → Pagos de Envíos («Registrar
pago completo») y la cancelación en el detalle de Envíos → Envíos de Dinero. La
terminal del cobrador conserva ambas acciones en el detalle del envío.

Estados terminales no admiten otra operación. Un reintento con misma clave vuelve
a la respuesta anterior; otra clave sobre un terminal produce `TRANSFER_NOT_PENDING`.
Referencias ENV######## y REC######## son correlativas únicas y no se reutilizan.
El código operativo aleatorio es referencia, nunca permiso de acceso.

## Caja

- `POST /envios/cajas/abrir` admin, o Cajero para su propia caja:
  `{operatorId,currency,openingAmount}` → `CashView`. Requiere
  `remittances.cash.open`. Admin abre la de cualquier operador activo; el Cajero
  solo con `operatorId` igual a su propia cuenta, y otro operador devuelve 403
  `FORBIDDEN` «Solo puedes abrir tu propia caja de envíos.». Cobrador, Usuario y
  Supervisor reciben 403. Fecha actual asignada por servidor; operador activo;
  apertura >=0; una caja por operador/moneda/día (`CASH_EXISTS` 409). Debe estar
  cerrada cualquier caja anterior de ese operador y moneda (`PREVIOUS_CASH_OPEN` 409).
- `POST /envios/cajas/:id/cerrar` self/admin, con `remittances.cash.close` y
  `remittances.cash.view`: `{countedAmount}` → `CashView`. La caja de otro
  operador solo la cierra Admin (`FORBIDDEN` 403). Solo abierta (`CASH_CLOSED`
  409); el contado debe igualar el esperado (`CASH_UNBALANCED` 409). Cerrada
  bloquea movimientos. Puede cerrarse una caja anterior antes de abrir hoy.

En la interfaz administrativa: Reportes & Monitoreo → Cuadres Diarios → Caja de
envíos → «Abrir caja del …» → operador (Admin lo elige; el Cajero ve su propio
nombre, sin selector) → moneda → efectivo inicial → Revisar apertura → Confirmar.
Con `remittances.cash.view`, las ventanas Envíos de Dinero y Pagos de Envíos
avisan cuando falta la caja de hoy del operador y ofrecen «Ir a Caja de envíos»,
que abre el formulario con el operador y la moneda del aviso y lleva allí el teclado.
La fecha viene del servidor; 0 es válido si la caja comienza sin efectivo.
Una caja ya cerrada en la fecha actual no puede reabrirse: el aviso dice que la
caja de hoy ya se cerró, sin «Ir a Caja de envíos», y el formulario de apertura no
deja revisar esa apertura. Para entregar un
recibo se requiere caja abierta del usuario que paga en la moneda de destino,
con fondos suficientes; no se usa la caja de cobros ni se mezclan monedas.

`expected = openingAmount + added + sentTotal - cancelRefund - paid - withdrawn` por caja/moneda.

### Dinero adicional y retiros durante la jornada (05-11-2026)

En **Cuadres Diarios → Caja de remesas**, el panel superior de apertura y movimientos conserva los
selectores **Operador** y **Moneda** aunque la caja ya esté abierta. Para las cuentas no administrativas,
el operador queda fijado a la propia cuenta. Los campos **Dinero adicional recibido** y **Dinero retirado**
operan únicamente sobre la caja abierta de hoy que coincida exactamente con esa selección, con los
permisos existentes. Se muestran allí sus acumulados y su efectivo esperado. Cambiar la selección
limpia los importes sin confirmar y alinea la consulta con la caja elegida; una caja inexistente, de otra
fecha o cerrada no recibe movimientos. Cada confirmación registra un movimiento nuevo; los acumulados
y el saldo inicial ya registrado no se editan. Los importes de la API son enteros en centavos.

- `POST /envios/cajas/:id/entregas`: `{amount, note?}`, entrega física adicional a la caja. Requiere
  `cash.open` y `cash.view`; Administración puede operar cualquier caja y las demás cuentas solo la propia.
- `POST /envios/cajas/:id/retiros`: `{amount, note}`, devolución física de efectivo al encargado sin
  cerrar la caja. Requiere `cash.close` y `cash.view`, con la misma restricción de propiedad que el cierre.
  `amount` debe ser un entero positivo, `note` debe identificar a quién se entrega y el motivo (1–500 caracteres).
  Solo se admite la caja abierta de hoy; un retiro superior al esperado devuelve `INSUFFICIENT_CASH` (409).
- Ambos usan la idempotencia y la transacción existentes: repetir la misma clave no registra otro
  movimiento, y dos retiros simultáneos no pueden gastar el mismo saldo.
- `CashView.withdrawn` acumula los retiros durante el día. `movements` muestra los movimientos de
  la caja visible con `id`, `type`, `amount`, `note?`, `actorId` y `createdAt`. Los nombres se resuelven
  mediante `operatorNames`, solo para cajas que la cuenta puede consultar. El historial es inmutable.
- El contado al cierre es el efectivo **que queda después** de esos retiros. El campo opcional
  `dischargedAmount` conserva su significado anterior: dinero adicional que se retira **después del
  conteo**, al cerrar. `carry = countedAmount - dischargedAmount`; `withdrawn` no se resta otra vez.
  El cierre exige diferencia cero y conserva el bloqueo de cajas cerradas y la apertura heredada.
- El reporte de caja, su CSV y su impresión incluyen los acumulados de retiros durante el día,
  lo retirado al cierre y el último saldo que conserva el operador. Los saldos finales de varios
  días no se suman entre sí.

Ejemplo sin otros movimientos: inicial 50,000 + adicional 2,000 − pagos 46,000 − retiro 4,000 =
esperado/contado 2,000. Si al cerrar devuelve otros 500, la siguiente apertura trae 1,500.
La migración aditiva `050_remittance_cash_withdrawals.sql` habilita el tipo `withdrawal` y conserva
intactos los movimientos `addition` y `discharge` anteriores.
No se cruzan fondos con cobros ni se suman monedas. Cada apertura, envío, pago,
cancelación y cierre deja evento append-only con actor e instante.

## Reportes

`GET /envios/reportes?from=YYYY-MM-DD&to=YYYY-MM-DD&grouping=range|day`
→
```ts
{
  from:string; to:string; grouping:'range'|'day';
  amounts: {date:string; sourceCurrency:Currency; destinationCurrency:Currency;
    count:number; pendingCount:number; paidCount:number; cancelledCount:number;
    amount:number; commissionAmount:number; cardSurchargeAmount?:number; totalAmount:number; receiveAmount:number}[];
  deliveryTimes: {id:string; envioReference:string; createdAt:string; paidAt:string;
    elapsedSeconds:number}[];
  deliveryTimeSummary: {date:string;count:number;minSeconds:number;maxSeconds:number;averageSeconds:number}[];
  delivered: {date:string; currency:Currency; count:number; amount:number}[];
  cash: CashView[];
  cashSummary: {operatorId:string;currency:Currency;date:string;sessionCount:number;
    sentTotal:number;cancelRefund:number;paid:number;firstOpening:number;lastExpected:number}[];
}
```

Rango inclusivo. `date` de agregado es día o `from/to` cuando grouping=range.
Montos filtran por fecha de emisión, excluyen cancelados de sumas monetarias y
mantienen sus conteos. Tiempos y entregados filtran por fecha de pago.
Reportes respetan visibilidad del usuario; caja filtrada por fecha de sesión.
Admin y Supervisor reciben todas las operaciones y cajas; el Cobrador, las de su
ruta y las que realizó, y solo sus propias cajas. Usuario y Cajero solo reciben
los envíos que realizaron o pagaron y sus propias cajas. En Administración se
consultan en Reportes & Monitoreo → Reportes, grupo
«-- Envíos de Dinero --», con `remittances.reports`.
Los agregados de montos conservan pares origen/destino y entregados conserva
moneda destino; nunca hay un total que mezcle monedas.
`deliveryTimeSummary` agrupa por fecha de pago o rango y conserva mínimo, máximo
y promedio de segundos. `cashSummary` agrupa por operador, moneda y día/rango;
acumula únicamente flujos, conserva la primera apertura y el último saldo esperado
sin sumar saldos de días diferentes. `deliveryTimes` y `cash` conservan el detalle.

## Actividad de clientes

`POST /clientes/:id/actividad` rol Admin, con los códigos 140 y 143,
`{active:boolean}` → cliente actualizado.
Clientes antiguos y nuevos parten con active=true. Inactivar impide nuevos envíos;
no borra historial ni bloquea pago/cancelación de un envío existente.
GPS se mantiene mediante el contrato existente `POST /clientes/:id`.

## Persistencia y alcance

### Registro externo de tarjetas (migración 047)

CyP **registra un pago ya recibido y comprobado fuera del sistema**. No realiza
cargos, no autoriza tarjetas, no comprueba fondos ni ejecuta devoluciones bancarias.
El operador debe contar con el comprobante antes de marcar que verificó el pago.

- En `Comisiones de remesas`, `Recargo por tarjeta de crédito (%)` configura
  `creditCardCommissionBps` (0–10000 puntos básicos; inicialmente 0). Requiere
  `remittances.commissions.manage` y los controles de rol existentes. No cambia
  operaciones anteriores. El cambio de revisión invalida cotizaciones anteriores.
- Crédito y débito: `payment` admite `method:"card"`, `cardType:"credit"|"debit"`, `cardholderName`
  (1–120 caracteres), `last4` (exactamente cuatro dígitos ASCII), `reference`,
  `bank` opcional y `verified:true`. Ambos formularios piden titular y número;
  no solicitan vencimiento ni CVV. Débito no lleva el recargo de crédito. Los
  clientes anteriores pueden seguir enviando débito sin titular ni últimos dígitos;
  si se aporta alguno, ambos deben ser válidos. La migración aditiva 051 actualiza
  la validación SQL sin modificar los pagos existentes.
- En pantalla se digitan 16 dígitos, agrupados de cuatro en cuatro. El número
  completo existe únicamente en el control sin nombre mientras se edita: no se
  incorpora al estado React del pago, borradores ni almacenamiento web. Si el
  archivo cifrado está habilitado, se envía exclusivamente dentro de su sobre cifrado.
  Permanece visible al pasar a otros campos para revisarlo antes de guardar.
  Al ocultar la página o bloquear el guardado se sustituye por
  los últimos cuatro enmascarados; una entrada incompleta se borra al salir del campo. Al desmontar
  el control se limpia su valor. Para corregir un número ya oculto hay que
  digitarlo de nuevo. No se intenta recuperar los otros doce dígitos.
- **El objeto `payment` de la API y de la base de datos admite solo `last4`**; sus listas
  estrictas rechazan PAN completo, vencimiento y CVV. El número completo solo
  se escribe en su control temporal; esos datos no deben ir en referencias,
  nombres, notas ni otros campos. No se solicita CVV para registrar un pago
  externo ya recibido. El archivo cifrado opcional acepta solo el número para
  nuevas capturas; conserva compatibilidad con los sobres históricos que incluían
  vencimiento. El CVV se rechaza también dentro del sobre cifrado. Esta protección
  no acredita una certificación PCI.
- Banco/proveedor se elige de una lista inicial de entidades dominicanas en
  Administración y la PWA; los valores de registros anteriores se conservan.
  El servidor mantiene su contrato de texto validado para compatibilidad.
- La cotización congela `quote.creditCardCommissionBps`. El recargo se calcula
  sobre el subtotal `principal + cargo del envío`, con redondeo de medio centavo
  hacia arriba usando aritmética entera. No se calcula sobre sí mismo, no afecta
  al destinatario, no entra en el reparto del gestor y no representa efectivo.
- `totalAmount` conserva el subtotal existente. El pago versión 2 guarda
  `cardSurchargeBps`, `cardSurchargeAmount` y `tenderedAmount = totalAmount +
  cardSurchargeAmount`, sin cambio. `totalPaidForTransfer` obtiene el total real.
  La confirmación y el recibo muestran el recargo en dinero y la tarjeta como
  `•••• 0042`; el recibo no expone el nombre del titular ni el porcentaje.
- El listado y el reporte de montos incluyen el total real, con columna separada
  del recargo. Las exportaciones e impresiones usan esos mismos datos. Los envíos
  cancelados quedan fuera de las sumas; la cancelación exige comprobar la
  devolución externa completa, incluido el recargo, sin retirar efectivo de caja.
- Los pagos históricos versión 1 se conservan intactos. No se inventa si eran
  crédito o débito. Con recargo activo, un registro nuevo sin tipo se rechaza.

Ejemplo ficticio: principal DOP 100.00 + cargo de envío DOP 10.00 = subtotal
DOP 110.00. Con crédito al 2.5%, recargo DOP 2.75, total DOP 112.75. Con débito,
total DOP 110.00. El importe del destinatario conserva su cálculo original.

Aplicación local: `pnpm db:migrate --apply`, con la base local correcta configurada.
La migración es aditiva; no modifica porcentajes comerciales existentes ni añade
recargos a pagos anteriores. Las pruebas usan datos ficticios y una base aislada;
no acreditan un cobro bancario real ni una certificación PCI.

Migración aditiva 012: `clients.active`, tasas en la tabla existente `exchange_rates`,
`remittance_transfers`, `remittance_cash_sessions`, `remittance_events`.
Referencias y ledger se conservan tras reinicios. Idempotencia usa el store común.
No se integra Western Union, netbanking ni bancos. No se aplican migraciones a
la base de operación como parte de la preparación local.


## Cierre de la revisión de Mayo (04-11-2026)

- El cargo de entrega en captura/confirmación muestra el importe descontado, sin su porcentaje. La configuración administrativa conserva el porcentaje.
- Un cierre anterior distinto de cero fija la siguiente apertura para todas las cuentas, incluso con permiso de cambiar la apertura. Un cierre cero mantiene el control de permiso existente; la primera apertura permite indicar su efectivo. La API aplica la misma regla, sin modificar cajas históricas ni requerir migración.
- En la confirmación y en el detalle del envío hay papel normal, térmico de tres pulgadas (76 mm), 80 mm y 58 mm, y un recibo resumido para envío telefónico. La impresión aislada usa los mismos importes guardados; el resumen conserva referencia, fecha, nombres, teléfonos, pago, totales y pie de empresa. El tamaño físico también se selecciona en el diálogo de la impresora. Una prueba del navegador no acredita impresión física.
- El titular admite letras Unicode, marcas de acento, espacios, guiones, apóstrofes y puntos, sin números, con al menos una letra y máximo 120 caracteres. Se valida en pantalla y en la API; no modifica fichas de clientes ni titulares históricos.
- Actualización del 06-11-2026: se retiran los controles temporales de vencimiento y CVV. Crédito y débito muestran banco/proveedor primero, titular y número de 16 dígitos después y referencia del comprobante al final. Cambiar entre crédito y débito destruye el control anterior y limpia sus datos sin conservar el número completo.
- El objeto `payment` sigue rechazando PAN completo, vencimiento y CVV. Conserva titular y últimos cuatro dígitos para ambos tipos. El archivo opcional, habilitado solo con su clave y plazo de conservación configurados, cifra el número sin pedir vencimiento; los sobres anteriores continúan siendo legibles. No se almacena CVV. Esta pantalla registra un pago externo, no procesa un cobro ni acredita certificación PCI.

## Detalle de movimientos de caja y formatos de recibo (06-11-2026)

- `GET /api/envios/cajas/:id/movimientos` consulta una caja existente sin modificarla. Requiere
  `remittances.cash.view`: Administración y Supervisión conservan el alcance de consulta de cajas;
  las demás cuentas solo consultan las propias. Una caja ajena o inexistente devuelve 404. El
  permiso de caja no devuelve contactos, tarjetas, archivos cifrados ni repartos de comisiones.
- La respuesta contiene `cash` (operador, moneda, fecha, apertura y cierre), `entries` (cada movimiento
  con fecha/hora, tipo, entrada/salida de efectivo, referencias, usuario y nota), `groups` (cantidad
  y total por tipo) y `totals` (los saldos contables originales). El detalle se construye del libro
  de eventos y movimientos ya guardado, incluso para cajas cerradas; no se deduce del estado actual
  de una remesa ni se reconstruyen movimientos históricos inexistentes.
- Se incluyen cada entrega adicional, retiro durante el día, ingreso por envío, devolución,
  pago al destinatario y retiro al cierre. Un envío cancelado mantiene su ingreso original y
  su devolución como filas separadas. Tarjeta, transferencia y depósito conservan su referencia
  e importe de operación, pero su movimiento de efectivo es cero. Apertura y conteo de cierre
  se muestran en el encabezado/resumen, sin sumarlos de nuevo como movimientos.
- El retiro al cierre no se resta dos veces: el efectivo esperado para el cuadre conserva su
  fórmula; el saldo para la siguiente apertura es contado menos retirado al cierre. Cada consulta
  pertenece a una sola caja/operador/moneda. No requiere una migración nueva.
- En Caja de remesas, el **doble clic en cualquier parte de la fila de un importe** (etiqueta,
  monto o espacio intermedio) abre la ventana filtrada por ese tipo. Los totales abren el detalle
  completo, al igual que **Ver todos los movimientos**. No hay un enlace «Ver detalle» junto al
  monto. La fila también se activa con Enter o Espacio al enfocarla. Tiene filtros, desplazamiento,
  refresco y bloqueo de fondo. Un refresco fallido
  muestra el error sin presentar los saldos anteriores como una consulta actualizada.

La impresión de recibos conserva sus importes y lista de datos permitidos. Agrega rollos nominales
de 2, 3 y 4 pulgadas (51, 76 y 102 mm), mantiene POS de 58 y 80 mm, y permite Carta, A4, 8 × 4,
8 × 11 pulgadas y medidas personalizadas en milímetros. Las hojas admiten vertical/horizontal;
los rollos conservan la salida vertical a la izquierda. El texto se reparte en más líneas/páginas,
sin encoger todo el recibo para forzarlo a una sola hoja. Las hojas anchas con diseño pueden
distribuir sus secciones en dos columnas.

Las medidas se validan antes de abrir la ventana: ancho personalizado de 50–320 mm y alto de
50–600 mm. Se utilizan tamaños conocidos o números finitos, nunca texto libre dentro de CSS.
**Automático** usa el área disponible y la orientación elegida; el navegador no proporciona a la
aplicación las medidas de la impresora seleccionada. En el diálogo nativo debe seleccionarse el
mismo papel. Ver [tamaño de página CSS](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@page/size)
y [diálogo de impresión](https://developer.mozilla.org/en-US/docs/Web/API/Window/print).

**Solo texto** conserva separadores, saltos y caracteres Unicode para controladores genéricos;
su tabla de caracteres sigue dependiendo del controlador/impresora. **Con diseño** prepara los
rollos como imágenes con acentos dibujados en el navegador y requiere un controlador gráfico.
Las pruebas de navegador/PDF comprueban distribución y dimensiones solicitadas; no acreditan
legibilidad física en un modelo o controlador no probado.

## Pagos con tarjeta y compatibilidad histórica (actualizado 11-11-2026)

Al seleccionar **Tarjeta de crédito** o **Tarjeta de débito** en la confirmación del envío,
se muestran directamente los campos de banco/proveedor, titular, número de 16 dígitos y
referencia del comprobante, sin abrir ninguna ventana emergente para introducir un cargo
adicional manual (reversión del punto `1.1.1` el 11-11-2026). Crédito utiliza únicamente
el porcentaje configurado en `creditCardCommissionBps` (pago versión **2**); débito no
aplica recargo (`0`, versión **2**). La API rechaza `payment.cardChargeAmount` en
solicitudes nuevas, mientras que la migración **052** y el tipo `RemittancePayment`
conservan legibilidad para registros históricos versión **3** ya almacenados.

En `Configuración General → General` (`system_config`), los datos de la empresa que emite
los recibos son `general.empresa` (nombre de empresa), `general.eslogan` (opcional),
`general.direccion`, `general.telefono` y `general.rnc` (opcional), congelados en
`receiptIssuer` e impresos siempre arriba del todo en los recibos.
