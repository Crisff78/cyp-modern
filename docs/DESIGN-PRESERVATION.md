# Conservación del diseño administrativo

La referencia visual es el trabajo del compañero en `9c66366`. Conectar una
pantalla a la API debe conservar su estructura visual, barras de herramientas,
tablas compactas, filtros y diálogos. Las funcionalidades nuevas se integran en
esa estructura; no se reemplaza la pantalla por un formulario genérico.

## Vistas recuperadas

| Grupo | Pantallas | Datos y acciones conservados |
| --- | --- | --- |
| Administración | Estaciones, grupos de PCPs, PCPs, sesiones, trazas y solicitudes de autorización | Altas, modificaciones, bajas disponibles, asociaciones, revocación de sesiones, consulta paginada y resolución de solicitudes |
| Catálogos | Cobradores, rutas, zonas, servicios/productos, motivos de atraso, usuarios y cargos recurrentes | Consulta, búsqueda, alta, edición, activación/inactivación y cambio de clave |
| Reportes conectados | Pendientes de pago por cliente/ruta/zona, pagos, pagos por servicio resumido/detallado y servicios por zona | Filtros, cálculos existentes, separación por moneda, CSV e impresión |
| Cuadres diarios | Listado, detalle y generación/cierre | Preview y cierre real con diferencia cero |
| Tasas de cambio | Listado y edición de la tasa diaria | Tasa única DOP por unidad, jornada actual, autorización e idempotencia |

Son 22 vistas. `LegacyConnectedUi.tsx` comparte la presentación original para las
vistas conectadas. Los estilos nuevos están limitados a esas vistas. Los módulos
de Envíos de Dinero y del cobrador conservan sus mejoras actuales.

## Presentación y comportamiento

- Las flechas navegan por los registros; no alteran el orden guardado.
- Seleccionar una fila habilita sus acciones. El doble clic abre la edición o
  el detalle cuando la operación está disponible.
- Las acciones que antes eran únicamente simulaciones locales no se presentan
  como operaciones persistentes. Las relaciones se muestran con datos reales.
- La API sigue siendo la autoridad sobre permisos, importes y estados.
- Clientes conserva el código interno separado del campo "Cédula / pasaporte".
  Las altas nuevas requieren un documento escrito por el usuario. Los registros
  anteriores sin documento siguen editables; las columnas de identificación no
  sustituyen un documento faltante por el UUID ni por el código interno.
- Una ubicación sin coordenadas muestra "No definida". El mapa de selección se
  abre por una acción explícita; una vista general del mapa no se guarda como
  ubicación del cliente. Se conservan las coordenadas que ya estaban registradas.

## Límites del modelo actual

No existen tasas separadas de compra y venta; se muestra la tasa diaria real.
Cuadres no expone desglose efectivo/cheque ni apertura/final editable. Sesiones
no incluye estación; la versión recibida y algunos datos de cliente/ruta de PCP
tampoco están disponibles. Las solicitudes se crean o resuelven, sin inventar
edición o eliminación. Los permisos de usuarios siguen definidos por rol.

Estos límites ya pertenecen al modelo conectado. Recuperar el diseño no autoriza
a fabricar datos, modificar el esquema ni convertir una acción visual en una
operación financiera nueva.
