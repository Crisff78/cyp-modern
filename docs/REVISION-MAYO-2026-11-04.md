# Revisión de Mayo del 4 de noviembre de 2026

Esta matriz corresponde a la hoja fotografiada del 04-11-2026, no a la numeración de la revisión de octubre.

| Punto | Implementación |
|---|---|
| 1.1.1 | La captura conserva su posición; al cotizar, las tarjetas de importes y Confirmar tienen espacio sobre el listado. La conversión interna por DOP no se muestra. |
| 1.1.2 | Captura y confirmación no muestran ganancia por cambio ni reparto empresa/gestor; permanecen disponibles en sus vistas internas autorizadas. |
| 1.1.3 | Cargo servicio y cargo de entrega se muestran en dinero, sin porcentaje en la captura ni en su resumen. El porcentaje se configura administrativamente. |
| 1.1.4 | Crédito y débito separados; recargo de crédito centralizado y mostrado en dinero. Es un registro de pago externo comprobado, no una pasarela. Solo last4 se persiste. Titular sin números; vencimiento MM/YY y CVV numérico se pueden digitar como prueba temporal opcional, sin envío ni almacenamiento, y se borran al confirmar/cancelar/salir. No usar tarjetas reales en esos controles de demostración. |
| 1.1.5 | Opciones en la confirmación de impresión y en el detalle: papel normal, tres pulgadas/76 mm, 80 mm y 58 mm; recibo resumido para envío telefónico. Conserva referencias, fecha, nombres, teléfonos, importes, forma de pago y pie de empresa. Falta la aceptación física en la impresora de Mayo. |
| 2.1.1 | Caja: búsqueda por rango de fechas (`Desde` y `Hasta`), operador y moneda con `Buscar`, precargando al menos las últimas 2 fechas comparativas disponibles. |
| 2.1.2 | Entregas adicionales registradas, acumuladas y reflejadas en caja/reportes. |
| 2.1.3 | El saldo no descargado al cerrar pasa a la próxima apertura, por operador y moneda; si queda una caja anterior abierta se muestra su saldo pendiente bloqueado (nunca `0.00`), el arranque de datos ficticios arrastra cierres existentes y las cajas históricas previas a la regla muestran nota de auditoría cuando abrieron en cero sin descargo. |
| 2.1.4 | El cierre anterior distinto de cero fija la apertura para todas las cuentas, incluida Administración. Solo si es cero se mantiene la regla del permiso existente para editar; primera apertura editable. API y UI coinciden. |
| 3.1.1 | En Tasas salen primero las tasas vigentes de cada moneda y debajo las últimas registradas (sustituidas/anteriores) en orden cronológico inverso, sin edición sobre las sustituidas ni solapamiento de cabecera. |
| 3.1.2 | Se utiliza la última tasa por moneda aunque sea de días anteriores; no obliga a registrar una cada día. |
| 4.1 | Soporte Técnico permanece visible al pie del panel izquierdo de módulos sin cubrir las secciones desplegadas y carga sus datos públicos (`/api/soporte-contacto`) en todos los roles autenticados. |
| 5.1 | Fechas de todos los filtros editables por selección directa de día, mes o año con clic o flechas (incluido clic en el espacio derecho del control, retroceso en el año con dos dígitos y ajuste de fin de mes), sin obligar a abrir el calendario. |

## Protección de los controles temporales

Los datos temporales no tienen nombre de formulario ni forman parte del estado React del pago. Solo se mantienen en sus controles de pantalla; no se agregan a solicitudes, borradores persistidos, trazas ni recibos. La API continúa rechazando PAN completo, vencimiento y CVV. El CVV se oculta mientras se escribe y se elimina; no se guarda cifrado. Un reintento no puede recuperarlo. Solo datos ficticios para la revisión; no hay procesador bancario ni autorización de tarjeta.

## Verificación

Se amplían las pruebas existentes de UI de Administración/PWA, captura en escritorio/móvil, pago/API, recibos y apertura de caja. Se comprueba el ancho real del HTML térmico y la ausencia de desbordamiento, junto con los importes y referencias. La generación de datos ficticios respeta ahora el cierre anterior al abrir sus jornadas; no se reescriben cajas históricas.

La impresión del navegador y su HTML no acreditan salida física. No se necesita migración para estos ajustes. Los resultados concretos de la publicación se documentan en el PR correspondiente.
