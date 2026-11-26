# La identificación en el Listado de Clientes (protocolo 0.10)

Plan escrito por Claude Code (Opus 5.5) el 2026-11-26, en la laptop de Rardiel, sobre `main` `5bd9715` (protocolo 0.9).
Cambio pequeño: una sola etapa de revisión EGM (ver `goldfish_review_report.md`). Esta es la versión que se programó.

## De dónde sale

Rardiel, 2026-11-26: «Él vino y me dijo esto, ahora bien confírmame si ya está. También él me dijo esto luego por chat»,
con un audio (transcrito por máquina en la laptop; no va a este repositorio) y capturas de WhatsApp de la otra parte:

- «Busco bien por identificación» (con la cédula `1234` de Colmado La Esquina) y «Busco bien también» (por teléfono).
- «Entonces lo de la búsqueda esta bien», «Arregle lo de la respuesta», «Incluya la identificacion», «Que seria el campo
  cédula o pasaporte».
- Una foto con el registro que quiere: `ID CLIENTE;CODIGO;NOMBRE;IDENTIFICACION;TELEFONO;DIRECCION`, con el ejemplo
  `9;CL-0002;María Rodríguez;054-2205445-1;8092201111;Calle Las Damas 18`.

En el audio, anterior al chat, propuso un parámetro para decir si se busca por identificación o por teléfono. Lo
sustituye su chat posterior: la búsqueda ya está bien. No se hace.

## Lo comprobado

- El registro del Listado de Clientes es `idCliente;Codigo;Nombre;Telefono;Direccion` (`text-protocol-routes.ts`,
  `clients`; `listRemittanceClients` en `remittance-client-search.ts` no devuelve la identificación).
- La identificación es `client.identification`; Datos del Cliente ya la da (4.º dato).
- La web, al crear un cliente sin cédula, copia la identificación interna en la cédula (`App.tsx`): esa
  «Identificacion» puede valer `INT00000031`, que no es una cédula ni un pasaporte.

## Qué se hace

El registro pasa a `idCliente;Codigo;Nombre;Identificacion;Telefono;Direccion`: **la Identificacion va en el cuarto
lugar, donde la pide la otra parte**, no al final. Es un cambio de posición: Telefono y Direccion pasan al 5.º y 6.º.
Lo pide quien programa la aplicación y la está ajustando ahora; el contrato lo dice en «Lo nuevo».

- Una identificación igual a la identificación interna **del mismo cliente** sale vacía (`identityOf`), en el listado,
  en Datos del Cliente y en el dato 20 de un envío (comparada con la del destinatario): es la copia que hace la web al
  pulsar «Generar identificación» en un cliente nuevo sin cédula. Otro texto con forma `INT…` se queda: puede ser un
  documento real (la revisión lo señaló; la primera versión vaciaba toda forma `INT`).
- Sin migración, sin tocar la web ni la búsqueda.

| Archivo | Cambio |
| --- | --- |
| `app/server/src/remittance-client-search.ts` (modificar) | `listRemittanceClients` devuelve también la identificación. |
| `app/server/src/text-protocol-routes.ts` (modificar) | El registro con la Identificacion; `identityOf` para la `INT` copiada. |
| `app/server/test/text-protocol.test.ts` (modificar) | Los listados con 6 datos; la `INT` copiada sale vacía. |
| `docs/protocolo-cyp/Protocolo CYP 0.10.txt` (renombrar desde la 0.9) | 2.1, pasos, «Lo nuevo», ejemplos. |
| `docs/PROTOCOLO-TEXTO-PLANO.md`, `docs/API_CONTRACTS.md` (modificar) | Al día; «Antes de producción». |

## Lo que cuesta

- Una aplicación que lea el Telefono en el 4.º dato lee ahora la Identificacion: la otra parte tiene que cambiar su
  lectura (es lo que pide).
- El listado lleva las cédulas de hasta 100 clientes por petición. Va a «Antes de producción», junto a teléfonos y
  direcciones.

## Pruebas

- El listado con 6 datos, la Identificacion en el 4.º; vacía si no hay o si es una `INT` copiada; Datos del Cliente igual.
- Las pruebas de antes con la posición nueva.
- Suite del servidor, tipos, compilación pública y arranque real con PostgreSQL.
- En la demo, solo leyendo: todos los clientes con 6 datos; el de la foto con su cédula en el 4.º.
