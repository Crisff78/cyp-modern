# Cálculo de Envíos de dinero

Cómo calcula CyP cada envío desde el 29 de octubre de 2026, según lo explicado en la reunión
(«Anotación cálculo cobros y pagos») y la pizarra «DT Cálculo». Todos los números de este documento
son de ejemplo y salen de las pruebas (`app/server/test/remittance-calculation.test.ts`).

Tasas de ejemplo del día:

| Moneda | Compra (la empresa compra) | Venta (la empresa vende) |
|---|---|---|
| USD | 58 | 61 |
| EUR | 66 | 70 |
| DOP | 1 | 1 |

## Las reglas en pocas palabras

1. **Todo envío cobra comisión**, haya o no cambio de moneda. La paga quien envía y **se suma**:
   envía 1,000 + comisión 200 = paga 1,200.
2. **Todo pasa por pesos.** La moneda de quien envía se **compra** (tasa de compra) y la de quien recibe
   se **vende** (tasa de venta). La empresa gana por dos lados: la comisión y el cambio.
3. **Ganancia por cambio:** se calcula en cada envío con cambio de moneda, en pesos, con las tasas de
   compra y venta registradas ese día. Se guarda con el envío y sale en su reporte.
4. **El gestor** cobra su porcentaje **solo de la comisión**, nunca del cambio. Lo que queda de la
   comisión es de la empresa.
5. **Comisión de entrega en el destino:** se resta de lo que recibe la persona. Por defecto «Sin comisión».
6. **Tres casillas:** se puede escribir en cualquiera y las otras se calculan solas.
7. **Redondeo de lo que recibe la persona:** lo decide Administración. Por defecto, como antes (con centavos).
8. **Cada envío se guarda completo** y no cambia aunque luego cambien las tasas o la configuración.
9. **El recibo impreso** lleva solo montos; la pantalla conserva todo el detalle.

## Ejemplos

### 1. Sin cambio de moneda (pesos a pesos), comisión 20%

| Concepto | Monto |
|---|---|
| Lo que se envía | DOP 1,000.00 |
| Comisión del envío (20%) | DOP 200.00 |
| **Total que paga quien envía** | **DOP 1,200.00** |
| Lo que recibe la persona | DOP 1,000.00 |
| Ganancia por cambio | DOP 0.00 (no hay cambio) |

De dólares a dólares pasa lo mismo: 100 USD cobran 20 USD de comisión y no hay ganancia por cambio.

### 2. USD → DOP → EUR, comisión 5%, gestor 40% de la comisión

Quien envía da 100 USD para que alguien reciba euros.

1. La empresa **compra** los dólares a 58: 100 × 58 = **DOP 5,800.00**.
2. La empresa **vende** los euros a 70: 5,800 ÷ 70 = **EUR 82.86** (lo que recibe la persona).
3. Comisión: 5% de 100 = **USD 5.00**. Total que paga: **USD 105.00**.
4. Ganancia por cambio, en pesos:
   - por los dólares: 100 × (61 − 58) = DOP 300.00
   - por los euros: 82.86 × (70 − 66) = DOP 331.44
   - **total: DOP 631.44**
5. Reparto de la comisión de USD 5.00: gestor 40% = **USD 2.00**, empresa = **USD 3.00**.
   La ganancia por cambio (DOP 631.44) es toda de la empresa.

### 3. DOP → EUR

Quien envía da DOP 5,800.00. Los pesos ya son pesos (tasa 1), así que solo hay venta de euros:
recibe **EUR 82.86** y la ganancia por cambio es solo la de los euros: **DOP 331.44**.

### 4. Las tres casillas (orden de la pizarra: DF → DR → DT)

Con comisión 20% y DOP → EUR:

- **Escribo lo que se envía** (DOP 1,000.00): la comisión se suma y sale el total (DOP 1,200.00)
  y lo que recibe la persona.
- **Escribo el total que paga** (DOP 1,200.00): se saca la comisión y queda lo que se envía
  (DOP 1,000.00). Si el total no se puede partir exacto, se envía lo más que quepa sin pasarse
  del total escrito.
- **Escribo lo que recibe la persona** (EUR 82.86): se va hacia atrás por las tasas
  (82.86 × 70 = DOP 5,800.20 a enviar), se suma la comisión (DOP 1,160.04) y sale el total
  (DOP 6,960.24).

Cada casilla está en su moneda: lo que se envía y el total, en la moneda de quien envía; lo que
recibe, en la moneda de quien recibe. Las casillas calculadas muestran su valor y se pueden
cambiar: al escribir en otra, esa pasa a ser la escrita y las demás esperan el cálculo nuevo.

### 5. Comisión de entrega en el destino (ejemplo de la reunión)

100 USD a dólares con una entrega del 10%:

| Concepto | Monto |
|---|---|
| Lo que se envía | USD 100.00 |
| Comisión del envío (20%) | USD 20.00 |
| Total que paga quien envía | USD 120.00 |
| Comisión de entrega (10%) | − USD 10.00 |
| **Lo que recibe la persona** | **USD 90.00** |

Al pagar, la caja de quien entrega pierde USD 90.00, no 100. Si se escribe lo que recibe
(USD 90.00), la entrega se suma hacia atrás y sale lo que hay que enviar (USD 100.00).

### 6. Los tres redondeos de lo que recibe la persona

Para DOP 1,000.49:

| Redondeo | Recibe | Ajuste |
|---|---|---|
| Sin redondear (con centavos) — por defecto | DOP 1,000.49 | 0.00 |
| Normal (al entero más cercano) | DOP 1,000.00 | − 0.49 |
| Siempre hacia arriba (al entero siguiente) | DOP 1,001.00 | + 0.51 |

Con «Normal», la mitad sube: DOP 1,000.50 → DOP 1,001.00.

## Dónde se configura

**Configuración de administración → Comisiones de remesas** (solo Administración):

- **Comisión total de la transacción (%)**: la comisión del envío, la que se cobra a quien envía.
- **Comisión del gestor (%)**: la parte de esa comisión que es del gestor (de 0% a 100%).
- **Redondeo de lo que recibe la persona**: sin redondear, normal o siempre hacia arriba.
- **Comisiones de entrega en destino**: la lista de conceptos, con nombre y porcentaje; se pueden activar o desactivar.
  «Sin comisión» (0%) siempre sale de primero y por defecto, y no se puede cambiar.

En la ventana del envío, la casilla de **Comisión de entrega** ofrece los conceptos activos.

## Qué se guarda con cada envío

Montos (enviado, comisión, total, convertido, comisión de entrega, ajuste de redondeo y lo que recibe),
las tasas usadas, la casilla escrita y su valor, el concepto de entrega, la ganancia por cambio con sus
cuatro tasas, el reparto del gestor y la empresa, el dinero recibido y la devuelta, quién lo registró y
cuándo, y quién lo pagó y cuándo. Cambiar luego las tasas o la configuración **no cambia** los envíos ya
hechos. Los envíos anteriores al 29-10-2026 conservan sus números de siempre.

## Quién ve qué

Sin el permiso de ver comisiones, la ventana y los reportes no muestran el reparto del gestor ni la
ganancia por cambio; sí se ve la comisión de entrega y lo que recibe la persona.

## Reportes

- **Ganancia por cambio** (Reportes & Monitoreo → Reportes): lo que gana la empresa por el cambio, por
  envío y por par de monedas, en pesos.
- **Reporte consolidado de comisiones**: desde esta versión el reparto va en la moneda de la comisión
  (la de quien envía); el filtro se llama «Moneda de la comisión».

La ganancia por cambio sale solo cuando el día tiene registradas la **compra y la venta** de la moneda. Con una
tasa única (como la de los ejemplos de la demo) la ganancia es DOP 0.00.

## Recibo impreso

Solo montos: lo enviado, el cargo del envío, el total pagado, el cargo de entrega (si hay), lo que recibe
la persona, el dinero recibido y la devuelta. Sin tasas ni porcentajes. La pantalla conserva el detalle.

## Decisiones tomadas (lo más sencillo, por no estar claro)

- **Redondeo «normal» y «hacia arriba»** van al **entero** de la moneda (sin centavos). Por defecto se
  queda como antes, con centavos.
- **Ganancia por cambio** = (venta − compra) del mismo día, aplicada a cada lado con cambio de moneda:
  a lo que se envía (lado de compra) y a lo convertido (lado de venta). Los pesos no generan ganancia.
- **El gestor de antes** tenía un porcentaje del monto (por ejemplo 2% de un 5% total). Se pasa a la
  misma parte de la comisión (2 ÷ 5 = **40%**), así el gestor gana lo mismo que antes. Administración
  puede cambiarlo.
- **La comisión de entrega** es un **porcentaje** de lo convertido, como la comisión del envío.
- **El reparto del gestor** queda en la **moneda de quien envía**, que es en la que se cobra la comisión.
- **Con el teclado**, Intro salta las casillas calculadas (va de la casilla escrita a la siguiente
  parte del formulario); Tab y las flechas sí llegan a ellas para escribir allí.

## Pendiente (no se hace ahora)

- **Tasa preferencial** para ciertos clientes.
- **Usuario de entrega a domicilio.**

## Técnico

- Migración aditiva `app/server/database/044_remittance_calculation.sql`: solo añade columnas, la tabla
  de conceptos y comprobaciones; no borra ni recalcula nada.
- API: `GET /api/envios/cotizacion` acepta `amountMode=source|total|destination` y `deliveryConceptId`;
  `POST /api/envios` acepta `requestedTotalAmount` o `requestedReceiveAmount` (una sola casilla) y
  `deliveryConceptId`; `POST /api/envios/politica-comisiones` acepta `managerShareBps` y
  `receiveRounding`; `POST /api/envios/conceptos-entrega` (solo Administración) guarda un concepto.
- Todo el cálculo usa centavos enteros; las tasas, seis decimales.

## Capturas (revisión en Edge con la compilación como en Render, datos ficticios)

| Archivo | Qué muestra |
|---|---|
| `calculo-envios/1-configuracion-comisiones.png` | Comisiones de remesas: comisión 5%, gestor 40%, redondeo y conceptos de entrega |
| `calculo-envios/2-envio-usd-eur.png` | 100 USD → EUR 82.86, total USD 105.00 y ganancia por cambio DOP 631.44 (DT) |
| `calculo-envios/2b-envio-oscuro.png` | Lo mismo con el tema oscuro |
| `calculo-envios/3-envio-comision-entrega.png` | Con «Entrega a domicilio (10%)»: recibe EUR 74.57 |
| `calculo-envios/4-casilla-total.png` | Escribiendo el total (USD 210.00): se envían USD 200.00 |
| `calculo-envios/5-casilla-recibe.png` | Escribiendo lo que recibe (EUR 82.86): se envían USD 100.00 |
| `calculo-envios/6-confirmar-envio.png` | Confirmación con el reparto: gestor USD 2.00, empresa USD 3.00 |
| `calculo-envios/7-recibo-impreso.png` | Recibo impreso: solo montos, dinero recibido y devuelta |
| `calculo-envios/8-reporte-ganancia.png` | Reporte «Ganancia por cambio» |
| `calculo-envios/9-cobrador-envio.png` | Las tres casillas en el cobrador (teléfono) |
