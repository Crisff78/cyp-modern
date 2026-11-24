# Listado de Clientes con teléfono y dirección, e `idCliente` corto (protocolo 0.6)

Plan escrito por Claude Code (Fable 5.2) el 2026-11-24, en la laptop de Rardiel, sobre `main` `07d3ef8`. Esta versión
describe lo construido, con los hallazgos de la revisión resueltos (`goldfish_review_report.md`).

## De dónde sale

Rardiel mandó el 2026-11-24 capturas de su chat con quien programa la aplicación móvil («Me dijeron esto»). La otra
parte, sobre la respuesta de `cyp_clients`:

- «En esa pericion falta información A devolver», «Póngale el número de teléfono y la direccion», «Para completar los
  datos del remitente», «Como lo hace en el área del remitente y destinatario Que se busca la informacion del cliente».
- «Y si ese es el ID del cliente creo que es muy grande», «Debería reducirlo» (señalando un id de 36 caracteres).

Rardiel le respondió: «Esta bien yo se lo implemento».

## Lo comprobado

- `cyp_clients` devolvía por cliente `idCliente;Codigo;Nombre`. El teléfono y la dirección ya existían en el protocolo,
  cliente por cliente: `cyp_client` (2.2 del contrato). El contrato decía en 2.1: «La identificación, los teléfonos y
  la dirección NO vienen en el listado».
- En la web pasa igual: la búsqueda (`/api/envios/clientes/buscar`) devuelve solo ids, y el teléfono y la dirección
  salen al elegir un cliente (`/api/envios/clientes/:id/contacto`). Un Cajero no ve ninguna lista de clientes con esos
  datos (su `snapshot` no trae clientes; `access.ts` los oculta a quien no tiene el permiso 140).
- La web enseña un solo teléfono: `client.phone || client.cellular` (`app/client-admin/src/App.tsx:2445`).
- El `id` de un cliente creado en la web es un UUID (36 caracteres). Todo cliente creado en la web, por Clientes
  (`app.ts:985`) o desde Envíos (`remittance-client-registration.ts`), recibe además una **identificación interna**:
  `INT` y de 8 a 16 cifras (`INT00000012`). En PostgreSQL es única y no se puede cambiar (migración 029); en memoria lo
  cuida `client-identities.ts`.
- **No todos la tienen.** Los clientes de las semillas, los importados (`legacy-import.mjs`) y los anteriores a la
  migración 029 no tienen identificación interna. En la demo, leído el 2026-11-24: de 45 clientes, 1 la tiene (el que
  señaló la otra parte) y 44 no; sus ids miden 5, 17 y 27 caracteres. Ningún `id` choca con una identificación interna.

## Qué se hace

Sin migración y sin tocar la web.

| Archivo | Cambio |
| --- | --- |
| `app/server/src/remittance-client-search.ts` | `listRemittanceClients` devuelve también identificación interna, teléfono (`phone \|\| cellular`) y dirección. |
| `app/server/src/text-protocol-routes.ts` | `clientIdOf` y `clientOf`; listado con 5 datos; ids cortos en `client`, `send` y `recs`. |
| `app/server/src/client-identities.ts` | Una identificación nueva no repite el `id` de ningún cliente; `assignMissingClientIdentities`. |
| `app/server/src/index.ts` | La demo pública da identificación interna a los clientes que no la tengan. |
| `app/server/test/…` | Pruebas del protocolo, de la asignación y del arranque de la demo. |
| `docs/protocolo-cyp/Protocolo CYP 0.6.txt` | Renombrado desde la 0.5, con lo nuevo marcado. |
| `docs/PROTOCOLO-TEXTO-PLANO.md`, `docs/API_CONTRACTS.md` | Al día. |

1. **Listado de Clientes.** Cada cliente pasa a `idCliente;Codigo;Nombre;Telefono;Direccion`. `Telefono` es el que
   enseña la web; los dos pueden venir vacíos. Van al final del registro, como ya permite el contrato.
2. **`idCliente` corto.** En el protocolo, el `idCliente` de un cliente es su identificación interna y, si no tiene, su
   `id`. `clientOf` resuelve lo que manda la aplicación: por identificación interna solo si el texto tiene esa forma
   (`^INT[0-9]{8,16}$`) y, si no, por `id`. No lanza error: un texto que no es de nadie sigue su camino. Así:
   - `cyp_clients` y `cyp_client` devuelven el corto; `cyp_client` lo devuelve aunque se pida con el largo;
   - `cyp_client` y `cyp_send` aceptan el corto y el largo de antes;
   - `cyp_recs` devuelve el corto, con un mapa hecho una vez por petición;
   - el Dato de `CNE`, `CIN` y `CFR` es el texto tal como llegó;
   - la moneda de Datos del Cliente se busca por el cliente ya resuelto.
3. **Orden al registrar.** No cambia: datos mal escritos, `idOperacion` ya usada y, después, los clientes. La resolución
   va dentro de la transacción y detrás del `idOperacion`. `MCL` se decide con los clientes resueltos: el mismo cliente
   por sus dos ids es `MCL`, y dos textos iguales que no son de nadie también, como antes. `createRemittance` recibe los
   `id` internos.
4. **`idOperacion`.** La huella sigue siendo el texto de la petición. Repetir un envío con la otra forma del id es `OPD`
   con el `NumEnvio`; no se registra otro. El contrato lo dice.
5. **Choque de ids.** `taken()` mira también el `id` de los clientes: ninguna identificación interna nueva puede repetir
   el `id` de un cliente.
6. **Demo pública.** En cada arranque, `assignMissingClientIdentities` da identificación interna a los clientes que no
   la tengan, cada uno con su reserva y sin tocar su código, como hace la web. Es un dato, no esquema. Así en la central
   de pruebas todos los `idCliente` miden 11 caracteres.
7. **Contrato 0.6.** Lo nuevo desde la 0.5 va marcado con `(NUEVO)`; se quita la marca de la 0.5. El contrato no promete
   el formato: dice «normalmente 11 caracteres», que sigue siendo un texto de hasta 80, que no se arma ni se saca del
   `Codigo`, y que si la central devuelve otro `idCliente` para un cliente hay que usar el nuevo.

## Lo que cuesta

- **El listado pasa a llevar teléfonos y direcciones de hasta 100 clientes por petición.** Los mismos usuarios ya podían
  pedirlos cliente por cliente, así que no se abre ningún dato nuevo, pero se sacan cien veces más rápido; un Cobrador,
  con `Lado` 1, los de clientes de otras rutas. En la web un Cajero no los ve en ninguna lista. Lo pide la otra parte y
  Rardiel aceptó hacerlo. Queda anotado en «Antes de producción», con una salida barata.
- Fuera de la demo, un cliente sin identificación interna conserva su `id`, que puede ser largo. Si después se le da una
  en la web, su `idCliente` cambia una vez; el anterior sigue valiendo.
- En la demo, 44 clientes reciben identificación interna y 44 reservas. No se puede deshacer (son inmutables).
- `idEnvio` e `idUsuario` siguen pudiendo tener 36 caracteres. No se pidió cambiarlos y ninguna petición los recibe.

## Lo que no se hace

- **Un número suelto como id** (`12`), o el UUID en otra codificación (22 a 26 caracteres).
- **Migración o columna nueva.**
- **Usar el `Codigo` como id:** se puede editar y puede llevar separadores.
- **Vaciar el teléfono y la dirección a un Cobrador para clientes de otra ruta:** la otra parte pidió remitente y
  destinatario. Se deja como salida para una central real.
- **Dar identificación interna a todos fuera de la demo:** hoy no hay otra central; queda en «Antes de producción».
- **Quitar `cyp_client`:** sigue trayendo la identificación, los dos teléfonos y la moneda.

## Pruebas

- Listado: 5 datos por cliente; teléfono fijo, o el celular si no hay fijo; separadores y saltos en la dirección, limpios.
- Cliente con identificación interna: el listado y Datos del Cliente devuelven `INT…`; se acepta por `INT…` y por el id
  largo; la moneda sale bien (EUR); `int…` en minúsculas es `CNE`.
- Registrar con los ids cortos guarda los `id` internos; `MCL` por las dos formas y con dos textos iguales que no
  existen; Dato de `CNE`, `CIN` y `CFR` tal como llegó; repetición idéntica con el destinatario ya inactivo, `OK`;
  mismo `idOperacion` con la otra forma, `OPD` y ningún envío nuevo.
- Recibos: `idRemitente` e `idDestinatario` cortos.
- Asignación: todos reciben la suya, sin repetir, sin tocar códigos; un segundo arranque no cambia nada; una
  identificación nueva no repite un `id`.
- Toda la suite del servidor, tipos y compilación pública.
- Arranque real con PostgreSQL: una base sembrada con el código anterior (como Render, 44 clientes sin identificación) y
  una base nueva. En las dos, los 44 quedan con `INT…`; el segundo arranque no cambia nada.
- Después de publicar, en la demo con `cob`: todos los clientes con 5 datos e `idCliente` de 11 caracteres, y uno de
  ellos sirve en Datos del Cliente.
