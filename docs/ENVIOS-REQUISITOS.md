# Envíos de Dinero — requisitos y decisiones

Especificación funcional de CyP Modern basada en las instrucciones de negocio,
el DDL legado y las notas de pizarra. El contrato de API vigente está en
[ENVIOS-API.md](ENVIOS-API.md) y el esquema en las migraciones `012` y `013`.

## 1. Qué tiene autoridad

1. La lista escrita del jefe define las funciones requeridas: tasas diarias,
   clientes, envíos, recepción/pago, cuadre y cuatro familias de reportes.
2. Su explicación de `idUsuario_Envio` e `idUsuario_Registro` define dos actores
   distintos, aunque habitualmente sean la misma persona.
3. El DDL de `Envios_Dineros` describe el registro legacy. Se adapta a PostgreSQL
   y al modelo de auditoría de CyP; no se ejecuta como script SQL Server.
4. La primera imagen adjunta es una reconstrucción de otra IA, con texto marcado
   como dudoso. No es una transcripción verificada del audio ni una foto original
   de aquella pizarra. No se recibió audio en esta solicitud.
5. La segunda imagen muestra Control, un teléfono, Tablet y un bloque Memoria
   con 58.5, 59.4, 58.7, 56.6 y 54.4. No establece unidades ni una regla operativa.
   Esos números no son tasas configuradas ni justifican un módulo de memoria.

La regla de comisión y pago parcial no venía definida en el material recibido.
El propietario del proyecto delegó esas decisiones. Las reglas de la sección
siguiente son elecciones de implementación, no confirmaciones atribuidas al jefe.

## 2. Reglas elegidas

| Tema | Decisión |
|---|---|
| Comisión | Se añade al principal y se cobra en moneda de origen. |
| Total cobrado | Principal + comisión. La comisión no reduce el importe del destinatario. |
| Recepción | Un solo pago completo por envío. No existen abonos parciales. |
| Monedas iniciales | DOP, USD y EUR, con dos decimales; nuevas monedas requieren ampliar el catálogo. |
| Tasa diaria | DOP por una unidad de la moneda; DOP = 1.000000. Cada moneda usada exige tasa de la fecha de negocio actual. |
| Tasa fijada | La cotización se fija al registrar el envío. Cambiar la tasa posterior no recalcula envíos existentes. |
| Cálculo | Importe a recibir = principal × tasa origen / tasa destino. Intermedios enteros BigInt; redondeo half-up al centavo. |
| Cotización antigua | El servidor rechaza confirmar si cambió la tasa o el día desde la cotización. |
| Porcentaje | Puntos básicos enteros: 100 BPS = 1%; rango 0–10000. |
| Cancelación | Solo pendiente; motivo obligatorio; devolución de principal y comisión. No se borra el envío. |
| Envío ya pagado | Estado terminal. No se edita ni se cancela directamente. |
| Registro por otro | Solo administración puede elegir otro usuario activo que realiza el envío. El registrador siempre se obtiene de la sesión. |
| Caja | Caja propia de envíos por operador, moneda y fecha. Debe estar abierta; un pago o devolución exige efectivo suficiente. |
| Cierre | Contado = saldo esperado, exactamente; cierre auditado e irreversible por la UI. No se admiten nuevos movimientos en esa caja cerrada. |
| Clientes inactivos | Se conservan para historia, pero no admiten nuevos envíos. Inactivarlos no impide resolver un envío ya registrado. |
| Referencias | ENV######## y REC######## relacionadas uno a uno; únicas y sin reutilización tras cancelar. El código operativo aleatorio no autoriza un pago. |
| Fechas | Timestamps UTC; jornada y filtros inclusivos en America/Santo_Domingo. |

Ejemplo hipotético: principal USD 100.00, comisión 5%, tasa USD 59.400000 y
destino DOP. El remitente entrega USD 105.00 y el destinatario recibe
DOP 5,940.00. Son cifras ilustrativas, no una tasa ni comisión de producción.
El porcentaje se selecciona explícitamente al crear el envío; no se impone el
10% dudoso de la reconstrucción.

## 3. Matriz del alcance

Esta matriz recoge las brechas observadas antes de implementar el módulo, desde
la base `74cead7`. El estado vigente se consulta en el código y el contrato API.

| Requisito del jefe | Base observada en 74cead7 | Trabajo definido |
|---|---|---|
| 1.1 Tasas diarias | Tabla exchange_rates sin API; pantalla solo React y valores fijos. | API y persistencia real; vista conectada; fecha/tasa validadas. |
| 1.2.1 Listar clientes | Lista y API existentes. | Mostrar estado persistido y usar catálogo mínimo en envíos. |
| 1.2.2 Agregar cliente | API existente. | Reutilizar el alta y sus validaciones. |
| 1.2.3 Modificar cliente | API existente, incluido GPS. | Reutilizar edición; conservar historia. |
| 1.2.4 Inactivar cliente | Solo estado React, perdido al refrescar. | Campo active persistido y operación administrativa. |
| 1.2.5 Localización | Coordenadas persistidas; mapa con posiciones calculadas de forma ficticia. | Coordenadas manuales/GPS reales y visualización geográfica honesta. |
| 2.1.1 Listar envíos | No existe entidad de envío entre clientes. | Listado por permisos, referencias, estado, monedas y actores. |
| 2.1.2 Agregar envío | No existe. | Cotización, confirmación, caja, auditoría e idempotencia. |
| 2.1.3 Cancelar envío | No existe. | Cancelación pendiente con motivo y devolución auditada. |
| 2.2.1 Listar recibos | Los recibos existentes son comprobantes de cobros/pagos. | Recepciones de envíos, pendientes y pagadas, sin reutilizar enlaces públicos de comprobantes. |
| 2.2.2 Pagar recibo | Pagos existentes abonan autorizaciones de otro flujo. | Pago único contra envío y caja del receptor autorizado. |
| 3.1 Cuadre de caja | Cuadre de cobradores DOP para otro libro. | Caja de envíos por operador y moneda, apertura, movimientos y cierre. |
| 3.2 Montos enviados | No existe. | Totales por par de monedas, cantidades y estados. |
| 3.3 Tiempos de recepción | No existe. | Diferencia entre emisión y pago, mínimo/promedio/máximo y detalle. |
| 3.4 Dinero entregado | No existe. | Importes efectivamente pagados, por moneda de destino. |
| Resumen por rango / detalle diario | No existe para envíos. | Ambas modalidades en todas las familias anteriores. |

`Entregas de Dinero` (`office_delivery`) es efectivo que la oficina entrega al
cobrador. Sigue siendo una operación distinta de un envío entre clientes.
Los movimientos DOP previos conservan sus contratos; la nueva caja no cambia sus
saldos ni pretende ser contabilidad general.

## 4. Correspondencia con Envios_Dineros

| Columna legacy | Correspondencia y tratamiento moderno |
|---|---|
| idEnvio_Dinero | ID interno independiente; referencias correlativas separadas. No inferir IDENTITY: el DDL no lo declara. |
| Envio_Dinero | Referencia visible ENV########. |
| Codigo_Envio | Código operativo generado por servidor; no sustituye sesión/permisos. |
| Fecha_Envio | createdAt asignado por servidor al crear. |
| idMoneda_Envio / idMoneda_Recibo | sourceCurrency / destinationCurrency de catálogo. |
| idCliente_Envio / idCliente_Recibo | senderClientId / recipientClientId; son clientes, no usuarios operadores. |
| Importe_Envio | amount, principal en centavos de moneda origen. |
| Porciento_Comision | commissionBps, sin coma flotante. |
| Comision_Envio | commissionAmount, calculada por servidor en origen. |
| ImporteTotal | totalAmount, calculado y validado. |
| Importe_Recibo | receiveAmount fijado con cotización al alta. |
| Fecha_Recibo / idUsuario_Recibo | paidAt / paidBy, únicamente al entregar el dinero. |
| Activo | Estado explícito pending/paid/cancelled; un booleano no representa por sí solo esos tres estados. |
| Nota | note. |
| idUsuario_Envio | sendingUserId: persona que realiza el envío. |
| idUsuario_Registro / Fecha_Registro | registeredBy desde sesión y fecha del evento de creación. |
| idUsuario_Modificacion / Fecha_Modificacion | Auditoría por eventos; no habilita edición de importes de una remesa registrada. |
| idUsuario_Cancelacion / Fecha_Cancelacion / Nota_Cancelacion | Actor, fecha y motivo del evento de cancelación. |
| idUsuario_Netbanking / Fecha_Netbanking | Referencia legacy sin flujo de negocio solicitado; no se simula una integración bancaria. |

El modelo además conserva ambas tasas y su fecha para poder reconstruir el
cálculo. Esos campos no aparecen en el DDL recibido. Los eventos relacionan
cada efecto de caja con envío, usuario y fecha; la historia financiera no se
reescribe para cancelar o pagar.

Observaciones técnicas del DDL:

- `decimal(5,2)` de comisión solo admite hasta 999.99; es menor que el rango de
  un principal `decimal(9,2)`. No se copia ese límite por accidente.
- No se declaran claves foráneas, unicidad del código, estados ni restricciones
  de importes en el fragmento aportado. La aplicación moderna sí debe validarlos.
- La presentación pegada contiene marcas de escape y paréntesis angulares en
  tipos decimales. Se usa como referencia, no como SQL ejecutable.

## 5. Pantallas y recorrido

Central/admin usa ventanas MDI con el estilo compacto azul/gris de CyP. Teléfono
y tablet presentan el mismo flujo adaptado al espacio. Desde octubre de 2026, en
Administración estas funciones están repartidas en varias ventanas; la ubicación
vigente está en la sección 8. Los pasos siguientes describen el recorrido.

1. Administración mantiene clientes y tasas del día, y abre cajas de operadores;
   el Cajero abre la suya.
2. En Envíos se seleccionan remitente, destinatario, monedas, principal y comisión.
   Central puede indicar quién realiza el envío; se mantiene visible quién registra.
3. El servidor cotiza; la confirmación muestra principal, comisión, total cobrado,
   tasas e importe a recibir antes de guardar.
4. Guardar produce referencias y estado pendiente. Un doble clic o reintento de
   la misma acción no crea un segundo envío.
5. En Recibos, el operador de destino identifica el envío y confirma la entrega
   completa. El servidor comprueba permisos, estado y fondos.
6. En Caja se revisan entradas, devoluciones, pagos, saldo esperado y contado.
7. Reportes permite elegir familia, rango y resumen/detalle diario; impresión
   mediante navegador y exportación CSV describen su formato real.

Los errores de conexión permanecen como errores; no se convierten en éxitos de
un mock. Los formularios conservan el intento incierto y su clave de idempotencia.
Las rutas existentes de demo visual pueden seguir siendo útiles para otros
módulos, pero no acreditan persistencia de estas nuevas operaciones.

## 6. Reportes y definiciones

| Reporte | Fecha del filtro | Resumen por rango | Detalle diario |
|---|---|---|---|
| Envíos / montos | Emisión | Cantidad, principal, comisión y total por par de monedas; estados separados. | Los mismos indicadores por fecha. |
| Recepción / tiempos | Pago | Cantidad y demora mínima, promedio y máxima de los pagados. | Indicadores por día y detalle emisión/pago. |
| Recepción / entregados | Pago | Importe pagado por moneda destino. | Importe y cantidad por día/moneda. |
| Caja | Fecha de caja | Flujos del período por operador/moneda, primer saldo inicial y último saldo esperado. | Cada caja con apertura, entradas, devoluciones, pagos y cierre. |

Pendientes no se consideran entregados ni se introducen como ceros en el promedio
de demora. Cancelados se cuentan como cancelados y no aumentan montos vigentes.
No se suman monedas distintas; tampoco se suman saldos de cierre sucesivos para
presentarlos como dinero del período.

## 7. Elementos que no se convierten en funciones inventadas

WU, R1/R2, Arch/Int, TH, CE, HGU, 64/27 caracteres y otros textos ilegibles no
tienen significado confirmado. No crean una integración bancaria, algoritmo de
código, comisión fija ni restricción de longitud. La personalización conserva la
configuración ya existente; no se infiere un editor de interfaces a partir de una
palabra. Estas referencias se conservan como contexto de origen y no bloquean el
alcance explícito del jefe.

## 8. Ubicación de funciones (octubre de 2026)

En el portal administrativo la ventana Envíos de Dinero queda solo para enviar;
las demás funciones están en sus lugares del sistema. Cada entrada aparece si la
cuenta tiene el permiso indicado (claves de `app/shared/access.mjs`). El grupo
del menú se muestra como «ENVÍOS»; su clave interna sigue siendo `REMESAS`.

| Función | Dónde está | Permiso |
|---|---|---|
| Registrar envíos: formulario fijo arriba, con el cursor en el remitente, y listado de envíos debajo. Alta rápida de clientes con «Registrar cliente nuevo». Cancelación desde el detalle. | Envíos → Envíos de Dinero | `remittances.view` (registrar: `remittances.create`; alta rápida: `remittances.clients.create`; cancelar: `remittances.cancel`) |
| Pagar al destinatario los envíos recibidos | Envíos → Pagos de Envíos | `remittances.receipts` (pagar: `remittances.pay`) |
| Entregas de efectivo de la oficina al cobrador; su buscador abre Pagos de Envíos con los envíos pendientes que coinciden | Envíos → Entregas de Dinero | 380 (buscador: `remittances.receipts`) |
| Abrir, contar y cerrar la caja de envíos | Reportes & Monitoreo → Cuadres Diarios → Caja de envíos | `remittances.cash.view` (abrir: `remittances.cash.open`; cerrar: `remittances.cash.close`) |
| Tasas del día y su historial | Archivos → Admin. → Tasas de cambio | 200 y `remittances.rates.view` (registrar: 201 y `remittances.rates.manage`) |
| Comisiones de envíos | Archivos → Admin. → Comisiones de envíos | rol Admin y `remittances.commissions.view` (cambiar: `remittances.commissions.manage`) |
| Reportes de envíos | Reportes & Monitoreo → Reportes, grupo «-- Envíos de Dinero --» | `remittances.reports` |

Cuadres Diarios reúne dos secciones, «Cuadres de cobradores» (401) y «Caja de
envíos»; el conmutador aparece solo si la cuenta tiene ambas. Admin abre la caja
de cualquier operador; el Cajero, solo la suya; Cobrador, Usuario y Supervisor no
abren cajas.

En la terminal del cobrador la vista Envíos conserva sus pestañas Envíos, Recibos
y Caja, según los permisos de la cuenta, y el botón «Nuevo envío». Los reportes de
envíos se abren desde su propio acceso **Reportes** de la barra inferior
(`remittances.reports`); una cuenta que solo tiene esos reportes ve Reportes y no
la vista Envíos.
