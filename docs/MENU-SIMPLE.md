# Menú sencillo y nombres nuevos (2026-10-20)

Pedido del jefe: el sistema tiene que poder usarlo alguien que nunca lo ha visto, sin
perderse. Esta es la regla número uno del proyecto (ver `AGENTS.md`). Este documento
dice dónde quedó cada cosa y cómo se llamaba antes.

## Inicio de sesión

- Una sola página, **Iniciar sesión**, para todas las cuentas. Ya no hay que elegir
  antes entre «Administrador» y «Terminal del cobrador».
- La cuenta de un cobrador pasa sola a la app del cobrador; las demás cuentas, al
  panel de la oficina. Si alguien de la oficina entra por la app del cobrador
  (`/collector/`), también pasa solo a la oficina.
- La sesión pasa en el almacenamiento del navegador que cada portal ya usa, nunca en
  la dirección (URL). Entre los dos servidores de desarrollo (puertos 5173 y 5174) el
  otro portal vuelve a pedir la contraseña; en Render es el mismo sitio y no la pide.

## Menú lateral

- La primera vez, todas las secciones aparecen cerradas.
- Cada cuenta encuentra el menú como lo dejó: las secciones abiertas y si estaba
  estrecho. Se guarda en ese navegador y por cuenta (`cyp-admin-menu:<id>`).
- Al pasar el puntero por una opción aparece para qué sirve; si cambió de nombre,
  dice el nombre anterior.
- CLIENTES y ADMINISTRACIÓN tienen una sola pantalla: el botón la abre directo.

| Sección | Opción | Antes |
| --- | --- | --- |
| CLIENTES | Clientes | ARCHIVOS → Clientes |
| COBROS | Cargos por cobrar | Cargos |
| COBROS | Cargos que se repiten | Cargos Recurrentes |
| COBROS | Cobros realizados | Cobros |
| COBROS | Depósitos de cobradores | Depósitos por Cobradores |
| PAGOS | Órdenes de pago | Descargos |
| PAGOS | Pagos realizados | Pagos |
| PAGOS | Efectivo a cobradores | ENVÍOS → Entregas de Dinero (efectivo que la oficina da al cobrador) |
| REMESAS | Envíos de dinero | ENVÍOS → Envíos de Dinero |
| REMESAS | Entregas de dinero | ENVÍOS → Pagos de Envíos (entregar la remesa a quien la recibe) |
| CUADRES Y REPORTES | Cuadres diarios | REPORTES & MONITOREO → Cuadres Diarios |
| CUADRES Y REPORTES | Reportes | REPORTES & MONITOREO → Reportes |
| MONITOREO | Monitor de cobradores, de zonas y de rutas | Monitor C, Monitor Z, Monitor R |
| ADMINISTRACIÓN | Administración (antes «Panel de Control») | ARCHIVOS → Admin. |

La ventana «Efectivo a cobradores» ya no tiene el buscador de remesas: para entregar
una remesa se usa REMESAS → Entregas de dinero.

## Otros nombres

- Botones rápidos de arriba: ÓRDENES DE PAGO (antes DESCARGOS), ENVÍOS DE DINERO y
  ENTREGAS DE DINERO (nuevo).
- Caja de envíos → **Caja de remesas**; Comisiones de envíos → **Comisiones de
  remesas**; pestaña Recibos de remesas → **Entregas**; botón «Registrar pago
  completo» → **Registrar entrega**.
- Administración: Codificadores → **Datos del negocio**; PCPs → **Puntos de cobro**;
  Grupos → **Grupos de puntos**; Sesiones → **Sesiones abiertas**; Trazas →
  **Historial**; Estaciones → **Estaciones (equipos)**.
- Reportes con nombres completos («Cobros Res.» → «Resumen de cobros», «Pagos x
  servicio detallado.» → «Pagos por servicio (detalle)», etc.). La ventana de cada
  reporte se llama igual que su botón.
- Columnas sin cortar («Imp. Ch...» → «Monto en cheques», «Lim. de C...» → «Límite
  de cobro», «EnL...»/«En...» → «En línea»/«En oficina»).
- Botones «oK» → **Aceptar**. Ventanas «Entre un valor...» → «¿Por qué se cancela?»
  o «Motivo de atraso».
- El rol aparece en español («Administrador», «Cajero»), no como código (ADMIN,
  CASHIER). En la lista de roles, «Admin» pasa a «Administrador».
- Ayuda (antes «Soporte Técnico»): además del contacto, explica qué hay en cada
  sección del menú, con los mismos nombres.

Las reglas de negocio, los permisos y las validaciones del servidor no cambiaron.
