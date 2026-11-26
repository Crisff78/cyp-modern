# El idMoneda como número (protocolo 0.11)

Plan escrito por Claude Code (Opus 5.5) el 2026-11-26, en la laptop de Rardiel, sobre `main` `d608234` (protocolo 0.10).
Cambio pequeño: una sola etapa de revisión EGM (ver `goldfish_review_report.md`). Esta es la versión que se programó.

## De dónde sale

Rardiel, 2026-11-26: «También me dijeron eso», con una foto de la respuesta de `/cyp_currencies`
(`DOP;Peso Dominicano!USD;Dólar Americano!EUR;Euro`) y este texto de la otra parte: «No mandas el ID de la moneda».

## Lo comprobado

- El Listado de Monedas responde `idMoneda;Nombre`, y el `idMoneda` es el código `DOP`, `USD` o `EUR`
  (`text-protocol-routes.ts`, `currencyList`).
- En el sistema viejo, la tabla `Monedas` tiene las columnas `Abrev`, `idMoneda` y `Moneda`
  (`legacy/database/table_summary.json`). El id va aparte de la abreviatura. Ese archivo da solo los nombres de las
  columnas, en orden alfabético; no consta su tipo, su orden ni sus valores.
- En LSAN 1.14, el ejemplo que mandó la otra parte (`lomovil.com/apps/proto.txt`, leído hoy en la laptop), `idMoneda` es
  un número: «Si idMoneda no se especifica se asumirá 1 por defecto». No trae lista de monedas ni dice el número del
  dólar o el euro.
- El contrato 0.10 ya lo tenía como pregunta 5, sin respuesta: «Si prefiere números, ¿cuáles usa para Dólar y para Euro?».
- Dónde entra o sale una moneda en el protocolo (comprobado por los dos revisores, sin que falte ninguna):
  - entra en Cotizar y Registrar Envío (`idMonedaOrigen`, `idMonedaDestino`) y en Tasas Vigentes (`idMoneda`), las tres
    por `currencyOf`;
  - sale en el Listado de Monedas; en Tasas Vigentes (1.er dato); en Datos del Cliente (8.º); en el registro de un envío
    (datos 12 y 16, en Recibos, Envíos por Entregar y Entregar Envío, todos por `receiptOf`);
  - sale también en el Dato de tres errores: `TNE` de Tasas Vigentes, y `CNA` y `CSF` de Entregar Envío. Los demás
    errores no llevan la moneda (el `TNE` de Cotizar y Registrar va sin Dato).

## Qué se hace

Lo mismo que con el `idCliente` en la 0.8: el `idMoneda` del protocolo pasa a ser un número.

- **Números fijos: 1 = DOP, 2 = USD, 3 = EUR.** El 1 es el peso, como en LSAN; los otros dos siguen el orden del listado.
  Es una decisión de Claude, porque la otra parte no ha dicho sus números. El contrato los deja como pregunta 5, para
  que los confirme. El mensaje le pide que avise si su aplicación usa otros: cambiarlos es una tabla (`CURRENCY_IDS`,
  un `Map`). Una vez que los confirme, no se cambian nunca: un envío repetido entraría en otra moneda.
- **Listado de Monedas:** `idMoneda;Nombre;Codigo`, por ejemplo `1;Peso Dominicano;DOP`. El Nombre se queda en el
  segundo lugar, donde estaba, y el código va al final, como dice el contrato que se agregan los datos. La aplicación
  puede mostrar el código.
- **Todas las salidas que el contrato llama `idMoneda…` llevan el número.** Eso incluye Tasas Vigentes, Datos del
  Cliente (1 si el cliente no tiene moneda), los datos 12 y 16 de un envío y el Dato de `CNA` y `CSF`, que sale del envío.
  El texto de esos errores conserva el código («… en USD»), que se lee mejor.
- **El Dato de `TNE` es la moneda tal como llegó**, como el Dato de un error del `idCliente` desde la 0.8.
- **Las entradas aceptan el número o el código de antes** (`currencyOf`). Cualquier otro valor da `PIN`, como hoy: `usd`,
  `01`, `0`, `4`, `constructor`. Vacío sigue como hoy: en Tasas Vigentes trae todas las tasas, y en Cotizar y Registrar
  falta el dato (`PIN`). No se toma 1 por defecto como en LSAN.
- **La huella de Registrar Envío cuenta la moneda por su código.** Antes de este cambio solo entraban códigos, así que
  las huellas guardadas siguen valiendo, y repetir un envío con `USD` o con `2` es el mismo envío. Es una excepción a
  «carácter por carácter» (3.2 c), y el contrato la dice.
- Entregar Envío repetido ya vuelve a armar su registro desde el envío (0.8): saldrá con los números.
- Sin migración. La web y la API JSON no cambian.

| Archivo | Cambio |
| --- | --- |
| `app/server/src/text-protocol-routes.ts` (modificar) | `CURRENCY_IDS` y su inversa; `currencyOf` acepta las dos formas; el número en cada salida; la huella con el código. |
| `app/server/src/text-protocol.ts` (modificar) | El encabezado cita la 0.11. |
| `app/server/test/text-protocol.test.ts` (modificar) | Las salidas con número; las entradas por número y por código; los `PIN`; la huella; la entrega repetida. |
| `app/server/test/text-protocol-format.test.ts` (modificar) | Un `2` en Tasas o en Cotizar no se toma por VersionApp. |
| `docs/protocolo-cyp/Protocolo CYP 0.11.txt` (renombrar desde la 0.10) | Formato de los datos (con «No lo arme»); 2.2; 3.2 c; la tabla de datos de Registrar Envío; 5.1 y 5.2 (CNA, CSF); 6.1; 6.2; «Lo nuevo» y su párrafo final; pregunta 5. |
| `docs/PROTOCOLO-TEXTO-PLANO.md`, `docs/API_CONTRACTS.md` (modificar) | Al día. |

«Lo nuevo» sigue marcando lo nuevo desde la 0.7: consta que Rardiel le mandó la 0.7; de la 0.8 a la 0.10 no consta.

## Otras formas que se descartaron

- **Contestarle que `DOP` ya es el id.** Él pide un id aparte, y LSAN usa números.
- **Poner el número solo en el listado y aceptarlo en las entradas, pero dejar el código en las otras salidas.** Así
  la aplicación tendría que traducir los códigos de tasas y envíos a su id. Además, el mismo nombre (`idMoneda`) valdría
  cosas distintas según la respuesta.
- **`idMoneda;Codigo;Nombre`.** Movería el Nombre de lugar en una respuesta que la aplicación ya lee.

## Lo que cuesta

- Lo que la aplicación lee hoy como `DOP`, `USD` o `EUR` le llega como número: el primer dato del Listado de Monedas y
  de Tasas Vigentes, la moneda de Datos del Cliente y los datos 12 y 16 de un envío. Tiene que leerlo así, y mostrarlo
  con el Nombre o el Código del Listado de Monedas. Hasta que lo cambie, su pantalla de Envíos por Entregar mostrará
  «1» o «2» en vez de «DOP» o «USD». El contrato lo dice con un OJO.
- Si su aplicación usa otros números para el dólar y el euro, hay que cambiarlos aquí antes de que los use de verdad.

## Pruebas

- Listado de Monedas: tres datos, con los números 1, 2 y 3 delante y el código al final.
- Tasas Vigentes por número y por código: la misma respuesta, con el número delante. `TNE` trae la moneda como llegó.
- Cotizar con números: el mismo resultado que con los códigos. `01`, `0`, `4`, `usd`, `constructor` y `__proto__` dan
  `PIN`.
- Registrar Envío con números y repetido con códigos: el mismo envío.
- Datos del Cliente con la moneda en número (1 si no tiene). Los envíos llevan los números en los datos 12 y 16, también
  al repetir una entrega. `CNA` y `CSF` llevan el número en el Dato.
- `withoutVersion` no toca `s|2` en Tasas ni `s|2|1|100.00` en Cotizar.
- Suite del servidor, tipos, compilación pública y arranque real con PostgreSQL.
- En la demo, solo leyendo: monedas `1`, `2` y `3`; tasas por `2` igual que por `USD`; cotizar con `2|1` igual que con
  `USD|DOP`.
