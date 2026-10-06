# Envíos de Dinero: contrato local

Todas las rutas requieren sesión. Base `/api`. Todos los POST requieren
`Idempotency-Key` (UUID recomendado; reutilizar al reintentar el mismo payload).
Errores: `{error:{code,message}}`. Importes son centavos enteros no negativos,
con máximo seguro de JavaScript; un principal debe ser positivo. Monedas: DOP,
USD, EUR, todas a dos decimales. Fechas de negocio: America/Santo_Domingo.
Este módulo tiene caja propia y no altera el ledger DOP de cobros/entregas.

## Tipos compartidos

```ts
type Currency = 'DOP' | 'USD' | 'EUR';
type Quote = { date: string; sourceRate: string; destinationRate: string };
type Rate = { id: string; currency: Currency; rate: string; date: string };
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
  clients: {id:string; code:string; name:string; routeId:string; active:boolean;
    canSendFrom:boolean; canReceive:boolean}[];
  operators: {id:string; name:string; role:'admin'|'collector'; collectorId?:string}[];
  rates: Rate[]; transfers: TransferView[]; cashSessions: CashView[];
};
```

La tasa es DOP por unidad de moneda, string decimal con seis posiciones; DOP
siempre vale `1.000000`. Se exige tasa de la fecha exacta para cada moneda usada;
no se arrastra la del día anterior. Comisión: BPS enteros 0..10000 (100 BPS=1%).
Remitente paga `amount + commissionAmount` en origen. Destinatario recibe
`round_half_up(amount * sourceRate / destinationRate)` en destino; la comisión
no se convierte ni se descuenta de su principal. El backend usa BigInt para
intermedios y rechaza resultados fuera del rango seguro.

## Consultas, tasas y alta

- `GET /envios/snapshot` → `Snapshot`. Clientes mínimos sirven para seleccionar
  destinatario; solo `canSendFrom` habilita remitente. `transfers` contiene la unión
  de operaciones visibles por origen propio/ruta y recepción por ruta destino.
  Admin ve todas. Cajas: admin todas; cobrador solo propias.
- `GET /envios/clientes/:id/contacto?side=sender|recipient&senderId=...`
  devuelve `{id,code,name,phone,cellular,address}` del cliente seleccionado.
  Requiere sesión de operador, cliente activo y ruta propia para remitentes de
  cobrador. El destinatario puede pertenecer a otra ruta, pero debe ser distinto
  de `senderId`. No devuelve notas, documentos ni un índice global de contactos.
  Formulario y confirmación muestran estos datos actuales; el POST captura la
  copia definitiva en servidor y el comprobante usa los contactos guardados.
- `GET /envios` → `TransferView[]` visibles como envíos propios/ruta origen.
- `GET /envios/recibos` → `TransferView[]` visibles por ruta destino (admin todas).
- `POST /envios/tasas` admin: `{currency,rate:string,date:'YYYY-MM-DD'}` → `Rate`.
  Solo fecha de negocio actual; DOP solo admite 1. Los envíos previos retienen su tasa.
- `GET /envios/cotizacion?sourceCurrency=USD&destinationCurrency=DOP&amount=10000&commissionBps=100`
  → `{sourceCurrency,destinationCurrency,amount,commissionBps,commissionAmount,totalAmount,receiveAmount,quote}`.
- `POST /envios`:
  `{senderClientId,recipientClientId,sendingUserId?,sourceCurrency,destinationCurrency,amount,commissionBps,quote,note?}`
  → `TransferView`. `quote` debe ser exactamente la cotización recibida. Cambio de
  fecha/tasa devuelve `QUOTE_CHANGED` 409. `sendingUserId` omitido usa usuario
  autenticado; solo admin puede representar otro operador activo. `registeredBy`
  siempre es el autenticado. Clientes deben ser distintos, existentes y activos.
  El remitente debe pertenecer a la ruta del operador si este es cobrador.
  Necesita caja abierta del operador en moneda origen y fecha actual.

Al confirmar el alta, la interfaz valida la respuesta persistida y pregunta
«¿Quieres imprimir el recibo?». Imprimir reutiliza el mismo comprobante del
detalle, con los contactos y tasas guardados; No imprimir solo cierra la pregunta.
Una respuesta incierta conserva el formulario y la clave para reintentar, sin
ofrecer impresión hasta confirmar el resultado. Un error al actualizar el listado
no pierde el comprobante confirmado. Si se bloquea la ventana de impresión, la
pregunta conserva el recibo y muestra el aviso para volver a imprimir, sin otro POST.

## Pago y cancelación

- `POST /envios/:id/pagar` con `{}` → `TransferView`. Pago único y completo,
  solo pendiente, por admin o cobrador de la ruta destino. Usa la caja abierta del
  usuario autenticado en moneda destino y fecha actual; requiere saldo suficiente.
- `POST /envios/:id/cancelar` con `{reason:string}` (1..500) → `TransferView`.
  Solo pendiente; admin o usuario `sendingUserId` autorizado. Devuelve principal
  más comisión contra la caja actual abierta de `sendingUserId` en moneda origen,
  con saldo suficiente. No modifica una caja cerrada ni el día del envío original.

Estados terminales no admiten otra operación. Un reintento con misma clave vuelve
a la respuesta anterior; otra clave sobre un terminal produce `TRANSFER_NOT_PENDING`.
Referencias ENV######## y REC######## son correlativas únicas y no se reutilizan.
El código operativo aleatorio es referencia, nunca permiso de acceso.

## Caja

- `POST /envios/cajas/abrir` admin:
  `{operatorId,currency,openingAmount}` → `CashView`. Fecha actual asignada por
  servidor; operador activo; apertura >=0; una caja por operador/moneda/día.
  Debe estar cerrada cualquier caja anterior de ese operador y moneda.
- `POST /envios/cajas/:id/cerrar` self/admin:
  `{countedAmount}` → `CashView`. Solo abierta; contado debe igualar esperado.
  Cerrada bloquea movimientos. Puede cerrarse una caja anterior antes de abrir hoy.

En la interfaz administrativa: Envíos de Dinero → Caja → operador del envío →
moneda de origen → efectivo inicial → Revisar apertura → Confirmar.
La fecha viene del servidor; 0 es válido si la caja comienza sin efectivo.
Una caja ya cerrada en la fecha actual no puede reabrirse. Para entregar un
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
Los agregados de montos conservan pares origen/destino y entregados conserva
moneda destino; nunca hay un total que mezcle monedas.
`deliveryTimeSummary` agrupa por fecha de pago o rango y conserva mínimo, máximo
y promedio de segundos. `cashSummary` agrupa por operador, moneda y día/rango;
acumula únicamente flujos, conserva la primera apertura y el último saldo esperado
sin sumar saldos de días diferentes. `deliveryTimes` y `cash` conservan el detalle.

## Actividad de clientes

`POST /clientes/:id/actividad` admin `{active:boolean}` → cliente actualizado.
Clientes antiguos y nuevos parten con active=true. Inactivar impide nuevos envíos;
no borra historial ni bloquea pago/cancelación de un envío existente.
GPS se mantiene mediante el contrato existente `POST /clientes/:id`.

## Persistencia y alcance

Migración aditiva 012: `clients.active`, tasas en la tabla existente `exchange_rates`,
`remittance_transfers`, `remittance_cash_sessions`, `remittance_events`.
Referencias y ledger se conservan tras reinicios. Idempotencia usa el store común.
No se integra Western Union, netbanking ni bancos. No se aplican migraciones a
la base de operación como parte de la preparación local.
