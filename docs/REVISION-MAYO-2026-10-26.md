# Revisión parcial de Mayo (26-10-2026)

Papel «Revisión parcial C y P día 26 del mes de octubre del 2026», entregado por Rardiel el 29-10-2026 (la primera
revisión del 26-10, la de Dionel, está en `REVISION-DIONEL-2026-10-26.md`). Notas a mano en el papel: «¿Permiso?»
junto a 2.1.4 y «RRAA» junto a 4.2.

## Antes de cambiar nada (29-10-2026, `main` `4260e52` = demo `0fbc5d5`)

Comprobado en el código y en la copia local (compilación como en Render, PostgreSQL desechable, Edge).

| # | Pide | Estado | Prueba |
|---|---|---|---|
| 1.1.1 | Envío de dinero: al modificar un dato o Calcular cotización, volver arriba del formulario y no al listado | Falta | Tras «Calcular cotización» el formulario baja hasta «Revisar y confirmar envío», pegado al listado (`RemittancesWorkspace.tsx`: `scrollIntoView` del botón y `focus()`) |
| 1.1.2 | No activar «Revisar y confirmar envío» sin caja abierta del gestor | A medias | Sale el aviso «No hay caja de remesas abierta hoy…», pero el botón sigue activo (`disabled={working \|\| uncertain}`); el servidor lo rechaza al final con `CASH_NOT_OPEN` |
| 2.1.1 | Caja de remesas: botón de búsqueda al elegir cobrador y monedas | Falta | La sección lista todas las cajas de todas las fechas, sin filtro de cobrador, moneda ni fecha |
| 2.1.2 | Caja de remesas: espacio para el acumulado de las entregas adicionales a la apertura, en la fecha consultada | Falta | La caja solo tiene Apertura, Ingresos por envíos, Devoluciones y Pagos; no se pueden registrar entregas adicionales |
| 2.1.3 | El importe inicial de una fecha es el cierre de la fecha anterior, si no se le descargó al cobrador | Falta | La apertura es lo que se escriba; no se toma el cierre anterior y no existe el descargo |
| 2.1.4 | Al abrir el día, traer el importe final del día anterior y que no sea editable («¿Permiso?») | Falta | «Efectivo inicial» sale en 0.00 y lo puede cambiar cualquiera que abra la caja |
| 3.1.1 | Tasas: editar la tasa del día no sustituye la actual: genera una nueva e inhabilita Editar en la editada | A medias | El cambio queda en el historial (plegado abajo), pero en el listado la fila del día se sustituye y su Editar sigue activo |
| 3.1.2 | Tasas: al abrir el día no obligar a poner tasa; traer la última de cada moneda | A medias | Los envíos ya usan la última tasa registrada aunque sea de días anteriores (`latestRate`, `REMESAS-TASAS-VIGENTES.md`), pero «Nuevo» abre vacío y en un día nuevo «Editar» queda desactivado |
| 4.1 | Destacar en ubicación y tamaño el logo del cliente en el dashboard | Falta | El logo de Configuración solo sale pequeño en la esquina del menú; el escritorio está vacío |
| 4.2 | Módulo de Soporte técnico en el panel de módulos de la izquierda («RRAA») | A medias | «Soporte Técnico» existe, pero al pie del menú, separado de los módulos |
| 5.1 | En todos los filtros, editar la fecha eligiendo día, mes o año y escribiendo, sin obligar al calendario | A medias | Con el ratón ya funciona (Cobros: clic en el día y «03» → 2026-10-03). Con el teclado, ← → salen del campo (regla del 28-10), así que no se llega al mes ni al año sin el ratón |

## Qué se hizo

| # | Ahora | Dónde | Captura |
|---|---|---|---|
| 1.1.1 | Al calcular la cotización, o al cambiar un dato después, el formulario vuelve arriba (remitente, destinatario y los importes ya calculados). Intro sigue yendo a «Revisar y confirmar envío», sin bajar la ventana hasta él | `RemittancesWorkspace.tsx` | `8-envios-cotizado-arriba.png` |
| 1.1.2 | Sin la caja de hoy del operador (en la moneda del envío), «Revisar y confirmar envío» queda desactivado y al pasar el puntero dice por qué. Se puede cotizar igual. Al abrir la caja y pulsar Actualizar, se activa | `RemittancesWorkspace.tsx` | `3-envios-sin-caja.png` |
| 2.1.1 | Caja de remesas tiene **Fecha**, **Operador** (solo Administración), **Moneda** y **Buscar**, con el embudo para ocultarlos. Empieza en la fecha de operación; en la de hoy también sale una caja que siga abierta de un día anterior, porque hay que cerrarla | `RemittancesWorkspace.tsx`, `cashNotice.ts` | `6-caja-buscar.png` |
| 2.1.2 | «Entrega adicional» en la caja abierta de hoy: importe y nota opcional, con revisión y confirmación. Cada caja muestra «Entregas adicionales», el acumulado de la fecha consultada, y se suma al efectivo esperado. También sale en el reporte «Caja de remesas» | Servidor: `POST /api/envios/cajas/:id/entregas`; `remittances.ts`, `reporting.ts` | `5-caja-entrega-adicional.png` |
| 2.1.3 | Al cerrar, «Descargado al cobrador» (opcional): lo que se le retira al operador. La caja cerrada muestra lo descargado y «Pasa a la próxima apertura» (contado − descargado). La caja siguiente del mismo operador y moneda empieza con ese importe y dice de qué cierre viene | `closeRemittanceCash`, `remittanceOpeningCarry` | `5-caja-entrega-adicional.png`, `10-cajero-apertura.png` |
| 2.1.4 | Al abrir el día, «Efectivo inicial» trae el cierre anterior y no se puede escribir. Solo una cuenta con el permiso nuevo **«Cambiar el efectivo inicial de la caja de remesas»** lo cambia: Administración lo tiene por su rol; a un cajero se le da como permiso adicional. El servidor rechaza otro importe (`OPENING_FIXED`). La primera caja de un operador en una moneda se escribe | `shared/access.mjs`, `openRemittanceCash`, migración `045` | `4-caja-apertura-administracion.png`, `10-cajero-apertura.png` |
| 3.1.1 | Tasas: cada registro es una fila. Editar guarda una tasa nueva; la editada se queda en el listado como **Sustituida**, atenuada y con Editar desactivado (también el doble clic). Solo se edita la **Vigente** de cada moneda | `ConnectedExchangeRates.tsx` (`rateRows`) | `9-tasas.png` |
| 3.1.2 | No hace falta registrar una tasa al abrir el día: la ventana dice qué tasa de cada moneda se usa hoy, y «Nuevo» y «Editar» empiezan con la vigente. En un día nuevo se puede editar la vigente aunque sea de un día anterior; se guarda como tasa de hoy | `ConnectedExchangeRates.tsx` | `9-tasas.png` |
| 4.1 | El logo de la empresa (Configuración General) sale grande en el centro del escritorio, con su nombre, detrás de las ventanas. En el menú, un poco más grande (52 px) | `components.tsx` (`CompanyDesktopBrand`), `styles.css` | `1-escritorio-logo-y-soporte.png` |
| 4.2 | **Soporte Técnico** es un módulo más del panel de la izquierda, después de Monitoreo, con el mismo aspecto que los demás. Abre la misma ventana de soporte. Ya no está repetido al pie del menú | `App.tsx` | `1-escritorio-logo-y-soporte.png`, `2-soporte-tecnico.png` |
| 5.1 | En todas las fechas, ← → pasan por el día, el mes y el año, y cada parte se escribe sin abrir el calendario. Desde el día ← y desde el año → siguen al campo de al lado. Un clic elige la parte que está debajo, y escribir de corrido sigue llenando las tres partes. En Caja de remesas, la fecha guarda exactamente lo que se escribe | `shared/keyboard.ts`, `TECLADO-COMPLETO.md` | `7-fecha-por-partes.png` |

## Lecturas elegidas

- **«¿Permiso?» (2.1.4).** El importe de apertura queda fijo y solo lo cambia quien tenga el permiso nuevo. Administración lo
  tiene por su rol, como todos los permisos de Remesas; para quitárselo a una cuenta, sus permisos se personalizan.
- **«Descargar al cobrador» (2.1.3).** Se registra al cerrar la caja, en «Descargado al cobrador». Lo que no se descarga pasa
  entero a la próxima apertura. Los descargos no se pueden borrar ni cambiar, como el resto del libro de remesas.
- **«Entregas adicionales» (2.1.2).** Es el efectivo que se le da a la caja abierta después de abrirla. Quien puede abrir una
  caja puede entregarle: Administración a cualquiera; un cajero a la suya.
- **«RRAA» (4.2).** El soporte es el del proveedor. Sus datos de contacto se escriben en Configuración General → Soporte
  técnico y se guardan en la base de datos, nunca en el código ni en Git.

## Base de datos

Migración aditiva `045_remittance_cash_carry.sql`:

- columna `remittance_cash_sessions.carried_from`;
- tabla `remittance_cash_movements` (entregas adicionales y descargos), solo de inserción, con el mismo bloqueo de cambios
  que el resto de las remesas;
- la lista de permisos de remesas admitidos en `users` crece en uno, `remittances.cash.opening.edit`.

Nada se borra ni cambia de lo guardado antes. Las cajas anteriores no tienen `carried_from`.

Las capturas están en `docs/revision-mayo-2026-10-26/`. Vienen de la compilación como en Render, con PostgreSQL desechable y datos ficticios. Para la 10 se puso en esa base local una caja de ayer del cajero de práctica, cerrada con 1,000.00 y 200.00 descargados.

## Cambio posterior del punto 4.1 (30-10-2026)

Por orden de Rardiel, el escritorio ya no muestra el logo de la empresa: en la nube salía el de Gamera. El logo de la
empresa sigue en Configuración General y en los recibos. En su lugar, la portada de Cobros y Pagos va en la esquina de
abajo a la derecha, como en Préstamos SAN, con la versión del programa. En la esquina del menú queda siempre el logo de
CyP. Capturas en `escritorio-portada-2026-10-30/`.
