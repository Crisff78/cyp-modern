# CyP solo con el teclado, con teclas sencillas (27-10-2026)

Pedido de Rardiel el 27-10-2026: que toda la aplicación se pueda usar entera solo con el teclado, porque los cajeros
trabajan sin ratón («debe ser así para toda la aplicación, solo te puse al cajero como ejemplo»).

La primera versión (PR #65/#66) usaba teclas F (F2 Nuevo, F9 Guardar, F10 menú…) y dibujaba la tecla en la esquina de
cada botón. Rardiel la corrigió el mismo día: **solo teclas sencillas**, las que cualquiera usa rápido y sin
memorizar —las flechas, Intro, Tab, Esc—, pensando en quien no ve bien o no lee, y **sin señales en pantalla** («se ve
feo y no aporta realmente»), salvo que su jefe pida lo contrario (PR #67/#68).

Esa versión movía el teclado con código hecho a mano y Rardiel vio que no era cómoda ni funcionaba bien («Creo que es
mejor buscar un repositorio o alguna herramienta la cual podamos integrar y lo haga por nosotros»). Desde esta versión
el teclado lo mueve **[Tabster](https://github.com/microsoft/tabster)** (de Microsoft, licencia MIT, `tabster@8.8.1`),
la misma herramienta sobre la que está hecho el teclado de Fluent UI. Las teclas no cambian.

**Resultado:** las mismas cinco teclas en todas las ventanas del portal (las 55 que se abren desde el menú,
Configuración de administración y Reportes), en sus diálogos, en la cabecera y en la app del cobrador. No se dibuja
nada nuevo en la pantalla: solo el marco del elemento que tiene el teclado, como siempre. Tres pruebas lo recorren sin
un solo clic y sin teclas F ni combinaciones: el Cajero de punta a punta, el Administrador y todas las ventanas una por
una.

**Ajustes del 28-10-2026** (pedido de Rardiel con fotos del Panel de Filtro de Cargos y Cargos Recurrentes y la
pizarra de Envíos): Intro hace lo mismo que Tab para pasar de campo; una lista para elegir (Estado, Moneda, Zona…) se
abre con ↓ y muestra todas sus opciones, como con el ratón; Tab ya no se escapa de la página (el navegador se quedaba
el teclado hasta un clic): al final de la ventana vuelve a su primera opción; y Envíos de dinero sigue el orden de la
pizarra: DF, el dinero a enviar → DR, el dinero que se recibe → DT, la tasa.

**De punta a punta (28-10-2026, goal de Rardiel):** «Debes revisar todo el flujo de verdad con el teclado». Intro ya
no se queda quieto en ningún sitio (en Envíos se paraba en «Moneda del destinatario»); las flechas ← → sirven para ir
atrás y adelante en todas partes; tras un clic en el fondo, la primera tecla devuelve el teclado (antes la pantalla no
respondía), y empieza donde está el ratón; y todo se recorre de inicio a fin y de fin a inicio, también en la app del
cobrador.

Para repartir a los cajeros: [hoja de una página](teclado-completo/hoja-atajos-cajeros.pdf)
([versión HTML](teclado-completo/hoja-atajos-cajeros.html)).

## Las teclas

| Tecla | Qué hace |
|---|---|
| ↑ ↓ | Moverse en el menú, en las listas y entre campos de una línea. En una lista para elegir, ↓ la abre |
| ← → | Atrás y adelante, en todas partes (como Mayús+Tab y Tab). En lo escrito mueven el cursor y salen del campo desde su principio o su final |
| Intro | Siguiente campo; después del último, al botón (sin pulsarlo). En una lista, abre el registro (lo mismo que el doble clic). En un botón, lo pulsa |
| Tab / Mayús+Tab | Ir al siguiente / al anterior. Al final de la ventana, Tab vuelve a su primera opción |
| Esc | Cerrar y volver. Si hay algo escrito sin guardar, pregunta primero. Cerrada la última ventana, el teclado queda en el menú |
| Espacio | Seleccionar la fila o marcar la casilla |

Además, como en cualquier lista: Inicio / Fin van a la primera / última fila y AvPág / RePág pasan de página (en
Clientes, la página del servidor). Nada de esto choca con el navegador.

## Las reglas, iguales en todas las ventanas

- **Al abrir una ventana, el teclado entra en ella:** en su búsqueda si la tiene, si no en su lista, si no en su primer
  campo. Si la lista llega del servidor un momento después, el teclado pasa a ella mientras no se haya pulsado nada.
  Envíos y Entregas de dinero ya colocaban el teclado ellos mismos (el Remitente sin desplegar su lista, la búsqueda de
  recibos) y se respeta. Al entrar en la aplicación, el teclado empieza en el menú.
- **Al cerrar una ventana con Esc,** el teclado va a la ventana que queda delante, donde estaba; si no queda ninguna,
  al menú. Así, Esc, Esc… siempre lleva de vuelta al menú. Volver a elegir en el menú una ventana ya abierta la trae al
  frente con el teclado donde se dejó.
- **Menú:** ↑ ↓ recorren las opciones (de la última se pasa a la primera); → abre una sección y ← la cierra; Intro
  abre la opción. El menú es una sola parada de Tab, como una lista: Tab sale de él y Mayús+Tab vuelve a la opción
  donde estaba.
- **Listas:** son una sola parada de Tab (la fila elegida). ↓ desde la búsqueda baja a la lista; ↑ ↓ mueven la fila
  elegida; Inicio / Fin, a la primera / última; ↑ en la primera fila vuelve a la búsqueda; Intro hace lo del doble
  clic; Espacio selecciona. Una lista con botones en sus filas (Envíos, Entregas) se recorre con las flechas tal como
  está dibujada, sin cambiar de columna.
- **Botones que van juntos** (la barra de una ventana, las respuestas de un diálogo, los botones de un recibo, los
  mosaicos de Configuración y Reportes): ← → pasan al de al lado; en los mosaicos, ↑ ↓ también. Tab sigue pasando por
  cada uno, como siempre.
- **Campos:** Intro pasa al siguiente, igual que Tab (Mayús+Intro, al anterior), y ↓ ↑ también en los campos de una
  línea. Un grupo de opciones (Todos / por Cliente / Por Zona / Por Ruta) es una sola parada, como con Tab: Intro pasa
  de la opción marcada al campo que sigue, y la opción se cambia con ↑ ↓. En una nota de una o dos líneas Intro también
  pasa al siguiente; en un cuadro de texto grande (tres líneas o más) Intro hace una línea nueva y se sale con Tab. En el
  último campo, **Intro nunca se queda quieto** (28-10-2026): en cualquier formulario o diálogo lleva el teclado a su
  botón (Guardar, Aceptar, Calcular cotización…) sin pulsarlo, y un segundo Intro lo pulsa; en los filtros de una
  ventana con lista baja a la lista; si no hay ni lista ni botón, va adonde iría Tab. Solo «Iniciar sesión» entra con
  Intro en la clave, como siempre (su formulario lleva `data-keyboard-enter="send"`). Un campo obligatorio vacío hace
  que el navegador avise «Completa este campo». Un campo para subir un archivo no es parada de Intro (Intro abriría la
  ventana para elegir el archivo); Tab sí llega a él.
- **← y →, atrás y adelante en todas partes (28-10-2026):** hacen lo mismo que Mayús+Tab y Tab. En lo escrito primero
  mueven el cursor y salen del campo desde su principio (←) o su final (→); a un campo al que se llega con ellas se le
  elige todo el texto, así que otra pulsación sigue (y escribir lo reemplaza). Un campo que no se puede escribir (de
  solo lectura) sigue a la primera. En una lista para elegir, una opción o una casilla nunca cambian lo elegido. En una
  fecha, ← → pasan al campo de al lado: la fecha se escribe de corrido (día, mes y año se llenan solos) y ↑ ↓ cambian la
  parte donde está el cursor. Las barras de botones y los mosaicos ya no dan la vuelta: desde su primer botón ← sale
  al anterior y desde el último → sale al siguiente. En el menú, → y ← siguen abriendo y cerrando las secciones.
- **Listas de entradas con su botón** (los permisos de una cuenta, los avisos): son una sola parada de Tab y ↑ ↓ pasan
  de una a otra. Antes, con muchas entradas, Tab pedía una pulsación por cada una antes de llegar a «Guardar».
- **Listas para elegir** (Estado, Moneda, Zona, Ruta, Servicio…): ↓ o ↑ la abren y muestran todas sus opciones, como
  un clic del ratón, sin cambiar lo que tiene; ↓ ↑ se mueven dentro, Intro elige y la cierra, y el siguiente Intro pasa
  al campo de abajo. Espacio también la abre. Antes ↓ cambiaba la opción a ciegas, sin ver la lista.
- **Tab nunca sale de la página:** antes, Tab desde la última opción de la última ventana se iba a la barra del
  navegador y el teclado no respondía hasta un clic. Ahora, al final de una ventana, Tab vuelve a su primera opción (la
  barra de botones), una y otra vez. Mayús+Tab sigue subiendo por el título de la ventana hasta la cabecera y el menú.
  Sin ventanas, Tab da la vuelta a la página.
- **El dinero nunca va con un Intro sin querer** (regla de Dionel, `DIONEL-REMESAS-PERMISOS.md` punto 6, ajustada por
  orden de Rardiel el 28-10-2026: «aún yo dándole se queda ahí y no avanza»): en un formulario con dinero, Intro pasa
  de campo en campo y, después del último, lleva el teclado al botón **sin pulsarlo**; el segundo Intro lo pulsa y
  después viene siempre la confirmación de siempre (Confirmar envío, Abrir caja, Confirmar cierre…). Un solo Intro nunca
  guarda dinero. Antes, Intro se quedaba en el último campo y al botón se llegaba con Tab.
- **Envíos de dinero, como en la pizarra (28-10-2026):** primero quién envía y quién recibe (Remitente → Destinatario →
  su teléfono; elegido el remitente, el teclado pasa solo al destinatario), cómo se escribe el importe y la nota, y
  después el dinero en el orden de la pizarra: **Dinero a enviar** (DF: moneda, monto, tasa, comisión) → **Dinero que se
  recibe** (DR: moneda, monto, tasa) → **Tasa** (DT, debajo y entre los dos: el equivalente en pesos y la tasa de origen
  a destino). Las tasas y los montos calculados los pone la cotización del servidor. Tras «Calcular cotización», el
  teclado pasa solo a «Revisar y confirmar envío», el paso siguiente.
- **Envíos de dinero con tres casillas (29-10-2026):** lo que se envía, el total que paga y lo que recibe la persona.
  Se escribe en una y las otras dos las calcula la cotización. Intro va de la casilla escrita a lo siguiente y salta
  las calculadas; Tab y las flechas sí llegan a ellas, y al escribir en una esa pasa a ser la escrita. Después del
  monto viene «Comisión de entrega» (por defecto «Sin comisión») y luego «Calcular cotización». Ver
  [CALCULO-ENVIOS.md](CALCULO-ENVIOS.md).
- **Importes de izquierda a derecha y listado de Envíos ajustable (29-10-2026):** los importes se escriben como cualquier
  número (1500 = 1,500.00; el punto separa los centavos), ver [IMPORTES-DESDE-CENTAVOS.md](IMPORTES-DESDE-CENTAVOS.md).
  En Envíos de dinero, la barra entre el formulario y el listado se arrastra con el ratón; con el teclado, Tab llega a ella
  y ↑ ↓ cambian el alto del listado (Inicio y Fin: lo más bajo y lo más alto). Doble clic: el alto de antes. Se recuerda
  para cada cuenta en ese navegador.
- **Diálogos:** el teclado entra en su primer campo; en una pregunta, en «Sí» (Intro = Sí, Esc = No); nunca en la X del
  título. No se escapa mientras están abiertos y, al cerrarse, vuelve a lo que los abrió.
- **Esc** cierra el diálogo, el recibo o la ventana de delante. Si hay algo escrito que se perdería, pregunta «Hay
  cambios sin guardar. ¿Cerrar sin guardarlos?» (Intro = Sí, cerrar; Esc = No). Los filtros y las búsquedas no cuentan
  como cambios, y lo que ya se guardó tampoco. Esc dentro de una lista desplegada (clientes de Envíos) solo la pliega.
- **Tras un clic en el fondo, la primera tecla devuelve el teclado (28-10-2026):** antes, después de hacer clic en una
  zona vacía (el fondo del escritorio, fuera de las ventanas) o de volver de otro programa, las teclas no hacían nada.
  Ahora la primera tecla sencilla (flechas, Intro, Tab, Mayús+Tab, Espacio, Inicio/Fin, AvPág/RePág) pone el teclado en
  su sitio y no hace nada más (no escribe, no abre nada). Ese sitio es, por este orden: un diálogo abierto; si no, **lo
  que está bajo el ratón** (el campo o botón bajo el puntero, o la ventana bajo el puntero, que pasa al frente, con el
  teclado donde estaba en ella o en su primer campo; el menú; la cabecera); si no, la ventana de delante; si no, el
  menú. Esc conserva su sentido: cierra la ventana de delante.
- **El teclado nunca se pierde:** si lo que lo tenía desaparece (un diálogo que se cierra), vuelve a donde estaba antes
  (lo que abrió el diálogo, o lo último de esa ventana que sigue ahí). Nunca va a una ventana de detrás ni sale de la
  ventana en la que estaba mientras siga abierta: entonces se queda en la ventana de delante. Cerrada una ventana, va a la ventana que queda delante o al menú. Si solo se deshabilitó un momento (un
  botón mientras calcula o guarda), lo espera y vuelve a él.
- **Foco visible:** el elemento con el teclado siempre está marcado, también las filas de todas las listas. Es la
  única marca: no hay teclas dibujadas en los botones ni avisos flotantes.

## Cómo está hecho

Tabster se crea una sola vez en cada aplicación (el portal y la app del cobrador), en `installKeyboard` de
`app/shared/keyboard.ts`, y hace todo lo que es mover el teclado:

| Parte de Tabster | Qué hace en CyP |
|---|---|
| Mover | Las flechas, Inicio / Fin y AvPág / RePág en el menú, las listas, las barras de botones y los mosaicos. El menú y cada lista son una sola parada de Tab que recuerda la opción o la fila |
| Modalizer | Tab no sale de un diálogo abierto: da la vuelta dentro de él, hacia delante y hacia atrás |
| Deloser | Si desaparece lo que tenía el teclado (un diálogo que se cierra), lo devuelve a donde estaba antes: lo que abrió el diálogo, o lo último de esa ventana, del menú o de la cabecera que sigue ahí |
| ObservedElement | Un botón que se deshabilita un momento mientras calcula o guarda recupera el teclado en cuanto puede (hasta 5 s), salvo que el teclado ya haya ido a otro sitio |

Tabster lee sus marcas (`data-tabster`) de los componentes compartidos: el menú (`MENU_KEYS`, en el cobrador
`BAR_MENU_KEYS`), las ventanas, el recibo, la barra lateral y la cabecera (`WINDOW_KEYS`), los diálogos clásicos, los
de Radix y los nativos (`dialogKeys`) y los dos lanzadores de mosaicos (`TILE_KEYS`). Las listas y las barras de
botones las dibuja cada pantalla por su cuenta, así que `keyboard.ts` las marca por su forma (una tabla con filas que se
pueden elegir o con botones; un grupo de botones que van juntos): no se tocó ninguna de las ~100 pantallas. Tabster
lleva el Tab él mismo (su modo normal), así que no mete nada dentro de las barras ni de las listas, y no oculta nada a
los lectores de pantalla: los diálogos ya dicen por sí mismos que son modales.

Lo que queda en `keyboard.ts` es solo lo propio de CyP, que Tabster no hace: Intro de campo en campo y la regla del
dinero de Dionel, ↓ ↑ entre campos de una línea, ↓ de la búsqueda a la lista y ↑ de vuelta, elegir la fila a la que se
llega con las flechas (cuando el Mover de Tabster la mueve), AvPág / RePág con la página del servidor en Clientes, → ←
en las secciones del menú, Esc con el aviso de cambios sin guardar, dónde entra el teclado al abrir una ventana o un
diálogo, y **el orden de las ventanas**, que Tabster no conoce: si el Deloser quiere llevar el teclado a una ventana que
está detrás (al cancelar un envío desde su recibo, a la lista de Envíos, que se pondría encima del recibo) o sacarlo de
la ventana en la que estaba mientras se redibuja (al abrir la caja, al menú), CyP lo para y lo deja en la ventana de
delante en cuanto tiene algo que enfocar; y al cerrar una ventana, el teclado va a la que queda delante o al menú. El diálogo
clásico ya no tiene su propia trampa de Tab ni su propio «volver a lo que lo abrió»: lo hace Tabster; solo conserva una
guarda pequeña que le devuelve el foco si la pantalla de detrás se lo quita (Tabster, a propósito, no corrige el foco
que mueve el propio programa). Una pantalla que ya maneja una tecla (la lista de clientes de Envíos, un combo) la
conserva. Soporte Técnico muestra las cinco teclas.

## Qué no cambia

No se tocaron validaciones, permisos ni el servidor. Los nombres de ventanas, opciones y botones son los de siempre.
El ratón funciona igual que antes. Ctrl+K (buscar un cliente o una ruta) sigue como estaba.

Frente a la versión anterior (PR #67/#68), las teclas son las mismas. Cambia quién mueve el teclado (Tabster en vez del
código hecho a mano: el menú, las listas, las barras, los mosaicos, la trampa de Tab de los diálogos, la vuelta del
teclado al cerrar un diálogo y la espera de un botón deshabilitado) y una cosa que se nota: el menú pasa a ser una sola
parada de Tab, como las listas.

## Inventario: cada ventana, antes y ahora

Se hizo en Edge sobre la compilación como en Render, con los datos ficticios de la demo, abriendo cada ventana del
menú, de Configuración de administración y de Reportes (55 para la Administración, 3 para el Cajero) y los botones de
la cabecera. «Antes» es `main` sin el teclado completo (`332efca`).

| | Antes | Ahora |
|---|---|---|
| Ventanas donde el teclado entra al abrirlas | 2 de 55 (Envíos y Entregas de dinero) | 55 de 55 |
| Ventanas que se cierran con Esc | 0 de 55 | 55 de 55 |
| Listas que se recorren con ↑ ↓ | 0 de 31 | 31 de 31 |
| Listas donde Tab pasa por cada fila | 17 (Clientes: 44 Tab para salir de la lista) | 0: la lista es una sola parada |
| Paradas de Tab del menú | una por opción | una (Mayús+Tab vuelve a la opción donde estaba) |
| Listas donde Intro no hacía lo del doble clic | 9 (selectores de cliente, cargo y pago autorizado; Bancos; codificadores; Tasas de cambio; Cuadres; herramientas; tabla genérica) | 0 |
| Botones que van juntos, con ← → | no | sí (barras, diálogos, recibos, mosaicos) |
| Diálogos de la cabecera que reciben el teclado | 4 de 7 (Facturas, Pagos y Qué hay de nuevo no) | 7 de 7 |
| Al cerrar, el teclado vuelve al botón de la cabecera | 0 de 7 | 7 de 7 |
| Aviso de cambios sin guardar al cerrar con Esc | no | sí |
| Teclas que hay que aprender (F1–F10, combinaciones) | — | ninguna |
| Elementos que solo responden al ratón | ninguno habilitado | ninguno |
| App del cobrador: elementos solo de ratón · flechas en su barra | 0 · no | 0 · sí |

Con Tabster se repitió la misma auditoría en Edge (27-10, compilación como en Render): las mismas cifras de la columna
«Ahora» (55 de 55, 31 de 31, cabecera 7 de 7, cero elementos solo de ratón, cero errores de página). Una ventana con
varias listas (Servicios por zona tiene tres) tiene una parada de Tab por lista. En la app del cobrador, con Tab ahora
se llega a la barra de abajo desde sus seis vistas (antes desde cuatro), porque cada lista y la barra cuentan como una
sola parada.

El Cajero ve tres ventanas (Envíos de dinero, Entregas de dinero y Cuadres Diarios) más la cabecera: las tres quedan
como las de la Administración.

### Qué hace cada tecla en cada ventana

Resultado de la prueba `teclado-ventanas-ui` (sin un clic, datos ficticios mínimos: por eso varias listas tienen menos
de dos filas; con los datos de la demo, ↑ ↓ funcionan en las 31 listas). «Intro en la lista» es lo que hace el doble
clic de esa ventana; donde el doble clic solo selecciona, Intro también. «Nuevo» se alcanza con Mayús+Tab (está en la
barra de arriba) o con ← → dentro de la barra, y se abre con Intro.

| Ventana | Se abre desde | Al abrirla, el teclado entra en | ↑ ↓ en su lista (datos de la prueba) | Intro en la lista | «Nuevo» (Mayús+Tab, Intro) | Esc la cierra |
|---|---|---|---|---|---|---|
| Clientes | Menú | la búsqueda | sí | abre «Datos del Cliente...» | abre «Datos del Cliente...» | sí |
| Cargos | Menú | la lista | sí | abre «Datos del Cargo...» | abre «Datos del Cargo...» | sí |
| Cargos Recurrentes | Menú | la búsqueda | menos de 2 filas | — | abre «Datos del Cargo Recurrente...» | sí |
| Cobros | Menú | el primer filtro | menos de 2 filas | — | abre «Datos del Cobro...» | sí |
| Depósitos por Cobradores | Menú | el primer filtro | menos de 2 filas | — | abre «Datos del Depósito...» | sí |
| Descargos | Menú | el primer filtro | menos de 2 filas | — | abre «Datos del Descargo...» | sí |
| Pagos | Menú | el primer filtro | menos de 2 filas | — | abre «Datos del Pago...» | sí |
| Entregas de Dinero a Cobradores | Menú | la lista | sí | abre «Detalle de la Entrega de Dinero...» | abre «Datos de la Entrega de Dinero...» | sí |
| Envíos de dinero | Menú | la búsqueda | menos de 2 filas | — | — | sí |
| Entregas de dinero | Menú | la búsqueda | menos de 2 filas | — | — | sí |
| Cuadres Diarios | Menú | la lista | sí | abre «Confirmar cierre de jornada...» | — | sí |
| Monitor de Cobradores | Menú | la lista | sí | selecciona la fila | — | sí |
| Monitor de Zonas | Menú | la lista | sí | selecciona la fila | — | sí |
| Monitor de Rutas | Menú | la lista | sí | selecciona la fila | — | sí |
| Cobradores | Configuración | la búsqueda | sí | abre «Datos de Cobrador...» | abre «Datos de Cobrador...» | sí |
| Estaciones de PCP | Configuración | la búsqueda | menos de 2 filas | — | — | sí |
| Grupos de PCPs | Configuración | la búsqueda | menos de 2 filas | — | abre «Nombre del Grupo...» | sí |
| Motivos de Atraso | Configuración | la búsqueda | menos de 2 filas | — | abre «Motivo de atraso...» | sí |
| Puntos de Cobros y Pagos | Configuración | la búsqueda | menos de 2 filas | — | — | sí |
| Rutas | Configuración | la búsqueda | sí | abre «Datos de Ruta...» | abre «Datos de Ruta...» | sí |
| Servicios y Productos | Configuración | la búsqueda | menos de 2 filas | — | abre «Datos del Servicio o Producto (Bien)...» | sí |
| Listado de Sesiones | Configuración | la lista | menos de 2 filas | — | — | sí |
| Tasas de Cambio | Configuración | la lista | menos de 2 filas | — | abre «Datos de la Tasa de Cambio...» | sí |
| Comisiones de remesas | Configuración | el primer campo («Comisión total de la transacción (%)») | menos de 2 filas | — | — | sí |
| Bancos | Configuración | la búsqueda | menos de 2 filas | — | abre «Datos del Banco...» | sí |
| Trazas del Sistema | Configuración | la búsqueda | menos de 2 filas | — | — | sí |
| Usuarios | Configuración | la búsqueda | menos de 2 filas | — | abre «Datos de Usuario...» | sí |
| Zonas | Configuración | la búsqueda | menos de 2 filas | — | abre «Datos de la Zona...» | sí |
| Configuración General | Configuración | el primer campo («Empresa») | menos de 2 filas | — | — | sí |
| Solicitudes de Autorización | Configuración | el primer campo («Fecha Inicial») | menos de 2 filas | — | — | sí |
| Cargos pendientes de cobros de los clientes | Reportes | el primer campo («Fecha inicial») | menos de 2 filas | — | — | sí |
| Reporte de Cobros Pendientes de Clientes por Ruta | Reportes | el primer campo («Fecha inicial») | menos de 2 filas | — | — | sí |
| Reporte de Cobros Pendientes de Clientes por Zona | Reportes | el primer campo («Fecha inicial») | menos de 2 filas | — | — | sí |
| Reporte de Cobros Pendientes por Rutas | Reportes | el primer campo («Fecha inicial») | menos de 2 filas | — | — | sí |
| Reporte de Cobros Pendientes por Zonas | Reportes | el primer campo («Fecha inicial») | menos de 2 filas | — | — | sí |
| Cargos de clientes por zona por servicio | Reportes | el primer campo («Fecha inicial») | menos de 2 filas | — | — | sí |
| Reporte de Cobros Resumido | Reportes | el primer campo («Fecha inicial») | menos de 2 filas | — | — | sí |
| Reporte Resumido General | Reportes | el primer campo («Fecha inicial») | menos de 2 filas | — | — | sí |
| Reporte de Cobros por Servicios | Reportes | el primer campo («Fecha inicial») | menos de 2 filas | — | — | sí |
| Pagos detallado | Reportes | el primer campo («Fecha inicial») | menos de 2 filas | — | — | sí |
| Pagos pendientes de clientes | Reportes | la lista | sí | selecciona la fila | — | sí |
| Pagos pendientes por rutas | Reportes | la lista | sí | selecciona la fila | — | sí |
| Pagos pendientes por zonas | Reportes | la lista | sí | selecciona la fila | — | sí |
| Pagos x servicio detallado | Reportes | el primer campo («Fecha inicial») | menos de 2 filas | — | — | sí |
| Pagos x servicio resumido | Reportes | el primer campo («Fecha inicial») | menos de 2 filas | — | — | sí |
| Montos y cantidad de envíos | Reportes | el primer campo («Fecha inicial») | menos de 2 filas | — | — | sí |
| Reporte consolidado de comisiones | Reportes | el primer campo («Fecha inicial») | menos de 2 filas | — | — | sí |
| Comisión total cobrada en origen | Reportes | el primer campo («Fecha inicial») | menos de 2 filas | — | — | sí |
| Información de comisiones de gestores | Reportes | el primer campo («Fecha inicial») | menos de 2 filas | — | — | sí |
| Tiempos de entrega | Reportes | el primer campo («Fecha inicial») | menos de 2 filas | — | — | sí |
| Remesas entregadas | Reportes | el primer campo («Fecha inicial») | menos de 2 filas | — | — | sí |
| Caja de remesas | Reportes | el primer campo («Fecha inicial») | menos de 2 filas | — | — | sí |
| Servicios por zona | Reportes | la lista | sí | selecciona la fila | — | sí |

Esc también cierra cada diálogo que abren Intro y «Nuevo», y el teclado vuelve a la ventana. Configuración de
administración y Reportes (las ventanas que lanzan las demás) se abren con Intro desde el menú y sus mosaicos se
recorren con las flechas o con Tab.

## Pruebas

Tres pruebas en Edge con la aplicación real (portal, API y datos ficticios en memoria), manejadas **solo con teclas
sencillas**: cuentan cada evento de puntero en la página y fallan si hay uno, si se pulsa una tecla que no sea de las
sencillas (flechas, Intro, Tab, Esc, Espacio, Inicio/Fin, AvPág/RePág, con o sin Mayús), si hay un error de página o si
la página pide algo fuera de la prueba. También comprueban que no se dibuja ninguna tecla en la pantalla.

- `app/client-admin/test/teclado-cajero-ui.test.ts`: el Cajero de punta a punta. Entra (Intro de usuario a clave y
  entra), abre su caja (Intro en el efectivo llega a «Revisar apertura» sin abrirla; otro Intro la revisa e Intro
  confirma), registra un envío completo (remitente y destinatario con la lista, monto; Intro en «Moneda del
  destinatario» llega a «Calcular cotización» sin pulsarlo, ← vuelve al remitente y → regresa, sin registrar nada; Intro
  calcula, el teclado pasa solo a «Revisar y confirmar envío», Intro; Intro en el dinero recibido llega a «Aceptar» sin
  registrar nada, Intro, la pregunta de imprimir), entrega una remesa (busca, ↓ a la lista, Intro abre el recibo, → de
  «Imprimir comprobante» a «Registrar entrega», Intro, Intro confirma, Esc cierra), cuenta y cierra su caja (Intro llega
  a «Revisar cierre» sin cerrarla), abre las notificaciones y cierra la sesión.
- `app/client-admin/test/teclado-admin-ui.test.ts`: Clientes (búsqueda, ↓, Inicio, Fin, ↑ desde la primera fila vuelve
  a la búsqueda, una sola parada de Tab, AvPág y RePág cambian la página del servidor, Intro abre la ficha, Esc con algo
  escrito pregunta y «No» vuelve a la ficha, la barra con Mayús+Tab y ← →, «Nuevo» con Intro), un cargo con dinero (Intro
  de campo en campo, el último no lo envía, Tab a su botón e Intro lo guarda), Esc con un envío a medias, un reporte de
  remesas (Intro por los filtros hasta «Consultar», → a «Imprimir»), un codificador desde Configuración (→ entre
  mosaicos hasta Rutas), Esc, Esc… hasta el menú y la ventana de Facturas de la cabecera. Con Tabster comprueba además
  que el menú, la lista de Clientes y su barra llevan la marca de Tabster, que el menú es una sola parada de Tab (Tab sale,
  Mayús+Tab vuelve a la misma opción), que Tab da vueltas dentro de la ficha abierta, hacia delante y hacia atrás, sin
  salir de ella, y que al cerrar la ficha es el Deloser de Tabster quien devuelve el teclado a la fila.
- `app/client-admin/test/teclado-ventanas-ui.test.ts`: **todas las ventanas**, una por una (53 más las dos que las
  lanzan): se abren con las teclas, el teclado entra, ↓ mueve la lista, Intro abre lo que abre el doble clic y Esc lo
  cierra, Mayús+Tab llega a «Nuevo», Intro lo abre y Esc lo cierra, y Esc cierra la ventana. Ninguna tecla guardó nada.
  De esta prueba sale la tabla «Qué hace cada tecla en cada ventana».

Además, todas estas en verde con el código final de Tabster:

- `pnpm -r typecheck`: verde.
- Interfaz (`client-admin/test` y `tests`): 392 de 392 (contando subpruebas; la de todas las ventanas suma una por ventana).
- Servidor: 410 en verde, 0 fallos (18 omitidas que piden PostgreSQL). El servidor no cambió, así que no hacía falta
  PostgreSQL.
- Cobrador: 17/17.

La primera corrida con Tabster dio 379 de 392 y, con las siguientes, enseñó cinco cosas que se corrigieron antes de
entregar: Tabster ocultaba a los lectores de pantalla los diálogos que no tenían el foco (ahora no oculta nada); metía
elementos invisibles dentro de las barras para atrapar el Tab (ahora lleva el Tab él mismo y no añade nada); su Deloser
llevaba el teclado a una ventana de detrás o al menú mientras la ventana se redibujaba (ahora CyP le marca el orden de
las ventanas); los diálogos nativos de remesas se cerraban cuando React ya los había quitado y el navegador no podía
devolver el foco (ahora se cierran antes); y un diálogo que se enfoca solo al abrirse (los campos con autoenfoque)
quedaba apuntado como «la página» y al cerrarse el teclado iba al menú (ahora solo las ventanas, el recibo, los
diálogos, la barra lateral y la cabecera guardan dónde estaba el teclado). También volvió la guarda de foco del diálogo
clásico.

**Ajustes del 28-10-2026.** Las pruebas solo con teclado comprueban además:
- `teclado-cajero-ui`: el envío en el orden de la pizarra. Elegido el remitente, el teclado está en el destinatario; luego
  su teléfono, «Ingresar importe de», la nota, «Moneda del remitente» en Dinero a enviar, el monto, «Moneda del
  destinatario» en Dinero que se recibe, y ahí Intro se queda (dinero).
- `teclado-admin-ui`: 30 Tab seguidos en Clientes sin salir de la ventana ni de la página, dando la vuelta a su primera
  opción; el Panel de Filtro de Cargos con Intro (de «Todos» a «Fecha Inicial», a «Estado»); ↓ abre la lista de Estado
  sin cambiarla, ↓ e Intro eligen «Todos» y el siguiente Intro pasa a «Relación de Pago»; el servicio del cargo se elige
  con la lista abierta (↓, ↓, Intro).
- Pruebas ajustadas, sin cambiar lo que comprueban: la lista de Clientes como una sola parada se mira ahora con Mayús+Tab
  y Tab (con Tab al revés da la vuelta a la ventana); en `remittance-workspace-corrections-ui` (W2), Intro desde un campo
  de solo lectura y desde el monto llega a «Moneda del destinatario» sin pasar por ningún botón, y Mayús+Intro desde el
  teléfono vuelve al remitente.
- Resultados: `pnpm -r typecheck` verde; interfaz **392 de 392**; cobrador 17/17; servidor sin cambios. En Edge, con la
  compilación de Render: Intro probado campo por campo en las 16 ventanas del menú (y sus «Nuevo»): solo se queda en el
  último campo de los cuatro formularios con dinero; auditoría de las 55 ventanas igual que antes (teclado dentro 55/55,
  Esc 55/55, flechas 31/31, cabecera 7/7, cero solo-ratón, cero errores); cajero 3/3; cobrador 6/6 vistas hasta la
  barra. A 1366×768 el formulario de Envíos cabe entero y se ven tres envíos, también con el aviso de caja.

**De punta a punta (28-10-2026).** Tres pruebas nuevas y tres ampliadas, en Edge con la aplicación real:
- `teclado-altas-ui` (nueva, solo teclado): alta con Intro de campo en campo hasta el botón, ← hasta el primer campo,
  → de vuelta al botón e Intro guarda, en Clientes, Cargos Recurrentes, Descargos, Cobros, Cobradores, Zonas, Rutas,
  Bancos, Motivos de Atraso, Grupos de PCPs, Servicios y Productos y Usuarios; además Cambiar Clave, Permisos (quitar,
  «Sí», Guardar), Configuración General, Reportes (Imprimir y Exportar) y editar un cliente. 18/18.
- `teclado-cobrador-ui` (nueva, solo teclado, tamaño de teléfono): entra; la hoja de cobro abre en el monto, Intro
  llega a «Confirmar cobro» sin registrar nada, ← vuelve al monto, → regresa e Intro registra; el recibo con el teclado
  en «Compartir recibo» y Mayús+Tab hasta «Volver a mi ruta»; un atraso con → e Intro; las seis vistas del menú, de ida
  y de vuelta; la ayuda con Esc; y cerrar sesión.
- `teclado-raton-ui` (nueva, **usa el ratón a propósito**): clic en el fondo y ↓ devuelve el teclado a la ventana de
  delante; el ratón sobre la ventana de detrás y Tab la trae delante con el teclado dentro; el ratón sobre el menú e
  Intro (no abre nada); sobre un campo y → (empieza en ese campo sin escribir nada); y Esc con el teclado perdido sigue
  cerrando la ventana de delante.
- `teclado-ventanas-ui`: además, en cada una de las 55 ventanas y en su «Nuevo», ← → e Intro campo por campo (hasta 30
  campos): ninguno se queda quieto.
- `teclado-cajero-ui` y `teclado-admin-ui`: Intro llega a «Revisar apertura», «Calcular cotización», «Aceptar» y
  «Revisar cierre» sin pulsarlos; ← y → entre el remitente y el botón sin registrar nada.
- Resultados: `pnpm -r typecheck` verde; interfaz **431 de 431** (en la corrida completa, `user-permissions-ui` agotó
  el tiempo una vez con la máquina cargada; sola, 24/24; no usa el módulo del teclado); servidor 411 en verde, 0 fallos
  (18 omitidas que piden PostgreSQL); cobrador 18/18.
- Revisión en Edge con la compilación como en Render: auditoría de las 55 ventanas en tema claro y oscuro (teclado
  dentro 55/55, Esc 55/55, listas 29/29, cero solo-ratón, foco visible); cajero 3/3; cobrador 6/6 a tamaño de teléfono
  e Intro en la clave entra. La ayuda de Soporte Técnico se salía de su cuadro (una regla general no dejaba partir las
  líneas de la tabla): ahora se parte y no aparece barra horizontal.

Prueba existente ajustada en la versión anterior, sin cambiar lo que comprueba: `envios-review-corrections-ui` abría la
revisión de la caja con F9; ahora llega a «Revisar apertura» con Tab y la abre con Intro (el dinero no va con Intro).

## Capturas

Rehechas el 28-10 (teclado de punta a punta), de la compilación como en Render (`VITE_PUBLIC_DEMO`, `CYP_PUBLIC_DEMO`, `DEMO_MODE`)
en Edge, con datos ficticios, manejando la aplicación solo con teclas sencillas. Están en `docs/teclado-completo/`.

| Captura | Qué muestra |
|---|---|
| `1-envios-revisar.png` | Envíos de dinero tras «Calcular cotización»: el teclado ya está en «Revisar y confirmar envío» |
| `2-confirmar-envio.png` | La confirmación del envío: el teclado en «Dinero recibido»; un Intro más lleva a «Aceptar» sin pulsarlo |
| `3-cambios-sin-guardar.png` | Esc con un envío a medias: «¿Cerrar sin guardarlos?», con el teclado en «Sí, cerrar» |
| `4-clientes-flechas.png` | Clientes movida con las flechas: la fila con el teclado marcada, sin nada dibujado en los botones |
| `5-barra-con-flechas.png` | La barra de Clientes recorrida con ← →: el teclado en «Nuevo» |
| `6-soporte-teclas.png` | Soporte Técnico: las cinco teclas, ← → atrás y adelante, y el aviso del dinero y del clic fuera |
| `7-envios-pizarra.png` | Envíos de dinero en el orden de la pizarra: quién envía y quién recibe, y luego Dinero a enviar → Dinero que se recibe → Tasa (debajo, entre las dos) |
| `hoja-atajos-cajeros.png` | La hoja de una página para los cajeros (también en PDF y HTML) |

## Límites

- Mover o cambiar el tamaño de una ventana con el teclado no se añadió: no forma parte de ningún flujo. El botón de
  maximizar sí se alcanza con Tab.
- Las fechas: ← → no recorren el día, el mes y el año; pasan al campo de al lado. La fecha se escribe de corrido con
  los números y ↑ ↓ cambian la parte donde está el cursor (lo normal del navegador).
- El teclado del navegador fuera de la página (la barra de direcciones, las pestañas) no lo controla CyP: si se hace
  clic allí, se vuelve con un clic o con F6 hasta la página, y entonces la primera tecla sencilla devuelve el teclado.
- Los mapas (Monitor, ubicación del cliente) usan las teclas propias del mapa: flechas para moverse, + y − para el zoom.
- Para ir al menú con una ventana abierta sin cerrarla se usa Mayús+Tab; Esc la cierra y deja el teclado en el menú.
- En la app del cobrador las teclas de lista, campos, botones y menú funcionan igual; sus pantallas son de teléfono y no
  tienen ventanas que cerrar con Esc.
