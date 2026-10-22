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
  recotizar antes de registrar.
- `GET /envios/cotizacion?sourceCurrency=USD&destinationCurrency=DOP&amount=10000&amountMode=source|destination`
  → `{sourceCurrency,destinationCurrency,amount,commissionBps,commissionAmount,totalAmount,receiveAmount,quote,...}`.
  `amountMode=destination` cotiza desde el importe a recibir; ver
  [REMESAS-COTIZACION-REPARTO.md](REMESAS-COTIZACION-REPARTO.md).
- `POST /envios`:
  `{senderClientId | newSenderClient, recipientClientId | newRecipientClient, sendingUserId?, recipientPhone?, sourceCurrency, destinationCurrency, amount, requestedReceiveAmount?, commissionBps?, managerCommission?, quote, note?, payment?}`
  → `TransferView`, con `senderContact`, `recipientContact`, `payment` y
  `receiptIssuer` congelados. Ver [REMESAS-PAGOS-RECIBOS.md](REMESAS-PAGOS-RECIBOS.md).
  - Por cada participante va **exactamente una** alternativa: el ID de un cliente
    existente o una ficha nueva `{name, identification, phone, address, routeId,
    preferredCurrency?}`. Las dos o ninguna devuelve 400 `VALIDATION`.
  - `quote` debe ser exactamente la cotización recibida. Cambio de
    fecha/tasa/configuración devuelve `QUOTE_CHANGED` 409. Si `commissionBps`
    viene presente, se valida contra la tasa central y no puede reemplazarla.
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

`expected = openingAmount + sentTotal - cancelRefund - paid` por caja/moneda.
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
    amount:number; commissionAmount:number; totalAmount:number; receiveAmount:number}[];
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

Migración aditiva 012: `clients.active`, tasas en la tabla existente `exchange_rates`,
`remittance_transfers`, `remittance_cash_sessions`, `remittance_events`.
Referencias y ledger se conservan tras reinicios. Idempotencia usa el store común.
No se integra Western Union, netbanking ni bancos. No se aplican migraciones a
la base de operación como parte de la preparación local.
