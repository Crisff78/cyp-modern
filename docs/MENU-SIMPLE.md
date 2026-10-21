# Menú sencillo (2026-10-20) y nombres (2026-10-21)

Pedido del jefe: el sistema tiene que poder usarlo alguien que nunca lo ha visto, sin
perderse. Esta es la regla número uno del proyecto (ver `AGENTS.md`). Este documento
dice dónde quedó cada cosa y con qué nombre.

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
- Al pasar el puntero por una opción aparece para qué sirve.
- CONFIGURACIÓN DE ADMINISTRACIÓN va de primera (PR #44). Ella y CLIENTES tienen una sola
  pantalla: el botón la abre directo.

## Nombres (decisión de Rardiel, 2026-10-21)

Las **secciones** (títulos grandes del menú) usan nombres claros. Las **opciones** de
dentro, las ventanas, los reportes, las pestañas y la pantalla de administración
**vuelven a los nombres de siempre**, salvo Remesas y Configuración de administración.

| Sección | Opciones |
| --- | --- |
| CONFIGURACIÓN DE ADMINISTRACIÓN | Configuración de administración (antes «Admin.» / «Panel de Control») |
| CLIENTES | Clientes |
| COBROS | Cargos · Cargos Recurrentes · Cobros · Depósitos por Cobradores |
| PAGOS | Descargos · (Descargos Rec., oculto) · Pagos · Entregas de Dinero a Cobradores |
| REMESAS | Envíos de dinero · Entregas de dinero (antes «Pagos de Envíos») |
| CUADRES Y REPORTES | Cuadres Diarios · Reportes |
| MONITOREO | Monitor C · Monitor Z · Monitor R |

- «Entregas de Dinero a Cobradores» es el efectivo que la oficina le da al cobrador
  (antes «Entregas de Dinero»): se le añade «a Cobradores» para que no se confunda con
  REMESAS → Entregas de dinero. Ya no tiene el buscador de remesas.
- Ventanas con su título de siempre: «Monitor de Cobradores/Zonas/Rutas», «Listado de
  Sesiones», «Trazas del Sistema», «Puntos de Cobros y Pagos», «Reporte de Cobros
  Resumido», etc.
- Reportes: «Cobros Res.», «Cobros Gen. Resumido», «Cobros x Servicio», «Pagos
  detallado.», «Pagos x servicio detallado.», … en grupos «-- Cargos --», «-- Cobros --»,
  «-- Pagos --», «-- Remesas --» y «-- Servicios --».
- Configuración de administración: Codificadores (Estaciones, Grupos, Motivos Atraso,
  PCPs, Servicios y Prods., Sesiones, Trazas…) y Herramientas (Configuración General,
  Solicitudes de Autoriz.).
- Ficha del cliente: pestañas Cargos · Cargos Rec. · Cobros · Descargos · Pagos.
- El botón de abajo del menú vuelve a ser **Soporte Técnico** (contacto y qué hay en cada
  sección).

## Lo que se queda nuevo

- Sin botones rápidos encima del escritorio (CARGOS, COBROS, DESCARGOS…): el jefe pidió
  quitarlos el 2026-10-20. Todo se abre desde el menú lateral, que es un solo camino.
- Remesas: Caja de remesas, Comisiones de remesas, pestaña Entregas y botón «Registrar
  entrega».
- Columnas sin cortar («Monto en cheques», «Límite de cobro», «En línea»/«En oficina»).
- Botones **Aceptar** (no «oK»). Ventanas «¿Por qué se cancela?» o «Motivo de atraso»
  (antes «Entre un valor...»).
- El rol aparece en español («Administrador», «Cajero»), no como código (ADMIN,
  CASHIER).

## Roles (2026-10-20)

- El rol **Usuario** desaparece y entra **Cliente**: una cuenta de un cliente del negocio que por ahora
  no puede entrar a la oficina ni a la app del cobrador, ni recibir permisos.
- Las cuentas que eran Usuario pasan a **Cajero**, que atiende remesas igual (migración
  `036_client_role.sql`; la demo con archivo hace lo mismo al abrirse). Sus sesiones abiertas se cierran.
- El menú **Administración** se llama ahora **Configuración de administración**.

Fuera del cambio de roles, las reglas de negocio, los permisos y las validaciones del servidor no cambiaron.
