# Implementation coordination contract

Two Spanish-language React + Vite frontends share a Fastify API on port 3001, under `/api`. Admin Vite port 5173, collector 5174; proxy `/api` to 3001. Root npm workspaces are `app/server`, `app/client-admin`, `app/client-collector`. Each frontend owns its package.json, tsconfig.json, vite.config.ts and src/public files; no root modifications.

Use React, TypeScript, lucide-react, Sonner, Tailwind via @tailwindcss/vite, @radix-ui/react-dialog (accessible dialogs/sheets); CSS tokens slate/white and emerald accents, Inter. No native mobile. Use npm current stable compatible versions; root performs npm install.

API amounts are integer centavos; format as DOP / RD$. Server uses local Dominican date YYYY-MM-DD. JSON request/response. Errors `{error:{code,message}}`. Login `POST /api/auth/login {email,password}` returns `{token,user:{id,name,role,collectorId?}}`; bearer auth. Demo accounts admin@cyp.local and collector@cyp.local, password `Demo-CyP-2026!` only enabled with DEMO_MODE=true. Keep token in sessionStorage; login screen and explicit demo entry button allowed. GET `/api/auth/me` returns user. GET `/api/snapshot` returns shape below, collector role scoped. Refresh after mutations; visible refresh and loading/error states. Always label fictional seed data `Entorno de demostración`.

Snapshot shape:

```
{
 businessDate:string,
 clients: [{id,name,code,phone,address,routeId}],
 routes: [{id,name,sector,collectorId}],
 collectors: [{id,name,initials,routeId,status:'active'|'offline'|'limit',cashInHand:number,collectionLimit:number,payoutLimit:number,lat:number,lng:number,lastSeen:string}],
 charges: [{id,clientId,service,amount:number,collected:number,dueDate:string,required:boolean,status:'pending'|'partial'|'paid'|'cancelled'}],
 payouts: [{id,clientId,collectorId,concept,amount:number,paid:number,status:'pending'|'partial'|'paid'|'cancelled'}],
 movements: [{id,collectorId,clientId?:string,chargeId?:string,payoutId?:string,type:'collection'|'deposit'|'office_delivery'|'payout',amount:number,createdAt:string,receiptToken?:string}],
 settlements: [{id,collectorId,date,collected,deposited,officeDelivered,paidToClients,difference,status:'closed',closedAt}],
 totals:{collected:number,paid:number,deposited:number,officeDelivered:number,difference:number,activeCollectors:number},
 history:[{label:string,collected:number,paid:number}]
}
```

Mutations: POST `/api/cargos` `{clientId,service,amount,dueDate,required}`; POST `/api/cargos/recurrentes` `{clientIds:string[],service,amount,dueDate,required}`; POST `/api/descargos` `{clientId,collectorId,concept,amount}`; POST `/api/cobros` `{chargeId,amount}`; POST `/api/pagos` `{payoutId,amount}`. Every money mutation must send `Idempotency-Key: crypto.randomUUID()`; keep same key for retries of the same operation. Cobros and Pagos return `{movement,receipt:{token,url}}` where URL points to collector frontend `/?receipt=<token>`. Office-only POST `/api/depositos` or `/api/entregas` `{collectorId,amount}`. POST `/api/cuadres` `{collectorId,date}` derives authoritative totals from ledger and rejects difference !== 0, closes date and blocks backdated movements. GET `/api/cuadres/preview?collectorId=...&date=...` returns `{collected,deposited,officeDelivered,paidToClients,difference}`. POST `/api/tracking` `{lat,lng}` for collector only. GET `/api/tracking` returns collectors. POST `/api/recibos/:token/revocar` admin only. GET `/api/recibos/:token` public unguessable bearer receipt returns `{id,clientName,collectorName,concept,amount,createdAt,type}` with no phone/address. GET `/api/recibos/:token/escpos?width=58|80` returns printable binary. Frontend can download to OS bridge, browser print is separate. Clearly indicate browser cannot silently access arbitrary thermal printers.

Seed ids: collectors `col-1` (Ana Martínez), `col-2` (Luis Pérez), `col-3` (Marta Reyes); routes `route-1` ...; clients `cli-1` ... `cli-8`; charges `chg-1` ... `chg-8`. Collector login scoped col-1. Required charges marked “Obligado a cobrar”. Risk model collectionLimit caps collection cash outstanding (`collections-deposits`), payoutLimit caps office advance outstanding (`office deliveries-payouts`); nonnegative component balances; reject movements above caps/available funds. Total cash = both components. Exact daily closure at zero; no tax or loan amortization.

Root owns backend, root config, docs, database; agents own their frontend only. Document integration expectations in your final report.
