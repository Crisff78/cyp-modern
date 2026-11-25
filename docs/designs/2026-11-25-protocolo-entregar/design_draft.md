# Entregar (pagar) un envío desde la aplicación (protocolo 0.7)

Plan escrito por Claude Code (Fable 5.2) el 2026-11-25, en la laptop de Rardiel, sobre `main` `4e7478d`. Esta es la
versión que se programó: recoge lo que cambió la revisión EGM (ver `goldfish_review_report.md`).

## De dónde sale

Orden de Rardiel del 2026-11-25: «Él me dice que va ir probandolo pero que mientras tenemos que hacer lo del
procesamiento de pago vía url para ya cuando él llegue a ese punto, entiendes?». Preguntado a cuál de los dos pagos
que el contrato deja fuera se refería, eligió: «Pagarle al destinatario».

La otra parte no dio formato para esa petición. El de este plan lo pone CyP.

## Lo comprobado en el código

- El contrato 0.6 lista en «No incluido en esta versión»: «Entregar (pagar) un envío al destinatario».
- En la web es «Entregas de dinero»: `POST /api/envios/:id/pagar` → `payRemittance` (`remittances.ts`). Sus reglas, en
  este orden: el envío existe y la cuenta lo ve (`TRANSFER_NOT_FOUND`); está pendiente (`TRANSFER_NOT_PENDING`);
  `canSeeReceipt` (`FORBIDDEN`); la caja de quien entrega **en la moneda de destino**, abierta ese día
  (`CASH_NOT_OPEN`) y con fondos (`INSUFFICIENT_CASH`). Sale de la caja `payoutOf(transfer)`. Queda `paid`, con
  `paidAt`, `paidBy` y un evento `paid`.
- `canSeeReceipt`: hace falta `remittances.receipts`. Un Cajero ve todo envío pendiente y los que él entregó; un
  Cobrador, los de destinatarios de su ruta; Administración y Supervisión, todos.
- La ruta `…/pagar` pide `remittances.pay` y `remittances.receipts` (`access.ts`). El Cajero los tiene; Supervisión
  solo lee: puede listar y no entregar.
- `cyp_recs` usa `canSeeOutgoing`: un Cajero solo ve allí lo que él registró. Quien entrega suele ser otro: hace falta
  un listado propio.
- `envio_reference` (`ENV` y 8 cifras) es única (`012_remittances.sql`).
- Un envío guarda una copia de los contactos (`senderContact`, `recipientContact`).
- En la web, pagar exige `Idempotency-Key`: la misma clave devuelve la respuesta guardada y otra clave sobre un envío ya
  pagado da `TRANSFER_NOT_PENDING`.

## Qué se hace

Dos peticiones nuevas. Sin migración y sin tocar la web.

| Archivo | Cambio |
| --- | --- |
| `app/server/src/text-protocol.ts` | Comandos `pend` y `pay`, sus parámetros, `REQUIRED` (`pend: 1`, `pay: 4`), códigos y mensajes `ENE`, `ENP`, `MNC`, `CSF`. |
| `app/server/src/text-protocol-routes.ts` | Las dos peticiones; tabla `ACCESS` (ruta equivalente y permiso por comando); `PuedeEntregar`; dato 20 del registro. |
| `app/server/src/remittance-delivery-search.ts` (nuevo) | Envíos pendientes que la cuenta puede entregar, con búsqueda. |
| `app/server/src/remittances.ts` | `deliverableByReference`: el envío por su número, si la cuenta lo ve o lo vería estando pendiente. |
| `app/server/src/remittance-client-search.ts` | Exporta sus dos ayudas de texto. |
| `app/server/src/app.ts` | Un comentario («seven petitions»). |
| `app/server/test/text-protocol.test.ts`, `text-protocol-format.test.ts` | Pruebas nuevas y las que cambian por el sexto dato del inicio de sesión y el dato 20. |
| `docs/protocolo-cyp/Protocolo CYP 0.7.txt` | Renombrado desde la 0.6; sección nueva «5- Entregas» y las frases que dejaban de ser ciertas. |
| `docs/PROTOCOLO-TEXTO-PLANO.md`, `docs/API_CONTRACTS.md` | Al día. |

### 5.1 Envíos por Entregar: `/cyp_pend?idSesion[|Texto[|Pagina]]`

- Responde `OK|FechayHora|HayMas|Envios`, con el registro del Listado de Recibos. Vacío: `RNE`, con su propio mensaje.
- Trae los envíos **pendientes** que la cuenta ve en Entregas (`status === "pending"` y `canSeeReceipt`), de cualquier
  fecha, del más nuevo al más viejo, de 100 en 100.
- `Texto` (hasta 160 caracteres): todas las palabras entre `NumEnvio`, `NumRecibo`, `CodOperacion`, el nombre del
  destinatario, el del remitente y la identificación del destinatario; la identificación, con o sin guiones; y, si el
  texto es solo números (3 o más), el teléfono o el celular del destinatario. No es la búsqueda de la web (que filtra
  en pantalla la frase entera): es la del Listado de Clientes del protocolo, para que la aplicación tenga una sola regla.
- Permiso: `remittances.receipts` (ruta equivalente `GET /api/envios/recibos`). Supervisión lista y no entrega.

### 5.2 Entregar Envío: `/cyp_pay?idSesion|idOperacion|NumEnvio|MontoARecibir`

- **`idOperacion`**, como en Registrar Envío y en la misma tabla (`cyp:{usuario}:{idOperacion}`), con la huella precedida
  de `pay`. El mismo con los mismos datos: la respuesta guardada, sin tocar la caja. El mismo con otros datos, o uno que
  ya se usó para registrar un envío: `OPD` con el `NumEnvio` de la primera vez. Otro `idOperacion` sobre un envío ya
  entregado: `ENP` con Dato 1. Solo queda usado con un `OK`.
- `NumEnvio`: `ENV` y 8 cifras exactas; otra forma es `PIN`. Se usa en vez del `idEnvio` de 36 caracteres.
- `MontoARecibir`: se compara con `payoutOf` (lo que listan `recs` y `pend`, y lo que sale de la caja). Si no coincide,
  `MNC` y no se entrega nada. No protege de un cambio de tasa (el importe queda fijo al registrar): detecta que la
  aplicación cruzó dos registros.
- Responde `OK|FechayHora|Envio`: el registro, ya con `idEstado` 1 y `Fecha_Pago`.
- **Orden real:** salto de línea → sesión → permiso (`SPE`) → datos (`PIN`) → `idOperacion` (`OK` u `OPD`) → `ENE` →
  `MNC` → `ENP` → `CFR` → `CNA` → `CSF`. Los tres primeros de la lista de errores (`ENE`, `MNC`, `ENP`) los decide el
  adaptador antes de llamar a `payRemittance`; por eso no es solo un adaptador delgado, y la cabecera del archivo lo dice.
- **`ENE` o `ENP`.** `ENE` solo si el envío no existe o la cuenta no lo vería ni pendiente (`deliverableByReference`).
  Así el Cajero que intenta entregar lo que otro ya entregó, o un envío cancelado, recibe `ENP` con el `idEstado`.
- `CFR`: solo alrededor de `payRemittance` (un `FORBIDDEN` de permisos sigue siendo `SPE`); Dato, el `idCliente` corto
  del destinatario. `CNA` y `CSF`: mensaje y Dato con la moneda de destino.
- Todo dentro de una transacción, con `assertAuthSession`, `currentAccessUser`, `authorizeRequest`,
  `requireRemittancePermission("remittances.pay")`, `guardCatalogChanges` y `recordMutationTrace` (con el envío).

### El registro de un envío

Gana un dato 20 al final: la identificación del destinatario, de la copia guardada en el envío. Viene en `recs`, `pend`
y `pay`. Sin él la aplicación no podría comprobar a quién le entrega (`cyp_client` pide `remittances.create` y da la
ficha de hoy, no la copia).

### Inicio de sesión

`DatosUsuario` gana un sexto dato al final: `PuedeEntregar` (1 o 0), que es `can(POST /api/envios/x/pagar)`.

### Códigos nuevos

| Código | Qué pasa en CyP | Dato |
| --- | --- | --- |
| `ENE` | El envío no existe o la cuenta no lo vería ni pendiente. | `NumEnvio` |
| `ENP` | Ya está entregado o cancelado. | `idEstado` (1 o 2) |
| `MNC` | El `MontoARecibir` no es el de ese envío. | `NumEnvio` |
| `CSF` | `INSUFFICIENT_CASH`. | Moneda de destino |

`CFR`, `CNA` y `OPD` se reutilizan y el contrato los redefine para las entregas.

## Lo que cuesta

- **La caja.** Quien entrega necesita su Caja de Remesas abierta ese día **en la moneda que recibe el destinatario**, y
  con fondos. El protocolo no abre cajas ni les pone dinero. La aplicación no lo sabe hasta que llega `CNA` o `CSF`.
- **Entregar por GET.** La dirección queda en registros ajenos. No puede entregar dos veces, pero quien tenga un
  `idSesion` vivo de un Cajero puede dar por entregado cualquier envío pendiente de la empresa mientras la caja tenga
  fondos. No se lleva efectivo: inutiliza envíos y descuadra cajas. Dejar `pay` solo por POST no lo cierra. Queda en
  «Antes de producción».
- Un Cajero ve en el listado todos los envíos pendientes de la empresa, con el nombre, el teléfono y la identificación
  del destinatario: es lo que ya ve en la web, en Entregas de dinero.
- No hay vuelta atrás: la central no tiene «anular una entrega».
- El contrato manda lo contrario que el texto de la web («Confirma después de entregar el dinero»): la aplicación pide
  Entregar y el dinero se da solo con el `OK`.

## Lo que no se hace

- Un interruptor para prohibir `pay` por GET, un límite propio de `pay` y traza de las repeticiones.
- **Listar lo que el usuario ya entregó** y **el estado de sus cajas**. El `OK` de cada entrega es el comprobante.
- **Imprimir el recibo de quien recibe** desde la aplicación; **abrir o cerrar la caja**; **cancelar un envío**; **pagar
  con tarjeta**.
- **Aceptar el `idEnvio` largo en `cyp_pay`:** un solo nombre para el envío, el corto.
- **Llamar a la petición `deliver`:** se queda `pay`, la palabra de la orden.
- **Una entrega real en la demo pública** como comprobación: mueve la caja de la cuenta con la que prueba la otra parte
  y no se puede deshacer. Se prueba en local, con PostgreSQL.

## Pruebas

- `pend`: lo que ve un Cajero (todo lo pendiente), un Cobrador (destinatarios de su ruta) y Supervisión; búsqueda por
  número de envío, de recibo, código de operación, nombre, identificación (con y sin guiones) y teléfono; páginas;
  `RNE`; `PIN`; `SPE`; lo entregado no sale.
- `pay`: entrega (estado, quién, saldo de la caja y traza); la misma petición repetida por POST y por GET con `p=` y
  `3.0`, sin segundo movimiento; `ENP` con otro `idOperacion` (el mismo Cajero y otro Cajero); `OPD` (otros datos, y
  contra un envío en los dos sentidos); un `idOperacion` rechazado sirve después; `ENE`, `MNC`, `CFR`, `CNA`, `CSF`,
  `ENP` de un cancelado, `SPE` (Supervisión) y `PIN` de cada dato.
- `withoutVersion` con `pay` (un importe al final sigue siendo el importe) y `pend`.
- Inicio de sesión con 6 datos; el registro con 20.
- Toda la suite del servidor, tipos, compilación pública y arranque real con PostgreSQL (registrar con una cuenta,
  listar y entregar con otra).
- Después de publicar, en la demo, sin entregar nada: el inicio de sesión trae 6 datos, `cyp_pend` responde `OK` o
  `RNE`, y `cyp_pay` de un envío que no existe, `ENE`.
