# Revisión de Dionel (26-10-2026): qué se cambió

Corrección aplicada el 26-10-2026 por Claude Code sobre `main` `2619079` (la versión que Render publicó ese día,
`2ee7b02`). Decisiones de Rardiel del 26-10: Facturas y Pagos son las ventanas de la cabecera; «No Definida»
significa «sin asignar», como ya ocurría en la Zona de Clientes.

Antes del cambio se comprobó que Dionel había revisado la versión actual, no una vieja: lo que señala estaba igual
en las versiones publicadas el 23-10 (`11fd8c9`) y el 26-10 (`cc9d6c5` y `2ee7b02`).

## Punto por punto

| # | Pide Dionel | Qué se hizo | Dónde | Captura |
|---|---|---|---|---|
| 1.1 | Botones por temática; Facturas y Pagos juntos | La cabecera queda: Notificaciones · **Facturas** · **Pagos** · Qué hay de nuevo · Tema. En el teléfono y la tableta (menos de 1000 px) esos botones ya estaban ocultos y siguen así | `App.tsx`, cabecera | `1-cabecera.png` |
| 1.2 | El respaldo no va en la interfaz | Se quitó el botón «Hacer copia de respaldo» y su función. El respaldo de la base lo hace el hosting. Mostrar la fecha de los respaldos queda para después | `App.tsx` | `1-cabecera.png` |
| 2.1 | Doble clic en un listado abre la edición | Doble clic o **Intro** hacen la acción por defecto; la barra espaciadora solo selecciona. **Editar:** Clientes, Cargos y Descargos (sin permiso de modificar, Clientes abre la ficha en consulta y Cargos/Descargos lo avisan). **Ver el recibo:** Cobros, Depósitos por Cobradores (comprobante) y Pagos. Los que ya lo tenían siguen igual | `App.tsx`: `ClientsLegacyView`, `ChargesOperationalView`, `PayoutsOperationalView`, cobros de `LegacyOperationView`, `DepositsOperationalView`, `PaymentsOperationalView` | `2.1-clientes.png`, `2.1-cargos.png`, `2.1-cobros.png`, `2.1-depositos.png`, `2.1-descargos.png`, `2.1-pagos.png` |
| 2.2 | Icono de filtros: embudo, no llave; ocultar uno o los dos paneles | El botón «Mostrar/Ocultar filtros» usa un embudo en todas las ventanas que lo tienen (los 11 sitios del código); la llave queda solo para claves. Depósitos por Cobradores, la única ventana con panel de detalle a la derecha, tiene su propio botón «Mostrar/Ocultar detalles». El icono que dibuje Dionel se pone cuando lo mande | `App.tsx`, `ConnectedAdminTools.tsx`, `ConnectedLegacyReports.tsx`, `ConnectedSettlements.tsx`, `LegacyConnectedUi.tsx`, `RemittanceReportView.tsx` | `2.2-icono-filtros.png`, `2.2-depositos-sin-detalles.png` |
| 2.3 | Clientes no debe cargar todos los registros | La ventana pide al servidor solo una página de 50 con sus filtros (búsqueda, identificación, nombre, zona, ruta y estado); «Todos» también va por páginas. Los botones `|<` `<` `>` `>|` ahora son Primera, Anterior, Siguiente y Última página, y el pie dice «Página X de Y». Al guardar un cliente se muestra la página donde quedó | Servidor: `GET /api/clientes/pagina` (`app/server/src/app.ts`); filtro común en `app/shared/clientPage.mjs`; ventana en `App.tsx` | `2.3-clientes.png` (la demo tiene 44 clientes: una página) |
| 2.4 | Ruta «No Definida» como la Zona, en listados y reportes | Clientes: Ruta tiene «No Definida» (clientes sin ruta). Reportes: Ruta y Zona ofrecen «Todas», «No Definida» y la lista, en todos los reportes que tienen esos filtros | `App.tsx` (Clientes y reportes de cargos/cobros), `ConnectedLegacyReports.tsx` (reportes de pagos y servicios) | `2.4-reporte-rutas.png`, `2.4-reporte-zonas.png`, `2.4-reporte-pagos-rutas.png` |
| 3.1.1 | Quitar «Gestor: … Reparto automático…» | Quitado. El reparto del gestor queda como ayuda al pasar el puntero sobre «Comisión (%)», solo para quien puede ver comisiones | `app/shared/remittances/RemittancesWorkspace.tsx` | `3.1-envios-de-dinero.png` |
| 3.1.2 | Quitar «Cada cliente carga su moneda habitual…» | Quitado. Lo útil pasó a ayudas de su campo: moneda habitual y caja abierta en «Moneda del remitente»; la comisión aparte en «Monto a enviar». Si no hay caja abierta, el aviso de arriba sigue saliendo solo cuando falta | `RemittancesWorkspace.tsx` | `3.1-envios-de-dinero.png` |
| Nota | Interfaz limpia; ayudas como hint | También dejaron de ser texto fijo «Se aplica automáticamente…» (Comisión) y «Envíos registrados por tu operación…» / «Remesas por entregar…» (encima del listado): ahora son ayudas al pasar el puntero | `RemittancesWorkspace.tsx`, `remittances.css` | `3.1-envios-de-dinero.png` |

## Qué pantallas siguen recibiendo todos los clientes, y por qué

La ventana Clientes ya no recibe ni dibuja todos los clientes. La **vista general** que carga la aplicación al entrar
(`/api/snapshot`) todavía trae los clientes, porque otras pantallas los usan para poner el nombre del cliente junto a
cada movimiento o para elegir un cliente:

- Cargos, Cargos Recurrentes, Cobros (y su recibo), Descargos y Pagos.
- Las ventanas Facturas y Pagos de la cabecera, y «Buscar en tu operación».
- Los reportes (cliente, ruta y zona de cada fila), los PCPs y las Solicitudes de autorización.

Pasar esas pantallas a búsquedas del servidor es otro cambio, más grande, que no pidió esta revisión.

## Límites conocidos

- **Ruta «No Definida» en Clientes hoy sale vacía:** la base de datos exige una ruta válida a cada cliente
  (`clients.route_id NOT NULL` con referencia a `routes`). Queda igual que la Zona para que se busque igual en las
  dos; en los reportes sí encuentra filas cuando un movimiento no tiene ruta o zona.
- **Otros listados** (Cargos, Cobros, Depósitos, Descargos, Pagos) mantienen sus filtros de Zona y Ruta con «Todas»
  y la lista; esta revisión pidió «No Definida» en Clientes y en los reportes.
- Pendiente de Dionel: su icono propio para los paneles y la fecha de los respaldos.

## Pruebas

- Tipos (`pnpm -r typecheck`): verde.
- Servidor: 410 en verde, 0 fallos (18 omitidas porque piden PostgreSQL). Nueva `app/server/test/client-page.test.ts`:
  páginas, filtros, «No Definida», página del cliente guardado, Cajero sin acceso y cobrador solo con su ruta.
- PostgreSQL 17 desechable local: 134 en verde, 0 fallos, incluida la variante PostgreSQL de `client-page`. Dos pruebas
  ya fallaban en `main` y se corrigieron sin tocar el programa: `october-nine-postgres` usaba una clave de 14 caracteres
  (la regla pide 15) y `remittance-effective-rates-postgres` migraba solo hasta 039 antes de usar el almacén actual.
- Cobrador: 17/17.
- Interfaz: 334 en verde. Nueva `app/client-admin/test/revision-dionel-ui.test.ts` (Edge, la App real con datos
  sintéticos, 120 clientes): cabecera, doble clic e Intro en los seis listados, embudo y panel de detalle, páginas de
  Clientes, «No Definida» en Clientes y reportes, y Envíos sin los textos fijos; `login-notifications` ajustada al
  nuevo orden de la cabecera. **Falla 1 prueba ajena:** «U9 a retry refused because the permission was withdrawn…» de
  `user-permissions-ui.test.ts`; falla igual en `main` sin estos cambios (comprobado), y con el PR #58 había pasado.
  Causa no investigada a fondo.
- Revisión visual en Edge de la app compilada como en Render (`VITE_PUBLIC_DEMO`, `CYP_PUBLIC_DEMO`, PostgreSQL
  desechable): todos los puntos correctos y cero errores de página; capturas en `docs/revision-dionel-2026-10-26/`.
  Los descargos de la demo no tienen fecha, así que para la captura se vació «Fecha Inicial» (solo el filtro).

## Fuentes

- Corrección: `Revisión de Dionel - 01.txt` (WhatsApp, 26-10-2026).
- Versión de partida: `origin/main` `2619079`; despliegue `2ee7b02` success 2026-10-26 17:47 UTC (API de despliegues).
