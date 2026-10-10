# Contratos del servidor: NUEVO09oct

Fecha: 2026-10-09. Las escrituras siguen usando `Idempotency-Key`, permisos y la
transacción del `Store`. Los importes son enteros en centavos y cada moneda mantiene
su saldo separado. Las migraciones 027–029 son aditivas y deben aplicarse antes de
usar este servidor con PostgreSQL. No reescriben recibos ni remesas históricas.

## Bancos y cobros

- `GET /api/bancos`: catálogo autenticado `{ id, name, active }[]`.
- `POST /api/bancos` y `POST /api/bancos/:id`: administración guarda
  `{ name, active }`; nombres únicos sin distinguir mayúsculas, hasta 160 caracteres.
- `POST /api/cobros` y `POST /api/cobros/central` admiten `bankId`, `reference`
  (160 caracteres) y `note` (2000 caracteres) opcionales. El banco debe estar activo
  al registrar el cobro. Cada movimiento conserva `bankId`, `bankName`, `reference`
  y `note`; renombrar o desactivar el catálogo no cambia ese texto histórico.

## Código e identificación interna de clientes

`POST /api/clientes/sugerencias` con `{}` reserva atómicamente
`{ reservationId, code, internalIdentification }`. La secuencia usa `CLI00000001`
e `INT00000001`, crece sin reutilizar reservas canceladas y conserva huecos. La
reserva pertenece a la cuenta administradora que la pidió.

En `POST /api/clientes`, `code` es opcional y `reservationId` es opcional. Se
mantienen el código manual y el UUID. Si se envía una reserva, su identificación
interna se asigna incluso cuando el código manual difiere de su sugerencia. Sin
reserva se genera una al guardar. La identificación legal `identification` sigue
siendo requerida para altas y nunca se genera a partir de esta secuencia.

`POST /api/clientes/:id` permite `reservationId` una sola vez para clientes antiguos
sin identificación interna. Una identidad interna ya asignada es inmutable.
`internalIdentification` es un campo de respuesta; no se acepta como texto libre en
los formularios de alta o edición. Las reservas tampoco se borran.

## Tasas y cuadres

`POST /api/envios/tasas` mantiene `currency`, `date` y `rate` operativo. Admite
`purchaseRate` y `saleRate` juntos, como decimales positivos de hasta seis cifras
decimales. DOP exige uno para ambos. Si se omiten, se conserva la pareja existente.
Cada cambio conserva ambos valores en su revisión histórica; las filas anteriores
mantienen la pareja desconocida. La conversión de remesas sigue usando `rate`.
No se introduce una regla de margen ni se sustituye la fórmula actual por compra
o venta. El snapshot ordena tasas e historial con las más recientes primero.

`GET /api/cuadres/preview?collectorId=...&date=...&currency=DOP` conserva su respuesta
para la moneda solicitada y añade `totalsByCurrency`, `deliveriesByCurrency` y
`pendingByCurrency`, con claves DOP, USD y EUR. Los pendientes separan `charges` y
`payouts` y conservan sus indicadores de conflicto histórico. `pendingUnsupported`
retiene obligaciones de moneda desconocida con su nombre literal y los indicadores
`currencyUnsupported`/`currencyConflict`; no se suman a DOP ni a otra moneda. El
cierre conserva la condición de diferencia cero en cada moneda.

## Recibos, contactos y configuración

`POST /api/configuracion` admite `config.receiptFooterNote` (2000 caracteres) y
`config.companyLogoDataUrl` (24576 caracteres de cadena completa). El logo solo
admite data URLs base64 PNG, JPEG o WebP, o cadena vacía. El límite incluye el
prefijo y la codificación, no representa 24 KiB de archivo binario.

El recibo mínimo expone `footerNote` y ESC/POS incluye ese pie. El snapshot de
remesas expone `receiptFooterNote` para imprimir sin una consulta adicional. Los
contactos de nuevas remesas conservan `identification` legal cuando el cliente ya
la tiene; no se completa retrospectivamente una remesa antigua. Los movimientos
del snapshot exponen `createdBy` a partir del actor real y `createdByName` de su
cuenta, o el identificador si no hay un nombre provisionado.

## Usuarios y contraseña propia

La propiedad histórica `email` es el identificador de inicio de sesión: acepta
usuario o correo como texto de una línea de hasta 200 caracteres. El servidor
normaliza mayúsculas y protege identificadores ya usados, incluidos los alias de
las cuentas iniciales. Los correos de contacto de clientes conservan su validación.

`POST /api/usuarios/:id/clave` usa `{ password, currentPassword }` cuando cambia la
propia contraseña. Verifica la contraseña actual y revoca todas sus sesiones.
Administración puede restablecer otra cuenta con `{ password }` como antes. Para
una cuenta inicial virtual, el primer cambio verificado guarda su hash en el Store;
los inicios posteriores usan ese hash y dejan de aceptar la contraseña inicial.

## Comprobación aislada

`october-nine-contracts.test.ts` usa solo `MemoryStore` ficticio. La prueba
`october-nine-postgres.test.ts` solo se habilita con
`CYP_OCTOBER_NINE_TEST_DATABASE_URL` y exige el destino exacto
`127.0.0.1:55435`, usuario `october_nine_qa`, base `cyp_october_nine_test`.
Comprueba las migraciones 001–029 y sus hashes, relectura, concurrencia e
inmutabilidad. Ninguna de estas pruebas necesita `.env`, shareddata o un VPS.
