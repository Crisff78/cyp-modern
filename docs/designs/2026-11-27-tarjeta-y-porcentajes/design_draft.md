# Pago con tarjeta y porcentajes de los cargos (protocolo 0.13)

Plan escrito por Claude Code (Opus 5.5) el 2026-11-27, en la laptop de Rardiel, sobre `main` `cd706b5` (protocolo 0.12).
Una etapa de revisión EGM con dos revisores (ver `goldfish_review_report.md`). Esta es la versión que se programó.

## De dónde sale

La otra parte preguntó a Rardiel si los cargos estaban en la documentación. Claude Code le confirmó lo que está en la 0.12:
las definiciones, `Comision`, `Por_Comision` y `CargoEntrega` en Cotizar, y la comisión en cada envío. Le dijo también
lo que falta: el recargo de la tarjeta, que va con pagar con tarjeta, y una petición con los porcentajes.

Rardiel, 2026-11-27: «Ok, pues luego cuando hagamos la versión 0.13 del protocolo, sería bueno que incluyeras lo que falta
que no incluiste». Preguntó después si eso estaba programado, y se le dijo que no: el protocolo no lo tiene, no es solo
que no esté en el documento. Entonces dijo: «Ok, hazlo entonces y deja todo listo».

El alcance son esas dos cosas. El resto de la lista «No incluido en esta versión» no se pidió y queda fuera: recibo
completo, envíos ya entregados, cancelar, crear cliente y abrir o cerrar la caja.

## Lo comprobado (en `main`)

- **Registrar Envío** (`text-protocol-routes.ts`, `paymentOf`) solo acepta `idForma_Pago` 1, 3 y 4; la tarjeta (2) da
  `PIN`. `namedParameters` exige exactamente 16 datos.
- **El registro de un envío** ya trae `2` como forma de pago y un `TotalAPagar` con el recargo (`totalPaidForTransfer`).
- **Cómo paga la web con tarjeta** (`app/shared/remittances/payment.mjs`, `paymentAmounts`):
  - `cardType`, crédito o débito; `reference`, el comprobante; `bank`, opcional; `verified: true`;
  - con crédito, el titular (`isCardholderNameDraft`, con al menos una letra) y los últimos 4 dígitos;
  - con débito, esos dos datos son opcionales, pero van los dos o ninguno.
- **El recargo** es solo de crédito: `cardPaymentCharge(total, "credit", creditCardCommissionBps)`, redondeado al
  céntimo, sobre el total en la moneda de origen.
  - Se guarda en el pago y `transfer.totalAmount` no lo incluye.
  - `createRemittance` toma el porcentaje de `calculated.quote.creditCardCommissionBps`.
  - La base de datos comprueba la misma fórmula (migración 052).
  - La caja tiene que estar abierta igual, aunque con tarjeta no entra efectivo.
- **El archivo cifrado de la tarjeta.** Si la central lo tiene activado (`CARD_VAULT_ENABLED`), la ruta de la web exige el
  número completo cifrado para crédito, y para débito con los 4 dígitos (`remittance-routes.ts`, `archiveEligible`).
  `createRemittance` no lo comprueba. El protocolo no puede ni debe recibir el número completo. En `render.yaml` no está
  `CARD_VAULT_ENABLED`; no se comprobó el panel de Render.
- **Los porcentajes** (`getCommissionPolicy`) son una sola configuración para toda la central: comisión, cargo de entrega
  y recargo de crédito. El reparto con el gestor y el redondeo son internos. La web ya los manda a quien cotiza.

## Qué se hace

### 1. Registrar Envío con tarjeta (`idForma_Pago` 2)

- **16 o 19 datos.** Tres datos nuevos al final, después de la `Nota`: `idTipoTarjeta` (1 = crédito, 2 = débito),
  `Titular` y `Ultimos4`.
  - 16 datos es la petición de siempre, sin cambios. Con tarjeta van 19. Con 17 o 18 datos, `PIN` con `Parametros`.
  - La `VersionApp` va de dato 17 con 16 datos, o de dato 20 con 19.
  - Ningún dato nuevo puede parecer una versión: `idTipoTarjeta` y `Ultimos4` no llevan punto, y `Titular` lleva letras.
- **Con tarjeta**, las reglas de la web:
  - `Recibido` va vacío y `Referencia` es obligatoria;
  - `Banco` es opcional y `Verificado` tiene que ser 1 (si no, `PNV`);
  - `idTipoTarjeta` es obligatorio;
  - con crédito, `Titular` y `Ultimos4` son obligatorios; con débito, van los dos o ninguno.
  - Un dato que falta o está mal da `PIN` con su nombre.
  - `Titular` se valida tal como llega (`isCardholderNameDraft`, hasta 120, con una letra). `Ultimos4` son exactamente 4
    cifras.
- **Con las otras formas de pago**, si vienen los 19 datos, los tres nuevos van vacíos. Si traen algo, `PIN`.
- **`TotalAPagar` es lo que paga en total el remitente**, como ya en el registro de un envío:
  - con tarjeta de crédito incluye el recargo, y es el `TotalConTarjeta` de Cotizar;
  - con débito y las demás formas, el de siempre.
  - Si no coincide con lo que calcula la central, `CCA`.
  - El `Monto` con Modo 1 sigue siendo el total sin el recargo.
- **La respuesta** conserva sus 10 datos. Su `TotalAPagar` pasa a ser lo pagado en total (`totalPaidForTransfer`), que
  solo es distinto con crédito. No se añade ningún dato.
- **La huella** (`idOperacion`) es la de siempre con los 16 primeros datos. Se le añaden los tres de tarjeta solo si
  alguno trae algo. Una petición de 16 datos y la misma con los tres vacíos dan la misma huella, y las guardadas siguen
  valiendo.
- **El archivo cifrado.** Después de buscar el `idOperacion`, como `CCA`: si la central lo tiene activado y el pago lo
  exigiría, se responde `ORC` con «Registre este pago con tarjeta desde la central» y no se registra nada.
  - Así, repetir un envío ya registrado sigue dando su respuesta.
  - La condición deja de estar escrita en la ruta de la web y pasa a una función compartida, `cardArchiveApplies`, en
    `payment.mjs`, que usan la web y el protocolo.
  - Las rutas reciben `cardArchiveRequired: Boolean(config.cardVault)`.
- **Si la base de datos rechaza el pago con tarjeta** (23514, `remittance_payment_valid` o
  `remittance_card_rate_matches_quote`), se responde `ORC`, no `EIC`: repetirlo no lo arregla.

### 2. Cotizar Envío trae el recargo de tarjeta

Tres datos nuevos al final de la `Cotizacion`, para tarjeta de crédito:

- `Por_RecargoTarjeta`, el porcentaje;
- `RecargoTarjeta`, en la moneda de origen;
- `TotalConTarjeta`, el `TotalAPagar` más el recargo.

Con 0 % valen `0.00`, `0.00` y el mismo `TotalAPagar`. Se calculan con `cardPaymentCharge` y
`result.quote.creditCardCommissionBps`. Si esa función rechaza el importe por demasiado grande, `PIN` con `Monto`
(como `MONEY_RANGE`), no `EIC`.

### 3. Petición nueva: Porcentajes (`/cyp_fees?idSesion`)

- Responde `OK|FechayHora|Por_Comision;Por_CargoEntrega;Por_RecargoTarjeta` (`percentText`, `5.00`).
- Los datos salen de `getCommissionPolicy`. Tiene el permiso de Cotizar.
- Los porcentajes son para mostrar: los importes salen siempre de Cotizar.

### El contrato (0.13)

- **3.2:** los 16 o 19 datos, los tres nuevos, la tarjeta, el `TotalAPagar`, un ejemplo con crédito y que hace falta la
  caja abierta.
  - Una regla nueva: el número completo de la tarjeta, el vencimiento y el CVV no van en ningún dato, tampoco en la
    `Referencia` ni en la `Nota`.
  - Para pagos con tarjeta se recomienda POST.
  - Ninguna respuesta devuelve el `Titular` ni los `Ultimos4`.
  - Por GET, los espacios del `Titular` van como `%20`, no como `+`.
- **Frases que cambian:**
  - en 3.1, `TotalAPagar` y el Modo 1 dicen «sin el recargo de tarjeta»;
  - en la respuesta de 3.2, «significan lo mismo que en Cotizar», salvo el `TotalAPagar` con crédito;
  - «Sobre VersionApp»: dato 17, o 20 con tarjeta.
- **6.3 nueva** (Porcentajes).
- **«No incluido»** pierde «Pagar con Tarjeta».
- **Preguntas:** en la 1, `fees`; en la 6, `idTipoTarjeta`.
- **«Lo nuevo»**, desde la 0.7.

### Archivos

| Archivo | Cambio |
| --- | --- |
| `app/shared/remittances/payment.mjs` y `payment.d.mts` | `cardArchiveApplies`. |
| `app/server/src/remittance-routes.ts` | Usa `cardArchiveApplies` (misma condición). |
| `app/server/src/text-protocol.ts` | Comando `fees`; `send` con 16 o 19 datos; encabezado 0.13. |
| `app/server/src/text-protocol-routes.ts` | `paymentOf` con tarjeta; total; huella; archivo; Cotizar; `fees`; error de la base de datos; encabezado. |
| `app/server/src/app.ts` | `cardArchiveRequired: Boolean(config.cardVault)`. |
| `app/server/test/text-protocol.test.ts`, `text-protocol-format.test.ts` | Pruebas. |
| `docs/protocolo-cyp/Protocolo CYP 0.13.txt` (renombrar desde la 0.12) | Lo de arriba. |
| `docs/PROTOCOLO-TEXTO-PLANO.md`, `docs/API_CONTRACTS.md` | Al día; «Antes de producción». |

## Lo que cuesta

- **Datos de la tarjeta en la dirección.** Por GET, el titular y los 4 dígitos viajan en la dirección. Es lo mismo que ya
  pasa con el `idSesion` y con los datos de los clientes. Se recomienda POST y va a «Antes de producción».
- **Con el archivo cifrado activado**, el crédito no se puede registrar desde la aplicación (`ORC`). En una central real
  hay que decidirlo.
- **El `TotalAPagar` de la respuesta de Registrar Envío** con crédito lleva el recargo. Hasta hoy no se podía pagar con
  tarjeta por el protocolo, así que nadie leía esa respuesta con crédito.

## Pruebas

- **Crédito:**
  - un envío registrado con el `TotalConTarjeta` de Cotizar: el recargo se guarda en el pago, la respuesta trae el total
    con el recargo, y Recibos trae `2` y el mismo total;
  - repetido, el mismo envío;
  - con el `TotalAPagar` sin recargo, `CCA`;
  - con la caja cerrada, `CNA`.
- **Débito:** sin titular, OK y sin recargo; con solo uno de los dos datos, `PIN`.
- **Datos de tarjeta:**
  - sin `idTipoTarjeta`, `PIN`;
  - `Ultimos4` de 3 o 16 cifras, `PIN`;
  - titular sin letras o con un carácter de control, `PIN`;
  - `Recibido` con tarjeta, `PIN`; sin `Referencia`, `PIN`; `Verificado` 0, `PNV`.
- **Número de datos:**
  - 17 o 18 datos, `PIN`;
  - efectivo con 19 datos y los tres vacíos, el mismo envío que con 16 al repetirlo;
  - efectivo con datos de tarjeta, `PIN`.
- **Archivo cifrado:** con `cardArchiveRequired`, crédito da `ORC`; débito sin los 4 dígitos, OK; un crédito ya
  registrado y repetido, OK.
- **Cotizar:** trae los tres datos nuevos; con 0 %, `0.00`, `0.00` y el `TotalAPagar`.
- **`fees`:** los tres porcentajes; `SPE` y `SNE`.
- **`withoutVersion`:** `send` con 19 datos y `3.0`.
- **La web:** sus pruebas del archivo cifrado siguen pasando con la función compartida.
- **General:** suite del servidor, tipos, compilación pública y arranque real con PostgreSQL. En la demo, solo leyendo:
  `fees` y Cotizar. No se registra ningún pago, porque no se deshace.
