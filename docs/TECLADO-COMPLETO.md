# CyP solo con el teclado (27-10-2026)

Pedido de Rardiel el 27-10-2026: que toda la aplicación se pueda usar entera solo con el teclado, porque los cajeros
trabajan sin ratón. Aclaró después: «debe ser así para toda la aplicación, solo te puse al cajero como ejemplo».
Cambio hecho por Claude Code sobre `main` `332efca` (la versión que Render publicó ese día, `77ba043`).

**Resultado:** las mismas teclas en todas las ventanas del portal (las 55 que se abren desde el menú, Configuración de
administración y Reportes), en sus diálogos, en la cabecera y en la app del cobrador. Tres pruebas nuevas lo recorren
sin un solo clic: el Cajero de punta a punta, el Administrador y todas las ventanas una por una.

Para repartir a los cajeros: [hoja de atajos de una página](teclado-completo/hoja-atajos-cajeros.pdf)
([versión HTML](teclado-completo/hoja-atajos-cajeros.html)).

## Las teclas

| Tecla | Qué hace |
|---|---|
| F1 | Ver las teclas (también están en Soporte Técnico) |
| F2 | Nuevo. En Envíos de dinero, vuelve al Remitente |
| F3 | Buscar: lleva el teclado a la búsqueda de la ventana |
| F4 | Mostrar u ocultar los filtros |
| F8 | Imprimir |
| F9 | Guardar o aceptar: el botón principal del formulario o del diálogo (Aceptar, Guardar, Confirmar, Calcular cotización, Revisar y confirmar envío, Registrar entrega, Consultar…) |
| F10 | Ir al menú |
| Esc | Cerrar o cancelar. Si hay algo escrito sin guardar, pregunta primero |
| Intro | Siguiente campo. En una lista, abre el registro (lo mismo que el doble clic) |
| Tab / Mayús+Tab | Siguiente / anterior |
| ↑ ↓ | Moverse en las listas y en el menú |
| → ← | Abrir / cerrar una sección del menú (en la barra del cobrador, opción de al lado) |
| Inicio / Fin | Primera / última fila |
| AvPág / RePág | Página siguiente / anterior (en Clientes, la página del servidor) |
| Espacio | Seleccionar la fila o marcar la casilla |
| Ctrl+K | Buscar un cliente o una ruta (ya existía) |

Ninguna choca con el navegador: no se usan F5, Ctrl+W, Ctrl+T ni Ctrl+N. En algunas laptops las teclas F se pulsan
junto con Fn.

**Las teclas se ven en el botón.** El botón que responde a F2, F3, F4, F8 o F9 en la ventana de delante lleva la tecla en
su esquina (por ejemplo, F9 en «Aceptar»). La regla que dibuja la tecla es la misma que la pulsa, así que lo que se ve
es lo que hace. La tecla va en una capa aparte: no cambia el nombre que lee un lector de pantalla; el botón lleva
`aria-keyshortcuts`. Un botón de solo icono, al recibir el teclado, dice qué hace en una pequeña ayuda (lo que el
ratón ve en su título).

## Las reglas, iguales en todas las ventanas

- **Al abrir una ventana, el teclado entra en ella:** en su búsqueda si la tiene, si no en su lista, si no en su primer
  campo. Si la lista llega del servidor un momento después, el teclado pasa a ella mientras no se haya pulsado nada.
  Envíos y Entregas de dinero ya colocaban el teclado ellos mismos (el Remitente sin desplegar su lista, la
  búsqueda de recibos) y se respeta. Al entrar en la aplicación, el teclado empieza en el menú.
- **Al cerrar una ventana,** el teclado va a la ventana que queda delante, donde estaba; si no queda ninguna, al menú.
  Volver a elegir en el menú una ventana ya abierta la trae al frente con el teclado donde se dejó.
- **Diálogos:** el teclado entra en su primer campo; en una pregunta, en «Sí» (Intro = Sí, Esc = No); nunca en la X del
  título. No se escapa mientras están abiertos y, al cerrarse, vuelve a lo que los abrió, aunque eso estuviera un
  momento deshabilitado por estar guardando.
- **Intro pasa al campo siguiente** en todos los formularios (Mayús+Intro, al anterior), como ya hacía Envíos de
  dinero. En el último campo, un formulario normal se envía como siempre (Iniciar sesión, un cliente, un cargo
  recurrente…). **Un formulario con dinero no:** espera a F9 o a su botón. Así un Intro sin querer nunca registra
  dinero. En los filtros de una ventana con lista, Intro en el último aplica el filtro si tiene botón para eso
  («Filtrar», «Consultar») y, si no, baja a la lista.
- **Listas:** son una sola parada de Tab (la fila elegida); ↑ ↓ mueven la fila elegida, Inicio y Fin van a los
  extremos, AvPág y RePág pasan de página (o de pantalla), Intro hace lo del doble clic y Espacio selecciona. ↓ desde la
  búsqueda baja a la lista. En Envíos, las flechas recorren las referencias de la lista.
- **Esc** cierra el diálogo, el recibo o la ventana de delante. Si hay algo escrito que se perdería, pregunta
  «Hay cambios sin guardar. ¿Cerrar sin guardarlos?» (Intro = Sí, cerrar; Esc = No). Los filtros y las búsquedas no
  cuentan como cambios, y lo que ya se guardó tampoco. Esc dentro de una lista desplegada (clientes de Envíos) solo la
  pliega.
- **El teclado nunca se pierde:** si lo que lo tenía desaparece (un diálogo que se cierra, un campo que se deshabilita
  mientras guarda), vuelve al diálogo abierto, a la ventana de delante o al menú.
- **Foco visible:** el elemento con el teclado siempre está marcado, también las filas de todas las listas.
- **Una tecla sin nada que hacer lo dice** («F8: no hay imprimir en esta ventana») en lugar de hacer otra cosa. Una
  tecla Intro mantenida no pulsa, uno tras otro, los botones que un diálogo acaba de poner debajo.

Todo vive en un solo sitio, `app/shared/keyboard.ts` (con `keyboard.css`), instalado una vez por aplicación: no se
reescribieron las ~100 pantallas. Una pantalla que ya maneja una tecla (la lista de clientes de Envíos, un combo) la
conserva; el módulo solo actúa sobre lo que la pantalla deja pasar.

## Qué no cambia

No se tocaron validaciones, permisos ni el servidor. Los nombres de ventanas, opciones y botones son los de siempre.
El ratón funciona igual que antes. F9 pulsa el mismo botón que el ratón, con sus mismas comprobaciones.

## Inventario: cada ventana, antes y ahora

Se hizo en Edge sobre la compilación como en Render, con los datos ficticios de la demo, abriendo cada ventana del
menú, de Configuración de administración y de Reportes (55 para la Administración, 3 para el Cajero) y los botones de
la cabecera. Por cada una se miró: dónde queda el teclado al abrirla, qué reacciona al ratón pero no se alcanza con
el teclado, cuántas paradas de Tab tiene su lista, si las flechas mueven la lista y si Esc la cierra.

| | Antes | Ahora |
|---|---|---|
| Ventanas donde el teclado entra al abrirlas | 2 de 55 (Envíos y Entregas de dinero) | 55 de 55 |
| Ventanas que se cierran con Esc | 0 de 55 | 55 de 55 |
| Listas que se recorren con ↑ ↓ | 0 de 31 | 31 de 31 |
| Listas donde Tab pasa por cada fila | 17 (Clientes: 44 Tab para salir de la lista) | 0: la lista es una sola parada |
| Listas donde Intro no hacía lo del doble clic | 9 (selectores de cliente, cargo y pago autorizado; Bancos; codificadores; Tasas de cambio; Cuadres; herramientas; tabla genérica) | 0 |
| Diálogos de la cabecera que reciben el teclado | 4 de 7 (Facturas, Pagos y Qué hay de nuevo no) | 7 de 7 |
| Al cerrar, el teclado vuelve al botón de la cabecera | 0 de 7 | 7 de 7 |
| Teclas para Nuevo, Buscar, Filtros, Imprimir, Guardar, Menú | no había (solo Ctrl+K) | F2, F3, F4, F8, F9, F10 y F1 |
| Aviso de cambios sin guardar al cerrar con Esc | no | sí |
| Elementos que solo responden al ratón | ninguno habilitado | ninguno |
| App del cobrador: elementos solo de ratón · flechas en su barra | 0 · no | 0 · sí |

El Cajero ve tres ventanas (Envíos de dinero, Entregas de dinero y Cuadres Diarios) más la cabecera: las tres
quedan como las de la Administración. Antes, al abrir Cuadres Diarios el teclado se quedaba en el menú y ninguna
se cerraba con Esc.

### Qué hace cada tecla en cada ventana

Resultado de la prueba `teclado-ventanas-ui` (sin un clic, datos ficticios mínimos: por eso varias listas tienen
menos de dos filas; con los datos de la demo, ↑ ↓ funcionan en las 31 listas). «Intro en la lista» es lo que hace el
doble clic de esa ventana; donde el doble clic solo selecciona, Intro también.

| Ventana | Se abre desde | Al abrirla, el teclado entra en | ↑ ↓ en su lista (datos de la prueba) | Intro en la lista | F2 | Esc la cierra |
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
| Grupos de PCPs | Configuración | la búsqueda | menos de 2 filas | — | — | sí |
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

Esc también cierra cada diálogo que abren Intro y F2, y el teclado vuelve a la ventana. Configuración de
administración y Reportes (las ventanas que lanzan las demás) se abren con Intro desde el menú y sus botones se
recorren con Tab.

## Pruebas

Tres pruebas nuevas en Edge con la aplicación real (portal, API y datos ficticios en memoria), manejadas **solo
con el teclado**: cuentan cada evento de puntero en la página y fallan si hay uno, si hay un error de página o si la
página pide algo fuera de la prueba.

- `app/client-admin/test/teclado-cajero-ui.test.ts`: el Cajero de punta a punta. Entra (Intro de usuario a clave y
  entra), abre su caja (Intro en el efectivo no la envía, F9 sí, Intro confirma), registra un envío completo (remitente
  y destinatario con la lista, monto, F9 cotiza, F9 revisa, Intro en el dinero recibido no registra nada, F9 acepta,
  la pregunta de imprimir), entrega una remesa (busca, ↓ a la lista, Intro abre el recibo, F9 «Registrar entrega»,
  Intro confirma, Esc cierra), cuenta y cierra su caja, abre las notificaciones, la ayuda F1 y cierra la sesión.
- `app/client-admin/test/teclado-admin-ui.test.ts`: Clientes (búsqueda, ↓, Inicio, Fin, una sola parada de Tab,
  AvPág y RePág cambian la página del servidor, Intro abre la ficha, Esc con algo escrito pregunta y «No» vuelve a la
  ficha, F4, F2), un cargo con dinero (Intro de campo en campo, el último no lo envía, F9 lo guarda), Esc con un envío a
  medias, un reporte de remesas (F9 consulta, F8 imprime), un codificador desde Configuración, la ventana de Facturas
  de la cabecera, Ctrl+K y el aviso de una tecla sin nada que hacer.
- `app/client-admin/test/teclado-ventanas-ui.test.ts`: **todas las ventanas**, una por una (53 más las dos que las
  lanzan): se abren con las teclas, el teclado entra, ↓ mueve la lista, Intro abre lo que abre el doble clic y Esc lo
  cierra, F2 abre «Nuevo» y Esc lo cierra, y Esc cierra la ventana. Ninguna tecla guardó nada. De esta prueba sale la
  tabla «Qué hace cada tecla en cada ventana».

Además, el inventario en Edge de la compilación como en Render (arriba) y estas pruebas, todas en verde:

- `pnpm -r typecheck`: verde.
- Interfaz (`client-admin/test` y `tests`): 392 de 392 en verde (contando subpruebas; la de todas las ventanas suma una por ventana).
- Servidor: 410 en verde, 0 fallos (18 omitidas que piden PostgreSQL). El servidor no cambió, así que no hacía falta
  PostgreSQL.
- Cobrador: 17/17.

Pruebas existentes que se ajustaron a las reglas nuevas, sin cambiar lo que comprueban: `envios-review-corrections-ui`
pulsaba Esc «por si acaso» sobre un campo sin lista abierta (ahora Esc cerraría la ventana: solo lo pulsa si la lista
está abierta) y abría la revisión de la caja con Intro en el efectivo (ahora es F9: el dinero no va con Intro).
`remittance-quote-allocation-ui` (arrastrar el diálogo de confirmación por su título) volvió a pasar al dejar el
título fijo arriba.

## Capturas

De la compilación como en Render (`VITE_PUBLIC_DEMO`, `CYP_PUBLIC_DEMO`, `DEMO_MODE`) en Edge, con datos ficticios,
manejando la aplicación solo con el teclado. Están en `docs/teclado-completo/`.

| Captura | Qué muestra |
|---|---|
| `1-envios-con-teclas.png` | Envíos de dinero tras cotizar: F9 en «Revisar y confirmar envío» y F3 en «Buscar» |
| `2-confirmar-envio-f9.png` | La confirmación del envío: el teclado en «Dinero recibido» (Intro no envía) y F9 en «Aceptar» |
| `3-cambios-sin-guardar.png` | Esc con un envío a medias: «¿Cerrar sin guardarlos?», con el teclado en «Sí, cerrar» |
| `4-clientes-flechas.png` | Clientes movida con las flechas: la fila con el teclado marcada; F4, F2 y F3 en sus botones |
| `5-ayuda-de-icono.png` | Un botón de solo icono alcanzado con Tab dice qué hace: «Nuevo · F2» |
| `6-teclas-f1.png` | F1: las teclas de CyP |
| `hoja-atajos-cajeros.png` | La hoja de una página para los cajeros (también en PDF y HTML) |

## Límites

- Mover o cambiar el tamaño de una ventana con el teclado no se añadió: no forma parte de ningún flujo. El botón de
  maximizar sí se alcanza con Tab.
- Los mapas (Monitor, ubicación del cliente) usan las teclas propias del mapa: flechas para moverse, + y − para el zoom.
- Las teclas F dependen de que el navegador tenga el foco en la página (no en la barra de direcciones).
- En la app del cobrador las teclas de lista, campos y menú funcionan igual; sus pantallas son de teléfono y no tienen
  ventanas que cerrar con Esc.
