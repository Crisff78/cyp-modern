# Correcciones de CyP del 9 de octubre de 2026

Esta matriz conserva los 36 puntos anteriores y las 27 solicitudes no vacías de
`C Y P NUEVO.txt`. El documento nuevo contiene además la entrada vacía `5.6`:
son 28 entradas literales, 27 requisitos. El número `3.3.1` está repetido; los
sufijos `a` y `b` de esta matriz distinguen sus dos textos sin cambiar el original.
Los puntos `3.1` y `3.2` de Cargos conservan su numeración escrita.

Fuente de la auditoría inicial: rama `codex/october-nine-corrections`, commit
`60191c943a8cd5118fd8a4d5909f45ec9bbba8b3`. Las implementaciones de este turno
son cambios posteriores en el checkout y requieren su comprobación final.
Documento nuevo leído desde `C Y P NUEVO.txt` en Descargas.
Para las 28 sugerencias anteriores se consultaron los contratos del repositorio
y la matriz histórica local `task/qa/suggestions-v1-20261005/matriz-28-puntos.json`.
Los reportes antiguos son evidencia de su versión, no pruebas de esta revisión.

Estados de esta matriz:

- **Estático:** se encontró código y se leyeron las pruebas indicadas; esa lectura
  no significa que se ejecutaran de nuevo ni acredita la instalación publicada.
- **Implementado; pruebas pendientes:** el cambio de este turno está en el
  checkout y necesita la comprobación aislada antes de cerrarlo.
- **Implementado; comprobación aislada PASS:** pasó el caso indicado con datos
  sintéticos y fuentes reales: API MemoryStore, pruebas de funciones o PostgreSQL
  temporal, según el recibo indicado. No certifica producción.
- **En curso:** el responsable está modificando el módulo; la ubicación indicada
  es el lugar del cambio, no una certificación de su resultado.
- **Pendiente externo:** falta contrato o decisión del proveedor, porcentaje
  comercial o observación física que no sustituye un caso automatizado.
- **Sin requisito:** la entrada del documento no contiene una solicitud.

## Ocho correcciones del handoff

| ID | Requisito | Estado y evidencia de fuente | Pruebas existentes / límite |
|---|---|---|---|
| C1 | Reporte de comisión total de transacción, empresa y gestor; monedas separadas | Estático. `app/server/src/remittance-commission-report.ts`, `app/shared/remittances/commissionOutput.ts`: agrupa por ID del gestor y moneda destino; canceladas aportan cero al saldo vigente y conservan importes anulados. | `app/server/test/remittance-commission-report.test.ts`; `app/client-admin/test/remittance-quote-allocation-ui.test.ts`. No liquida pagos al gestor. |
| C2 | Usuario o correo en alta, edición e ingreso | Implementado; comprobación aislada PASS. `app/client-admin/src/ConnectedCatalog.tsx`, `Users.tsx` y `app/server/src/app.ts` aceptan texto en el campo compatible `email`, con límite y controles. | `app/client-admin/test/account-roles.test.ts`: 6/6 PASS; crear, editar e ingresar con usuario sin correo, mínimo de tres caracteres y vínculos explícitos. Las pruebas de catálogo conservan cuentas con correo. |
| C3 | Selector de la cuenta del cobrador y explicación de la relación | Estático. `ConnectedCatalog.tsx`, `CollectorAccountPicker.tsx` y `collectorAccountOptions.ts`: selección explícita de cuenta compatible; datos personales del cobrador separados de su cuenta. | `app/client-admin/test/account-roles.test.ts` y `app/server/test/account-roles.test.ts`. El vínculo informativo no concede un rol. |
| C4 | Selección múltiple de permisos y guardado conjunto | Estático. `ConnectedUserPermissionsDialog.tsx` guarda el conjunto de IDs con revisión; `app/server/src/user-permissions.ts` valida y persiste. | `user-permissions-ui.test.ts` y `app/server/test/user-permissions.test.ts`. Son asignaciones legacy; las operaciones efectivas siguen limitadas por rol. |
| C5 | Autocompletado de login y contraseña visible | Estático. `app/shared/LoginPasswordInput.tsx`, `loginCredentials.ts`, los formularios de Admin/PWA: `name`, `autocomplete` y lectura de valores actuales. | `collector-login-ui.test.ts`, `login-notifications.test.ts`. Guardado del navegador confirmado por el usuario, sin comprobación independiente del asistente. |
| C6 | Botones grandes Cobros verde, Pagos rojo y Remesas azul | Implementado; comprobación aislada PASS. `App.tsx`, `styles.css` y `suggestions-shell.css` conservan controles grandes y colores distintos; Cargos, Cobros, Descargos, Pagos, Remesas y Cuadres tienen destinos propios. | `october-nine-shell-ui.test.ts`: caso de Dashboard. Sustituye el comportamiento histórico donde Cobros abría Cargos y Pagos abría Descargos. |
| C7 | Cotizar desde origen o destino y equivalente DOP de solo lectura | Estático. `app/server/src/remittances.ts` convierte con BigInt; `RemittancesWorkspace.tsx` muestra intención, resultado real y diferencia de redondeo. | `remittance-allocation.test.ts`, `remittance-quote-allocation-ui.test.ts`. DOP es indicativo y no crea otro saldo. |
| C8 | Configuración central y reparto automático; gestor sobre importe final de destino | Estático; porcentaje comercial pendiente. `remittances.ts` conserva revisión e importes al crear; `RemittancesWorkspace.tsx` aplica la política como solo lectura. | `remittance-commission-policy.test.ts`, `remittance-allocation.test.ts`. Configuración inicial 0%; Gerencia aún debe indicar los porcentajes comerciales. |

## Veintiocho sugerencias anteriores

| ID original | Solicitud | Estado / fuente | Pruebas o límite |
|---|---|---|---|
| 1.1 | Acceso Administración/Cobrador | Estático. Login de `App.tsx` y `app/client-collector/src/App.tsx`, con destinos y roles explícitos. | `collector-login-ui.test.ts`, `login-notifications.test.ts`. |
| 1.2 | Campana y recibos | Estático. `collectionAlerts.ts`: separa cobrador y moneda, omite cancelaciones y espera aceptación del depósito. | `client-search-alerts-suggestions.test.ts`. |
| 1.3 | Ayuda de iconos | Evidencia histórica y atributos presentes; sin nueva auditoría exhaustiva de todos los iconos. | Matriz histórica: 23 títulos y 73 criterios DOM/hover en su corte; no prueba el tooltip nativo de Windows. |
| 2.1 | Límites del cobrador separados de datos personales | Estático. Editor exclusivo y `/api/cobradores/:id/limites` con los dos límites DOP. | `catalog-suggestions.test.ts`, `admin-catalog-suggestions.test.ts`: cancelación, replay y conservación de identidad. |
| 2.2 | ID de estación / RRAA | Validación estática; identificación automática del equipo pendiente externo. `rraa.ts`, `admin-tools-routes.ts`, `ConnectedAdminTools.tsx`. | `rraa.test.ts`, `rraa-stations-ui.test.ts`. `deviceId` se introduce manualmente; el UUID del catálogo no es identidad física. |
| 2.3 | Confirmar activación/inactivación de estación | Estático. `ConnectedAdminTools.tsx` confirma el cambio de estado; el servidor vuelve a consultar RRAA para activar. | `rraa-stations-ui.test.ts`, `rraa.test.ts`. Inactivar sigue disponible sin proveedor. |
| 2.4 | Activo y monto fijo independientes | Estático. `ConnectedCatalog.tsx` mantiene las dos columnas y controles. | `admin-catalog-suggestions.test.ts` contempla las cuatro combinaciones. |
| 2.5 | Precio, moneda, impuesto, beneficio y cantidad | Estático. `ConnectedCatalog.tsx`, `catalog-routes.ts`: referencias manuales opcionales, moneda explícita y unidad informativa. | `catalog-suggestions.test.ts`; no fórmula fiscal, stock ni cálculo de beneficio inventado. |
| 2.6 | Solicitudes de autorización y origen | Estático. `admin-tools.ts` guarda `createdBy` desde la sesión; `ConnectedAdminTools.tsx` lo muestra en el detalle. | Ayuda de alcance y pruebas de catálogo. La decisión no registra cobros/pagos ni amplía permisos. |
| 2.7 | Tasas positivas menores de uno | Estático. `rateInput.ts`, `remittances.ts`, `ConnectedExchangeRates.tsx`. | `rateInput.test.ts`, `exchange-rate-flow.test.ts`, caso 0.005000 del catálogo. |
| 2.8 | Clave mínima de tres caracteres | Estático, preservado por los cambios de usuario/correo. `app.ts`, `Users.tsx`, `ConnectedCatalog.tsx`. | `client-user-suggestions.test.ts`, `admin-catalog-suggestions.test.ts`. Hash, revocación y mínimo independiente de bootstrap se conservan. |
| 2.9 | Apodo y nota de cuenta | Estático. `Users.tsx`, `ConnectedCatalog.tsx`, `app.ts`: datos informativos con límites. | `client-user-suggestions.test.ts`; una edición informativa no cambia credenciales o rol. |
| 2.10 | Permisos y roles | Estático. Catálogo legacy persistido por usuario; autorización efectiva por rol en servidor. | `user-permissions.test.ts`, `account-roles.test.ts`; seleccionar todos no convierte una cuenta en Admin. |
| 3.1 | Buscar teléfono, código y nota | Estático. `clientSearch.ts`, búsqueda autenticada de Remesas y botón de teléfono como código en `App.tsx`. | `client-phone-code.test.ts`, `client-search-alerts-suggestions.test.ts`; selección explícita, personas distintas con teléfono compartido. |
| 3.2 | Moneda preferida | Estático. `clientCurrency` y preferencias persistidas de clientes. | `client-user-suggestions.test.ts`; DOP histórico/default, preferencias independientes del remitente y destinatario. |
| 3.3 | Copiar teléfono a celular/nota | Estático. `copyPhoneIntoEmptyFields` y acción explícita del formulario de cliente. | `client-search-alerts-suggestions.test.ts`; conserva los valores ya escritos. |
| 4.1 | Pares de moneda y tasa de origen a destino | Estático. `crossRate.ts`, `RemittancesWorkspace.tsx`, conversión del servidor. | `crossRate.test.ts`, `remittance-client-picker.test.ts`; presentación aproximada identificada. |
| 4.2 | Contactos en remesa y recibos | Estático. El servidor captura ambos contactos y la UI los consulta individualmente. | `remittance-suggestions.test.ts`, `remittance-client-picker.test.ts`; históricos ausentes no se rellenan con datos actuales. |
| 5.1 | Depósitos mixtos, banco, referencia y comprobante | Estático. `depositComponents.ts`, schemas de `app.ts`, validación del dominio y flujo de recibos. | `deposit-components-suggestions.test.ts`, `deposit-components.test.ts`; suma exacta, denominaciones solo del efectivo, impresión física pendiente. |
| 6.1 | Botones principales | Implementado; comprobación aislada PASS. Coincide con C6; se conservan diseño, colores y botones, con destinos explícitos. | Caso de Dashboard de `october-nine-shell-ui.test.ts`; la evidencia histórica SHELL-LAUNCHERS corresponde a la versión anterior. |
| 6.2 | Listado inicial y Nuevo envío | Estático. `RemittancesWorkspace.tsx` inicia con el formulario cerrado y conserva listado. | UI de remesas y cotización/reparto. |
| 6.3 | Remesas del Exterior separada de Cargos | Estático. Alta de Cargos redirige al formulario completo; edición de un cargo histórico conserva su contrato. | `App.tsx`; evidencia histórica SHELL-PICKER-CARGO. |
| 6.4 | Buscar teléfono de Haití / entrada grande | Estático. Búsqueda autenticada por contactos y campo de 48 px/17 px. | `remittance-client-search.test.ts`, `remittance-client-picker.test.ts`; sin unicidad ni identificación automática. |
| 6.5 | Búsqueda predictiva | Estático. Resultados acotados y selección explícita; respuestas tardías descartadas. | `remittance-client-picker.test.ts`: teclado, homónimos, errores y consultas tardías. |
| 6.6 | Monedas propias de cada cliente | Estático. Seleccionar cada contacto aplica su preferencia e invalida cotización anterior. | Pruebas compartidas de sugerencias y picker; importes confirmados en servidor. |
| 6.7 | Hora de cotización e historial intradía de tasa | Estático. Marca UTC del servidor, actor y revisión explícita; presentación Santo Domingo. | `remittance-suggestions.test.ts`; A→B→A no revive una cotización y no inventa horas históricas. |
| 6.8 | Comisión del gestor | Estático; regla vigente coincide con C8. El registro manual anterior se conserva solo como anotación histórica. | `remittance-allocation.test.ts`, `remittance-commission-policy.test.ts`; porcentaje comercial pendiente. |
| 7.1 | Reporte de comisiones por fechas | Estático. Coincide con C1; fechas inclusivas de emisión en Santo Domingo y estado actual. | `remittance-commission-report.test.ts`, `remittance-suggestions.test.ts`; no reporte de devolución por fecha de cancelación. |

Se corrigió el comprobante de remesas en `commissionOutput.ts` y
`RemittancesWorkspace.tsx`: la impresión tras guardar y desde el detalle conserva
el total recibido, que incluye la comisión, y omite su desglose en el recibo del
cliente. El reporte administrativo conserva sus columnas de transacción, empresa
y gestor. El caso de impresión de `october-nine-financial-ui.test.ts` pasó con
salida HTML real; no acredita impresión física.

## Documento nuevo: 27 requisitos y una entrada vacía

Las ubicaciones corresponden a la implementación del checkout. Los resultados
indicados son comprobaciones aisladas de los casos descritos, con datos sintéticos;
no acreditan publicación, CI de un commit final ni la salida de una impresora.
En la tabla, **shell** corresponde a `october-nine-shell-ui.test.ts`, **financial**
a `october-nine-financial-ui.test.ts`, **reporting** a
`october-nine-reporting.test.ts` y **contratos** a
`app/server/test/october-nine-contracts.test.ts`.

| ID literal / distinción | Solicitud conservada | Estado | Implementación y evidencia |
|---|---|---|---|
| 1.1.1 | Entrega: buscar beneficiario/remitente por serie, teléfono, nombre, identificación o nota | Implementado; comprobación aislada PASS | Entregas de Dinero de oficina (`office_delivery`) en `App.tsx`: ID/referencia/recibo, celular/nombre/identificación del cobrador, nota y actor persistido de oficina. Caso Entregas de **shell**. Además, Recibos de remesas en `app/shared/remittances/RemittancesWorkspace.tsx` busca referencias, nota y los contactos guardados al registrar la operación; el caso focalizado de contactos de **contratos** comprueba su identificación legal congelada. No se agrega un cliente artificial a una entrega de oficina ni se rellenan contactos históricos ausentes. |
| 1.1.2 | Doble clic en una entrega abre su detalle | Implementado; comprobación aislada PASS | `App.tsx`: doble clic o Enter abre el movimiento real de oficina, con actor, cobrador, moneda, importe, nota, cancelación y denominaciones. Caso Entregas de **shell**. También se agregó doble clic al listado de Recibos/Envíos en `RemittancesWorkspace.tsx`, cuyo detalle consulta los contactos de la operación; **financial** comprueba búsqueda por identificación legal guardada y doble clic en Recibos. |
| 1.2.1 | Tasas: registro más reciente arriba y más antiguo abajo | Implementado; comprobación aislada PASS | `ConnectedExchangeRates.tsx` ordena fecha y último cambio descendentes; `RemittancesWorkspace.tsx` ordena tasas vigentes e historial con lo más reciente arriba. **Financial** comprueba el visor; se conserva el orden explícito solicitado aunque el documento lo llame ascendente. |
| 1.2.2 | Botón Tasas de Envíos muestra historial sin alta/edición | Implementado; comprobación aislada PASS | `RemittancesWorkspace.tsx`: tablas de consulta de tasas vigentes e historial sin controles de escritura; altas/ediciones quedan en `ConnectedExchangeRates.tsx`, dentro de Administración. Caso Remesas de **financial**. |
| 1.2.3 | Tasas de Envíos proceden de la tasa fijada en Administración | Implementado; comprobación aislada PASS | Visor y cotización usan tasas centrales del servidor; el envío conserva su revisión histórica. **Financial**, **contratos** y la integración PostgreSQL comprueban tasas guardadas e historial inmutable. |
| 2.1.1 | Cuadre diario: poder cambiar moneda | Implementado; comprobación aislada PASS | `App.tsx`, `ConnectedSettlements.tsx` y `settlementCurrencies.ts`: filtro/consulta por moneda y salida correspondiente. Caso de cuadre de **financial** y filas de **reporting**. |
| 2.1.2 | Cuadre para todas las monedas con movimientos | Implementado; comprobación aislada PASS | Previsualización y cierre conservan `totalsByCurrency`; DOP, USD y EUR se muestran por separado, sin compensar diferencias entre monedas. **Financial**, **reporting**, **contratos** y dos casos focalizados de previsualización; históricos DOP siguen legibles. |
| 3.1 (Cargos) | Quitar la palabra Tasa del campo Cantidad | Implementado; comprobación aislada PASS | `App.tsx`: etiqueta Cantidad. Caso de Cargos/denominaciones de **shell**. |
| 3.2 (Cargos) | Mover el icono de subir archivo junto a los de la izquierda | Implementado; comprobación aislada PASS | `App.tsx` y `styles.css`: importar comparte el grupo izquierdo de la barra de Cargos. **Shell** comprueba posición y SVG visible. |
| 3.2.1 | Explicar qué información busca el botón Buscar de Cargos recurrentes | Implementado; comprobación aislada PASS | `ConnectedCatalog.tsx`: ayuda visible y asociada al campo; concepto, nota, código o nombre del cliente, combinados con fecha de inicio, cliente y estado. Caso `recurring-filters` en `admin-catalog-suggestions.test.ts`: 2/2 PASS contando el contenedor. |
| 3.3.1-a | Mover ubicación e impresión junto a los iconos de la izquierda | Implementado; comprobación aislada PASS | `App.tsx` y `styles.css`: mapa e impresión junto a los demás controles de Cobros, a la izquierda. Posiciones comprobadas por **shell**. |
| 3.3.1-b | Agregar banco, referencia y nota al formulario de Cobros | Implementado; comprobación aislada PASS | `CentralCollectionDialog` en `App.tsx`, `/api/cobros/central` y catálogo de bancos: `bankId`, `reference` y `note` opcionales; el movimiento guarda el nombre del banco para mantener el recibo histórico. Persistencia comprobada por **shell**, **contratos** y PostgreSQL. |
| 3.3.2 | Resaltar más el registro seleccionado de Cobros | Implementado; comprobación aislada PASS | Filas de `App.tsx` y `styles.css`: fondo/borde de selección y `aria-selected`. Caso Cobros de **shell**. |
| 3.3.3 | Imprimir listado de Cobros como listado; conservar impresión individual por separado | Implementado; comprobación aislada PASS | `App.tsx`: Listado de Cobros imprime una tabla única con filtros, movimientos y totales por moneda/estado; la opción actual conserva el recibo individual. **Shell** inspecciona ambas ventanas de impresión; no acredita salida física. |
| 3.4.1 | Denominaciones de monedas en orden ascendente | Implementado; comprobación aislada PASS | `DENOMS` y depósito de `App.tsx`: presentación ascendente; el refresco automático sigue descomponiendo desde la mayor denominación. **Shell** comprueba ambas propiedades. |
| 4.1.1 | Configurar compra y venta en Administración → Tasas | Implementado; comprobación aislada PASS | `ConnectedExchangeRates.tsx` y servidor: `purchaseRate`/`saleRate` persistidas e históricas, separadas de `rate`, la tasa operativa de remesas. DOP mantiene las tres referencias en uno y de solo lectura. **Financial**, **reporting**, **contratos** y PostgreSQL. Son referencias informativas; no se inventa una regla para elegir compra/venta en la conversión. |
| 4.1.2 | Botón para administrar los bancos usados por otros formularios | Implementado; comprobación aislada PASS | Administración → Bancos en `App.tsx` y `ConnectedBanks.tsx`; `/api/bancos` permite alta, edición y activación/inactivación, conservando referencias históricas. Caso Bancos de **shell** y **contratos**. |
| 4.2.1 | Botón de generación secuencial ascendente de código de cliente | Implementado; comprobación aislada PASS | `ClientDataDialog` y `client-identities.ts`: `/api/clientes/sugerencias` reserva una secuencia en el servidor; ambos botones reutilizan una reserva por formulario. **Shell**, **contratos** y concurrencia PostgreSQL. En edición con identificación interna permanente se deshabilita generar otro código reservado; la edición manual permanece disponible. La reserva consumida se retira del registro local y de la actualización de ubicación, incluso si falla la recarga tras el alta; regresión comprobada por **shell**. |
| 4.2.2 | Botón de generación secuencial ascendente de identificación de cliente | Implementado; comprobación aislada PASS | Se interpreta como identificación interna de CyP (`internalIdentification`), separada del UUID y del documento legal obligatorio. El servidor asigna la reserva al guardar y conserva una identificación interna permanente; clientes antiguos pueden recibirla una vez. **Shell**, **contratos** y PostgreSQL. No se fabrica cédula/pasaporte. |
| 5.1 | Botón Cuadre del día abre la pantalla correcta | Implementado; comprobación aislada PASS | Dashboard de `App.tsx`: abre Cuadres Diarios mediante navegación MDI. Caso Dashboard de **shell**. |
| 5.2 | Espacio para logo del cliente en Dashboard | Implementado; comprobación aislada PASS | `App.tsx`, `components.tsx` y configuración `companyLogoDataUrl`: logo PNG/JPEG/WebP opcional, máximo 24 KiB de cadena codificada (archivo aproximadamente 18 KiB), con CyP por defecto. **Shell** comprueba guardado, presentación y rechazo por tamaño. Gamera se identifica como soporte, sin atribuirle la marca del cliente. |
| 5.3 | Destacar mejor los módulos del panel principal | Implementado; comprobación aislada PASS | `App.tsx` y `styles.css`: grupos, estado seleccionado y accesos centrales más visibles; conserva las funciones MDI. Caso Dashboard de **shell**. |
| 5.4 | Módulo de soporte técnico en el panel izquierdo | Implementado; comprobación aislada PASS | Acceso Soporte Técnico y pantalla informativa en `App.tsx`; **shell** comprueba apertura. No envía mensajes a terceros. |
| 5.5 | Herramienta para cambiar la clave propia | Implementado; comprobación aislada PASS | `OwnPasswordDialog` de `App.tsx` envía clave actual y nueva a `/api/usuarios/:id/clave`; el servidor exige la actual y revoca sesiones al guardar. **Shell** usa una API/sesión sintética separada y comprueba rechazo de la anterior, cierre de sesión e ingreso con la nueva; **contratos** cubre cuentas iniciales. |
| 5.6 | Entrada vacía en el documento | Sin requisito | Se conserva el ID; no se crea una función para un texto ausente. |
| 6.1 | Color consistente o mayor visibilidad de iconos | Implementado; comprobación aislada PASS | SVG y contraste de barras en `App.tsx`, `components.tsx` y `styles.css`; **shell** comprueba iconos visibles. Capturas de recibo y detalle de entrega inspeccionadas visualmente; no es una auditoría exhaustiva de todos los iconos del sistema. |
| 6.2 | Fechas inicial/final predeterminadas de la semana en curso | Implementado; comprobación aislada PASS | `app/shared/operationalWeek.ts`: lunes–domingo en `America/Santo_Domingo`, usado por filtros de `App.tsx`, recurrentes, Cuadres y reportes de remesas. **Reporting** cubre medianoche UTC y cambio de año; **shell** y `recurring-filters` verifican fechas iniciales y conservación de la elección al actualizar. |
| 6.3 | Herramienta para definir la nota impresa al pie de los recibos | Implementado; comprobación aislada PASS | Configuración `receiptFooterNote` (máximo 2000 caracteres), recibos de Cobros/Entregas/Depósitos en `App.tsx`, salida de remesas y recibos del servidor. **Shell**, **financial**, **reporting** y **contratos** comprueban texto literal, saltos de línea, escape HTML y nota vacía; impresión física pendiente. |

## Comprobación final y pendientes externos

Esta sección registra las pruebas efectivamente ejecutadas y el corte de cada
recibo. Falta incorporar el resultado de la comprobación general final y las
evidencias de publicación y CI. Una lectura de fuente, un build
anterior o CI de otro commit no equivale a esa comprobación. No se usa la base
compartida para habilitar casos omitidos. TestSprite está excluido por decisión
del usuario.

Comprobaciones aisladas ejecutadas durante este turno:

- `pnpm --filter @cyp/server exec tsx --test --test-concurrency=1 ../client-admin/test/october-nine-shell-ui.test.ts`:
  **9/9 PASS**, ocho casos funcionales y su contenedor, sin omitidos. Usa el App
  y estilos reales: Dashboard/Cuadres/Soporte, catálogo de bancos, logo y nota
  literal al pie, reserva de cliente y documento legal separado, Entregas de
  oficina y doble clic, barras izquierdas y denominaciones, Cobros con
  banco/referencia/nota y las dos opciones de impresión, cambio de clave propia.
  La sesión de cambio de clave usa otra API MemoryStore para comprobar también
  que la sesión sintética de los demás casos permanece utilizable. Recibo
  `%TEMP%/cyp-october-nine-shell-taDn8I/report.json`:
  fuentes estables, cero errores inesperados de página y 21 intentos externos
  bloqueados, de los cuales nueve pertenecen al inyector conocido y doce a
  mosaicos del mapa; no se registran sus URL ni se permite red externa. Edge
  155.0.4283.45 con perfil temporal. Capturas de recibo de Cobros y detalle de
  Entregas inspeccionadas visualmente. Esta ejecución sustituye al recibo previo
  `%TEMP%/cyp-october-nine-shell-wP1TS7/report.json` sin sumar sus casos.
  Incluye la regresión encontrada en revisión final: un registro local conservaba
  la reserva ya consumida cuando fallaba la recarga posterior al alta, y podía
  reenviarla al guardar ubicación. Con la corrección se simulan exactamente tres
  respuestas 503 de snapshot y se guarda primero la ubicación, luego la edición
  manual, sin recargar la página ni permitir un snapshot exitoso intermedio.
  Ambas escrituras dan 200, omiten `reservationId` e `internalIdentification` en
  el cuerpo y conservan identificación interna, documento legal y coordenadas.
  El recibo confirma una sola reserva y dos actualizaciones, sin conflicto 409.
- `app/client-admin/test/october-nine-financial-ui.test.ts`: **5/5 PASS**, cuatro
  casos y su contenedor, sin omitidos. Compra/venta persisten tras perder el
  reconocimiento de una escritura exitosa y el reintento conserva una sola
  operación; DOP muestra tres referencias de uno de solo lectura; Cuadres filtra
  e imprime DOP/USD/EUR por separado; Remesas consulta tasas centrales y busca
  Recibos por identificación congelada, abre detalle con doble clic e imprime
  total recibido y pie sin desglose de comisión. Recibo
  `%TEMP%/cyp-october-financial-ui-zzcVnR/report.json`:
  MemoryStore, navegador nuevo, localhost, cero errores de página y un origen
  del inyector bloqueado. El propio recibo declara impresión física no probada.
  Esta ejecución final posterior a la limpieza pasó de nuevo 5/5; su salida está
  en `.codex-lab/oct9-review/financial-final.log`. Sustituye como referencia final
  al recibo anterior `%TEMP%/cyp-october-financial-ui-i4Qjgq/report.json`, sin sumar ambas
  ejecuciones como casos diferentes.
- `app/client-admin/test/october-nine-reporting.test.ts`: **4/4 PASS**. Semana
  lunes–domingo de Santo Domingo en medianoche UTC y cambio de año; filas de
  Cuadres por moneda sin sumar ni mutar históricos DOP; confirmación exacta de
  compra/venta; pie de impresión escapado como texto, con saltos de línea y sin
  agregar una nota vacía. Son pruebas de funciones, no salida de impresora.
- `app/server/test/october-nine-postgres.test.ts`: **1/1 PASS** integral sobre
  PostgreSQL aislado y limpio, aplicando las migraciones **001–029**. Comprueba
  contratos nuevos, reservas serializadas de identidad, referencias bancarias
  e instantáneas financieras/contactos inmutables. No usa una base compartida
  ni demuestra que esas migraciones estén aplicadas en producción.
- Suite de contratos del servidor: corte ejecutado de **246 PASS y 12 SKIP**,
  anterior a los últimos casos agregados. Después se ejecutaron por separado
  **1/1 PASS** de contactos legales congelados y **2/2 PASS** de previsualización
  de Cuadres, incluyendo obligaciones de moneda desconocida o en conflicto,
  sin inventar DOP ni leer otro cobrador. Sus casos están en
  `app/server/test/october-nine-contracts.test.ts`. Los resultados focalizados
  no se suman como si fueran una nueva ejecución integral final; los omitidos
  conservan su alcance y no se habilitan contra datos compartidos.
- `app/client-admin/test/client-phone-code.test.ts`: **5/5 PASS**. Conserva el
  contrato del formulario previo cuando no hay identificación interna, el código
  manual y la acción explícita de teléfono como código, sin modificar documento
  legal, UUID ni los datos existentes. Monta el diálogo real con un espía de
  guardado en memoria; no llama a la API.
- `pnpm --filter @cyp/server exec tsx --test --test-concurrency=1 ../client-admin/test/account-roles.test.ts`:
  6/6 PASS, sin omitidos. Cuatro casos de navegador: alta/edición/ingreso con
  usuario, selector de cuenta, alta auxiliar con mínimo de tres caracteres y
  vínculo histórico inactivo. Captura en el directorio temporal
  `%TEMP%/cyp-account-roles-rZ3fR6`. La primera ejecución pasó sus cuatro casos y falló
  por cuatro intentos del inyector del antivirus, bloqueados. El recibo posterior
  distingue ese origen conocido y sigue rechazando cualquier otro origen externo;
  no se cambió el antivirus ni se permitió la petición.
- Con `CYP_QA_CATALOG_CASE=recurring-filters`,
  `pnpm --filter @cyp/server exec tsx --test --test-concurrency=1 ../client-admin/test/admin-catalog-suggestions.test.ts`:
  2/2 PASS, sin omitidos. Confirma semana inicial, las cuatro búsquedas, ampliación
  de fecha, conservación de fechas elegidas al actualizar y bloqueo de rango
  invertido. Recibo temporal `%TEMP%/cyp-admin-suggestions-B4T53h/report.json`, fuentes
  estables, cero escrituras y cero errores de página. El primer intento usó un
  selector de prueba de concepto, aunque la grilla muestra servicio; se corrigió
  ese selector antes de la ejecución aprobada.
- Regresiones finales, cada una ejecutada por separado con aislamiento:
  `app/client-admin/test/admin-catalog-suggestions.test.ts`, **20/20 PASS**;
  `login-notifications.test.ts` junto con `collector-login-ui.test.ts`,
  **9/9 PASS**; `remittance-quote-allocation-ui.test.ts`, **5/5 PASS**;
  `user-permissions-ui.test.ts`, **7/7 PASS**. Se ajustaron los harness de estas
  pruebas a los contratos actuales y al bloqueo del inyector externo, sin
  encontrar nuevos defectos de producto. Estos resultados pueden solaparse con
  casos focalizados anteriores; se conservan como ejecuciones separadas y no se
  calcula un total general sumándolos.
- Typechecks finales de servidor, Administración y Cobrador: **3/3 PASS** con
  `pnpm -r typecheck`, recibo `.codex-lab/oct9-review/typecheck-final.log`.
  Builds finales de los tres paquetes: **3/3 PASS** con `pnpm -r build`, recibo
  `.codex-lab/oct9-review/build-final.log`. El build conserva el aviso de tamaño
  de chunk de Vite; estas comprobaciones locales no certifican CI ni despliegue.
  Después de corregir la reserva consumida del cliente se repitieron typecheck y
  build de Administración: **ambos PASS**, recibo de ejecución `18850`, salida
  **0**. Vite 7.3.6 produjo `index-CSyxz37x.js` (1,092.81 kB) y conservó el aviso
  existente de chunks mayores de 500 kB; no se ocultó ni se desactivó ese aviso.

Las composiciones de navegador usan Edge con perfil temporal, Vite sin archivo
de entorno, API real y MemoryStore, listener propio de loopback y bloqueo de
peticiones externas. La prueba shell monta el App real y ejercita los casos
descritos; las composiciones auxiliares cubren sus pantallas específicas. Ninguna
certifica todas las rutas del producto, impresora, proveedor RRAA o DB publicada.

- RRAA: el contrato actual valida mediante VALSTAT un `deviceId` introducido
  manualmente antes de guardar, activar o agregar un vínculo nuevo. La detección
  automática de identidad física del equipo sigue pendiente del proveedor;
  el UUID de catálogo y los fixtures no la acreditan.
- Gerencia no ha definido el porcentaje comercial; se conserva el valor inicial
  0% hasta su decisión. No se anticipan saldos, pagos o repartos históricos.
- Guardado del navegador cerrado según reporte del usuario; no es una
  comprobación independiente realizada por el asistente.
- Impresión física y legibilidad pendientes de Mayo. PDF, HTML o cola no prueban
  salida física. GPS físico cuenta con la confirmación humana anterior.
- La matriz no certifica cobertura del 100%, ausencia de defectos adicionales
  ni publicación de los cambios de este turno. Tampoco afirma una comprobación
  general final verde ni CI/despliegue de estos cambios; ese resultado se agregará
  cuando exista el recibo correspondiente.
