# Tasa de quien recibe y año de las fechas (30-10-2026)

Dos correcciones pedidas por Rardiel el 30-10-2026.

## 1. Quien recibe usa siempre la tasa de venta

Orden de Rardiel: «En el único caso que no se cobra la tasa es cuando es de peso dominicano a peso
dominicano porque ahí es siempre de 1 a 1».

- **Antes:** de dólares a dólares y de euros a euros, el programa usaba la tasa de compra en los dos lados.
  Era una regla anterior: con la misma moneda, sin cambio. Por eso, en la nube, el lado de quien recibe
  euros mostraba 69 en vez de 75.
- **Ahora:** todo pasa por pesos:
  - la moneda de quien envía se **compra** (tasa de compra);
  - la de quien recibe se **vende** (tasa de venta), también de USD a USD y de EUR a EUR;
  - solo de **DOP a DOP** es 1 a 1.
- **La casilla que se escribe no cambia las tasas.** Da igual que sea lo que se envía, el total o lo que
  recibe la persona. Comprobado en las 27 combinaciones de monedas y casillas.

Ejemplos con las tasas de la nube (USD 60.50/62.90, EUR 69.00/75.00) y comisión del 10%, escribiendo el
**Total a pagar** 100.00:

| Envío | Se envía | Tasa de quien envía | Tasa de quien recibe | Recibe |
|---|---|---|---|---|
| USD → USD | 90.91 | 60.5 DOP (compra) | 62.9 DOP (venta) | USD 87.44 |
| EUR → EUR | 90.91 | 69 DOP (compra) | 75 DOP (venta) | EUR 83.64 |
| USD → EUR | 90.91 | 60.5 DOP (compra) | 75 DOP (venta) | EUR 73.33 |
| DOP → DOP (total 1,100.00) | 1,000.00 | 1 | 1 | DOP 1,000.00 |

Capturas: `tasa-y-anio-2026-10-30/1-usd-usd-total.png` a `4-dop-dop-total.png`.

Los envíos ya guardados conservan sus tasas: este cambio vale para los envíos nuevos.

## 2. El año se escribe de izquierda a derecha

El campo de fecha del navegador llenaba el año desde la derecha. Al escribir 2 y 0 salía «0002» y luego
«0020». Ahora, en todas las fechas del sistema (también las de los filtros y las del cobrador):

- con **dos cifras**, «26» es **2026**;
- con **cuatro cifras**, «2026» es 2026;
- nunca sale «0002» ni «0020». Con una o tres cifras se espera a la siguiente.

El día y el mes se escriben como antes. ← → siguen pasando por día, mes y año.

Capturas: `tasa-y-anio-2026-10-30/5-anio-dos-cifras.png` y `6-anio-cuatro-cifras.png`.

## Pruebas

- Servidor:
  - `remittance-calculation.test.ts` 12 y 13: todas las combinaciones, en las tres casillas, con las tasas
    de la nube;
  - `remittance-payments.test.ts`: de dólares a dólares ya hay cambio.
- Interfaz, `revision-mayo-ui.test.ts`: «26» es 2026, «2026» también, y una fecha vacía.
- Revisión en Edge con la compilación como en Render: los cinco casos correctos y ningún error de página.
