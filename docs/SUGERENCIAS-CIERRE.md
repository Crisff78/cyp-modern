# Cierre de las cuatro sugerencias parciales

Este cierre documenta las correcciones del 5 y 6 de octubre y sus comprobaciones
de entonces. La revisión del 9 de octubre se mantiene en
[OCTUBRE-09-CORRECCIONES.md](OCTUBRE-09-CORRECCIONES.md), sin convertir los
resultados históricos en una ejecución nueva. El reparto automático de nuevas
remesas se rige por [COMISIONES-CONFIGURACION.md](COMISIONES-CONFIGURACION.md);
las anotaciones manuales anteriores permanecen separadas. La validación vigente
de estaciones sigue [RRAA-ESTACIONES.md](RRAA-ESTACIONES.md).

## Contactos visibles al registrar remesas (4.2) — 6 de octubre de 2026

Al seleccionar remitente y destinatario, el formulario muestra su teléfono,
celular y dirección desde la ficha del cliente. La confirmación presenta ambos
contactos antes de registrar. Los datos son de solo lectura: se corrigen en
Clientes. Un dato vacío se muestra como "No registrado" o "No registrada".
La consulta autenticada devuelve únicamente el contacto elegido; el catálogo
general y la búsqueda siguen sin publicar un índice de teléfonos/direcciones.
Cambiar o borrar la selección retira el contacto anterior y descarta respuestas
tardías. La confirmación espera a que se carguen ambos contactos.

Al guardar, el servidor ya conserva una copia de ambos contactos en el envío.
Detalle e impresión usan esa copia, aunque luego se cambie la ficha del cliente.
Los envíos históricos sin copia indican "No guardado en esta operación";
no se completan con datos actuales que no existían al registrar.
No se añadieron ni ejecutaron pruebas locales en este ajuste. La impresión
física continúa fuera de alcance.

## Hora visible en alta, edición y confirmación — 6 de octubre de 2026

El campo Hora muestra el reloj actual del formulario en America/Santo_Domingo,
con segundos, para todas las monedas. Se actualiza mientras está abierto y no
forma parte del importe ni del JSON enviado. La hora efectiva del registro sigue
asignándose en el servidor para cada cambio real; un guardado sin cambios y los
reintentos conservan su marca existente.
El último cambio registrado se muestra aparte. DOP ya no oculta una marca real
con el texto "Referencia fija 1", tanto en formularios como en tablas y detalles.
Los registros antiguos o referencias virtuales sin marca siguen indicando que
no tienen hora registrada. No se inventan timestamps ni se cambia la tasa DOP 1.

## Ajuste de Ruta al crear clientes — 6 de octubre de 2026

El alta de clientes inicia en "No definida" y no selecciona la primera ruta
del catálogo. Se conserva la ruta del cliente al editar. Antes de guardar se
debe elegir una ruta válida, conforme al contrato existente de la API y su base
de datos; el valor vacío es un estado inicial del formulario. El formulario
rápido de clientes en modo mock utiliza el mismo comportamiento. No se cambian
las asignaciones guardadas ni se añaden migraciones.

Base revisada: `main` y `codex/public-browser-demo` en
`6df34267ff11d522ba6a65768d97939532c89a8d`. Corrección por Codex, 5 de octubre
de 2026 (hora dominicana). La auditoría anterior revisó 28 puntos y encontró
estos cuatro parciales; los otros 24 conservan su alcance acordado.

| Punto | Implementación | Comprobación |
|---|---|---|
| 2.3 | Editar una estación y cambiar Activa abre la confirmación antes de enviar. Cancelar/X conserva todo el borrador; guardar sin cambiar estado no agrega confirmación. | Componentes reales y API MemoryStore aislada: ambos estados, cancelación, todos los campos, doble clic y respuesta perdida sin duplicar body, clave ni auditoría. |
| 3.1 | Buscar clientes reconoce teléfonos formateados en nota. Al crear, “Usar teléfono como código” toma el teléfono validado; escribir luego otro teléfono no modifica el código elegido. | Regresiones de notas, números independientes, formatos de Haití, valores inválidos y conservación de identidad/documento. |
| 4.1 | Cotización y detalle muestran `1 origen = destino`, o `≈` cuando la presentación se redondea. | División BigInt, doce cifras significativas, valores extremos, iguales, repetidos e inválidos; presentación real de Workspace exacta y aproximada. |
| 6.4 | Campo grande busca teléfono, celular o teléfono escrito en nota además de código/nombre. El servidor devuelve IDs limitados; no publica las notas ni un índice global de contactos. | Autenticación, alcance de remitente/destinatario, selección explícita de clientes distintos con un mismo teléfono, teclado, consultas tardías, errores y respuestas JSON inválidas. |

El teléfono funciona como código operativo cuando se elige esa acción. Sigue
siendo obligatorio registrar la cédula/pasaporte al crear; el ID interno no cambia.
La búsqueda de contactos en Remesas requiere al menos tres dígitos y reconoce
números de 7 a 15 dígitos. Administración conserva sus búsquedas cortas y por
texto. Palabras y separadores evitan unir dos números independientes en la nota;
un número en texto libre produce candidatos, nunca una identidad automática.

La tasa cruzada es una presentación de las tasas de la cotización, no una fórmula
nueva. Principal, comisión, importe recibido y moneda permanecen calculados y
validados por el servidor. En aquel cierre las comisiones del gestor eran manuales.
Desde la revisión del 9 de octubre, las remesas nuevas calculan el reparto desde
la configuración central, sobre el importe final de destino. Las anotaciones
manuales históricas no se convierten ni recalculan retroactivamente.

## Verificación y límites

Actualización del punto 2.8, 6 de octubre de 2026: por solicitud de Rardiel,
la clave de las cuentas admite un mínimo de 3 caracteres al crear o restablecer.
Los formularios y la API aplican ese mínimo; el ingreso administrativo admite
esas claves. El máximo sigue en 200 caracteres y las claves no se recortan.
Se conservan hash, permisos, invalidación de sesiones e idempotencia.

- Pruebas locales del servidor, Administración y Cobrador sobre ejemplos
  ficticios aislados; tipados y compilaciones de los tres paquetes.
- Las pruebas de PostgreSQL dependen de un entorno aislado explícito. Las
  omitidas se registran como omitidas; no se habilita una base compartida para
  hacerlas pasar. Estos cambios no agregan migraciones.
- Se conservan Z/L/R, los límites operativos DOP, los diseños y controles,
  la impresión de 58/80 mm y las reglas existentes de idempotencia.
- TestSprite e impresión física quedan excluidos. GPS físico confirmado por
  el usuario, sin nueva prueba del asistente. Punto 2.2 conserva el ID de estación
  de solo lectura. La integración posterior consulta VALSTAT antes de guardar,
  activar o asociar nuevas estaciones; no identifica automáticamente el equipo
  físico ni emite licencias fuera del contrato del proveedor.
- La revisión y los casos automatizados no certifican el 100 % de la aplicación
  ni garantizan la ausencia de otros errores.

La publicación se vincula al commit verificado: PR hacia `main`, CI, merge del
head exacto y avance sin force de la rama de demo. Render ya existe y despliega
esa rama automáticamente; no se crea otro servicio ni se cambia su configuración.
