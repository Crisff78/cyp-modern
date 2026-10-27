# CyP solo con el teclado, con teclas sencillas (27-10-2026)

Pedido de Rardiel el 27-10-2026: que toda la aplicación se pueda usar entera solo con el teclado, porque los cajeros
trabajan sin ratón («debe ser así para toda la aplicación, solo te puse al cajero como ejemplo»).

La primera versión (PR #65/#66) usaba teclas F (F2 Nuevo, F9 Guardar, F10 menú…) y dibujaba la tecla en la esquina de
cada botón. Rardiel la corrigió el mismo día: **solo teclas sencillas**, las que cualquiera usa rápido y sin
memorizar —las flechas, Intro, Tab, Esc—, pensando en quien no ve bien o no lee, y **sin señales en pantalla** («se ve
feo y no aporta realmente»), salvo que su jefe pida lo contrario. Esta versión hace eso.

**Resultado:** las mismas cinco teclas en todas las ventanas del portal (las 55 que se abren desde el menú,
Configuración de administración y Reportes), en sus diálogos, en la cabecera y en la app del cobrador. No se dibuja
nada nuevo en la pantalla: solo el marco del elemento que tiene el teclado, como siempre. Tres pruebas lo recorren sin
un solo clic y sin teclas F ni combinaciones: el Cajero de punta a punta, el Administrador y todas las ventanas una por
una.

Para repartir a los cajeros: [hoja de una página](teclado-completo/hoja-atajos-cajeros.pdf)
([versión HTML](teclado-completo/hoja-atajos-cajeros.html)).

## Las teclas

| Tecla | Qué hace |
|---|---|
| ↑ ↓ ← → | Moverse: en el menú, en las listas, entre los botones que van juntos y entre los campos |
| Intro | Siguiente campo. En una lista, abre el registro (lo mismo que el doble clic). En un botón, lo pulsa |
| Tab / Mayús+Tab | Ir al siguiente / al anterior |
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
- **Menú:** ↑ ↓ recorren las opciones; → abre una sección y ← la cierra; Intro abre la opción.
- **Listas:** son una sola parada de Tab (la fila elegida). ↓ desde la búsqueda baja a la lista; ↑ ↓ mueven la fila
  elegida; ↑ en la primera fila vuelve a la búsqueda; Intro hace lo del doble clic; Espacio selecciona.
- **Botones que van juntos** (la barra de una ventana, las respuestas de un diálogo, los botones de un recibo, los
  mosaicos de Configuración y Reportes): ← → pasan al de al lado; en los mosaicos, ↑ ↓ también. Tab sigue pasando por
  cada uno, como siempre.
- **Campos:** Intro pasa al siguiente (Mayús+Intro, al anterior), y ↓ ↑ también en los campos de una línea. En el
  último campo, un formulario normal se envía con Intro como siempre (Iniciar sesión, un cliente, un reporte…); un
  diálogo sin formulario lleva el teclado a su botón principal sin pulsarlo, y un segundo Intro lo pulsa. En los
  filtros de una ventana con lista, después del último se baja a la lista.
- **El dinero nunca va con un Intro sin querer** (regla de Dionel, `DIONEL-REMESAS-PERMISOS.md` punto 6): en un
  formulario con dinero, Intro solo pasa de campo en campo y se queda en el último. A su botón se llega con Tab, y ahí
  Intro lo pulsa. Después viene siempre la confirmación de siempre.
- **Envíos de dinero:** tras «Calcular cotización», el teclado pasa solo a «Revisar y confirmar envío», el paso
  siguiente.
- **Diálogos:** el teclado entra en su primer campo; en una pregunta, en «Sí» (Intro = Sí, Esc = No); nunca en la X del
  título. No se escapa mientras están abiertos y, al cerrarse, vuelve a lo que los abrió.
- **Esc** cierra el diálogo, el recibo o la ventana de delante. Si hay algo escrito que se perdería, pregunta «Hay
  cambios sin guardar. ¿Cerrar sin guardarlos?» (Intro = Sí, cerrar; Esc = No). Los filtros y las búsquedas no cuentan
  como cambios, y lo que ya se guardó tampoco. Esc dentro de una lista desplegada (clientes de Envíos) solo la pliega.
- **El teclado nunca se pierde:** si lo que lo tenía desaparece (un diálogo que se cierra), vuelve al diálogo abierto,
  a la ventana de delante o al menú. Si solo se deshabilitó un momento (un botón mientras calcula o guarda), lo espera
  y vuelve a él.
- **Foco visible:** el elemento con el teclado siempre está marcado, también las filas de todas las listas. Es la
  única marca: no hay teclas dibujadas en los botones ni avisos flotantes.

Todo vive en un solo sitio, `app/shared/keyboard.ts` (con `keyboard.css`), instalado una vez por aplicación: no se
reescribieron las ~100 pantallas. Una pantalla que ya maneja una tecla (la lista de clientes de Envíos, un combo) la
conserva; el módulo solo actúa sobre lo que la pantalla deja pasar. Soporte Técnico muestra las cinco teclas.

## Qué no cambia

No se tocaron validaciones, permisos ni el servidor. Los nombres de ventanas, opciones y botones son los de siempre.
El ratón funciona igual que antes. Ctrl+K (buscar un cliente o una ruta) sigue como estaba.

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
| Listas donde Intro no hacía lo del doble clic | 9 (selectores de cliente, cargo y pago autorizado; Bancos; codificadores; Tasas de cambio; Cuadres; herramientas; tabla genérica) | 0 |
| Botones que van juntos, con ← → | no | sí (barras, diálogos, recibos, mosaicos) |
| Diálogos de la cabecera que reciben el teclado | 4 de 7 (Facturas, Pagos y Qué hay de nuevo no) | 7 de 7 |
| Al cerrar, el teclado vuelve al botón de la cabecera | 0 de 7 | 7 de 7 |
| Aviso de cambios sin guardar al cerrar con Esc | no | sí |
| Teclas que hay que aprender (F1–F10, combinaciones) | — | ninguna |
| Elementos que solo responden al ratón | ninguno habilitado | ninguno |
| App del cobrador: elementos solo de ratón · flechas en su barra | 0 · no | 0 · sí |

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
  entra), abre su caja (Intro en el efectivo no la envía; Tab a «Revisar apertura», Intro, Intro confirma), registra un
  envío completo (remitente y destinatario con la lista, monto, Tab a «Calcular cotización», Intro, el teclado pasa solo a
  «Revisar y confirmar envío», Intro, Intro en el dinero recibido no registra nada, Tab a «Aceptar», Intro, la pregunta de
  imprimir), entrega una remesa (busca, ↓ a la lista, Intro abre el recibo, → de «Imprimir comprobante» a «Registrar
  entrega», Intro, Intro confirma, Esc cierra), cuenta y cierra su caja (Intro no la cierra; Tab a «Revisar cierre»),
  abre las notificaciones y cierra la sesión.
- `app/client-admin/test/teclado-admin-ui.test.ts`: Clientes (búsqueda, ↓, Inicio, Fin, ↑ desde la primera fila vuelve
  a la búsqueda, una sola parada de Tab, AvPág y RePág cambian la página del servidor, Intro abre la ficha, Esc con algo
  escrito pregunta y «No» vuelve a la ficha, la barra con Mayús+Tab y ← →, «Nuevo» con Intro), un cargo con dinero (Intro
  de campo en campo, el último no lo envía, Tab a su botón e Intro lo guarda), Esc con un envío a medias, un reporte de
  remesas (Intro por los filtros hasta «Consultar», → a «Imprimir»), un codificador desde Configuración (→ entre
  mosaicos hasta Rutas), Esc, Esc… hasta el menú y la ventana de Facturas de la cabecera.
- `app/client-admin/test/teclado-ventanas-ui.test.ts`: **todas las ventanas**, una por una (53 más las dos que las
  lanzan): se abren con las teclas, el teclado entra, ↓ mueve la lista, Intro abre lo que abre el doble clic y Esc lo
  cierra, Mayús+Tab llega a «Nuevo», Intro lo abre y Esc lo cierra, y Esc cierra la ventana. Ninguna tecla guardó nada.
  De esta prueba sale la tabla «Qué hace cada tecla en cada ventana».

<!-- resultados -->

## Capturas

De la compilación como en Render (`VITE_PUBLIC_DEMO`, `CYP_PUBLIC_DEMO`, `DEMO_MODE`) en Edge, con datos ficticios,
manejando la aplicación solo con teclas sencillas. Están en `docs/teclado-completo/`.

| Captura | Qué muestra |
|---|---|
| `1-envios-revisar.png` | Envíos de dinero tras «Calcular cotización»: el teclado ya está en «Revisar y confirmar envío» |
| `2-confirmar-envio.png` | La confirmación del envío: el teclado en «Dinero recibido» (Intro no envía); a «Aceptar» se llega con Tab |
| `3-cambios-sin-guardar.png` | Esc con un envío a medias: «¿Cerrar sin guardarlos?», con el teclado en «Sí, cerrar» |
| `4-clientes-flechas.png` | Clientes movida con las flechas: la fila con el teclado marcada, sin nada dibujado en los botones |
| `5-barra-con-flechas.png` | La barra de Clientes recorrida con ← →: el teclado en «Nuevo» |
| `6-soporte-teclas.png` | Soporte Técnico: las cinco teclas |
| `hoja-atajos-cajeros.png` | La hoja de una página para los cajeros (también en PDF y HTML) |

## Límites

- Mover o cambiar el tamaño de una ventana con el teclado no se añadió: no forma parte de ningún flujo. El botón de
  maximizar sí se alcanza con Tab.
- Los mapas (Monitor, ubicación del cliente) usan las teclas propias del mapa: flechas para moverse, + y − para el zoom.
- Para ir al menú con una ventana abierta sin cerrarla se usa Mayús+Tab; Esc la cierra y deja el teclado en el menú.
- En la app del cobrador las teclas de lista, campos, botones y menú funcionan igual; sus pantallas son de teléfono y no
  tienen ventanas que cerrar con Esc.
