# Correcciones de la revisión de integridad

Este bloque aplica los hallazgos de la revisión del 23 de octubre. Conserva los
nombres de los módulos, las cajas separadas de remesas y del libro de cobros, las
validaciones de la Fase 1 y las restricciones de ámbito del cobrador.

## Cambios y dónde comprobarlos

| Hallazgo | Cambio aplicado | Comprobación |
|---|---|---|
| Doble conteo en monitores | Los cobros/pagos se atribuyen a la ruta o zona del cliente. Depósitos, entregas, devoluciones y límites se muestran una sola vez, en una fila «Caja sin ruta/zona» por cobrador. No se inventa un reparto entre rutas. | Monitor R/Z con un cobrador que tenga dos rutas: un cobro de 100 debe sumar 100. |
| Moneda del monitor | Filas, límites y pie usan la misma moneda seleccionada. | Alternar DOP, USD y EUR. |
| Acceso al reparto de comisiones | El consolidado exige Reportes y Ver comisiones. El reporte general, los envíos, sus reintentos, las cotizaciones y el contexto ocultan el reparto interno a quien no lo tiene. El precio total y la comisión cobrada al cliente permanecen visibles. | Retirar Ver comisiones manteniendo Reportes: los reportes de montos siguen disponibles y no entregan empresa/gestor. |
| Contraseñas cortas | Crear o cambiar contraseña exige al menos 15 caracteres. Se admiten frases, espacios, acentos y símbolos; máximo 200. El login conserva las claves existentes y no cambia credenciales al desplegar. | Nueva cuenta, cambio propio y restablecimiento; comprobar el rechazo de 14 caracteres y el acceso de cuentas anteriores. |
| Z/L/R temporales | Aceptar guarda en PostgreSQL las rutas y los límites reales. Una zona asigna sus rutas activas. Cancelar descarta el borrador. Reasignar pide confirmación y una revisión vigente evita sobrescribir cambios ajenos. | Cobradores → Z/L/R; guardar, cerrar, refrescar y volver a abrir. |
| Límites por moneda | Se guardan y aplican importes separados por DOP/USD/EUR. La migración conserva los anteriores valores numéricos en las tres monedas, como operaba el límite general; no los convierte. Quitar una moneda deja su límite en cero. | L → elegir moneda, modificar y guardar; revisar otra moneda y volver. |
| Calendario recurrente | El servidor procesa los vencimientos cada minuto y permite Generar vencimientos manualmente, con permisos. Cada plantilla/fecha genera un solo cargo, incluso con reintentos o procesos concurrentes. | Crear una plantilla activa desde hoy, generar y repetir: el segundo intento no duplica. |
| Formatos de exportación | PDF abre el diálogo nativo para imprimir o guardar como PDF; la opción de hoja de cálculo se llama CSV para Excel y descarga CSV. Texto, CSV, XML, HTML y RTF conservan sus formatos y escapes. | Exportar datos y totales; comprobar nombre, extensión y contenido. |
| Dependencias | Se actualizaron Fastify, Zod, fast-jwt y las dos ramas de fast-uri con correcciones de los avisos vigentes al verificar. Se conserva un único archivo de bloqueo. | Auditoría de dependencias de producción y regresiones de autenticación. |
| Autorización de instalaciones | Se reconstruyen la cuenta y los permisos dentro de la transacción. Consultar no requiere permiso de editar; registrar/revocar sí. | Permiso retirado: no se emiten desafíos ni se registran instalaciones nuevas. |
| Auditoría de permisos | Se registra actor, cuenta, revisiones, modo, permisos agregados/retirados y confirmación de excepciones. Trazas muestra el detalle. No incluye claves ni tokens. | Guardar permisos y consultar su evento en Trazas. |
| Capacidad | Autenticación consulta solo cuenta/sesión/cobrador; sesiones y trazas se paginan en SQL. Las peticiones comunes no cargan el historial de trazas. RRAA se consulta antes del bloqueo de escritura y se reautoriza al guardar. | Pruebas en PostgreSQL y prueba concurrente con proveedor lento simulado. |
| Claridad y mantenimiento | Acciones principales tienen texto visible. Se extrajo el monitor activo a su módulo y se eliminaron las antiguas implementaciones de monitores que ya no se renderizaban. | Ventanas compactas, selección, teclado y botón Monitoreo. |
| Formato de importes, solicitado durante la revisión | Remesas admite miles con comas y decimales con punto. Al salir del campo se formatean los miles. `1,000.05` conserva exactamente 100005 centavos; `12,34`, exponentes, signos y texto se rechazan completos. Una entrada rechazada mantiene su advertencia hasta corregirla. Las tasas conservan su formato sin agrupación. | Admin y PWA: cotizar `1,000.00`, ingresar efectivo y comprobar devuelta; pegar `12,34` y verificar que no cambie el importe ni se guarde. |

## Reglas del calendario

- Diaria: cada día; Bidiaria: cada dos días; Semanal: cada siete días.
- Quincenal: cada 15 días desde F. Inicial. Si se indican ambos, Día1 y Día2,
  se usan esos días del mes. Un solo día conserva el intervalo de 15 días.
- Mensual, Trimestral, Cuatrimestral, Semestral y Anual crean un cargo por periodo
  y conservan el mes de inicio como referencia. Día1 fija el día; si queda vacío
  se usa el de F. Inicial. Día2 solo se usa en Quincenal. Un día inexistente se
  ajusta al último día del mes. Si dos
  vencimientos coinciden después del ajuste, no se cobra dos veces esa fecha.
- No Definida o una plantilla inactiva no genera cargos. Cliente o servicio
  inactivos, moneda desconocida o importe inválido impiden generar esa plantilla.
- El importe generado es el guardado en la plantilla, sin inventar precios,
  comisiones ni conversiones. Los cobros y saldos pertenecen al cargo generado.
- Las plantillas existentes antes de la migración comienzan desde el día
  siguiente a la actualización. Las nuevas comienzan como pronto hoy. No se
  crean deudas históricas por aplicar una migración.
- Editar o reactivar una plantilla reprograma sus próximos vencimientos desde
  hoy, respetando la fecha de inicio y el límite anterior de la migración.
  No se cobran retrospectivamente periodos pausados ni se cambian cargos emitidos.
- Cada ciclo genera hasta 100 cargos. Los siguientes ciclos completan lo
  pendiente; una caída o un cargo posteriormente cancelado no crea duplicados.

## Contratos y migraciones

Migraciones aditivas 041–043: auditoría detallada, límites por moneda, posibilidad
de dejar una ruta sin cobrador, ejecución del calendario, identidad de cada
vencimiento y controles e índices. No se borran rutas, clientes, movimientos,
sesiones, trazas ni claves de idempotencia. El historial de cargos previos no se
recalcula.

- `GET/POST /api/cobradores/:id/zonas`
- `GET/POST /api/cobradores/:id/rutas`
- `GET/POST /api/cobradores/:id/limites/monedas`
- `POST /api/cargos/recurrentes/calendario`

Consultar asignaciones requiere ver cobradores. Guardarlas exige el permiso
individual de Zonas, Rutas o Límites. Cada POST envía revisión, lista de IDs o
límites e Idempotency-Key. La reasignación debe confirmarse expresamente.
Generar vencimientos exige los permisos de ver/crear plantillas y ver/crear cargos.
Los esquemas completos se publican en el OpenAPI existente del servidor.

En una instalación local, aplicar `pnpm db:migrate --apply` con su configuración
habitual antes de iniciar el servidor actualizado. El despliegue existente de la
demo aplica sus migraciones durante el arranque configurado.

## Seguridad y límites de la comprobación

La política de longitud toma como referencia la recomendación de 15 caracteres
para contraseña como único factor de [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html).
Esto no afirma cumplimiento completo de esa norma. No se fuerza un cambio masivo
de claves anteriores ni se incorpora un segundo factor sin un flujo de registro
y recuperación de cuentas.

Avisos atendidos: [fast-jwt](https://github.com/advisories/GHSA-x937-hj6v-793p) y
[Fastify](https://github.com/advisories/GHSA-389g-gv7q-r4x8), y los avisos
actualizados durante la comprobación de [Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
y fast-uri ([esquemas](https://github.com/advisories/GHSA-w74x-v6f9-j3xg),
[rutas](https://github.com/advisories/GHSA-xhq7-xmqj-769h)). La auditoría solo
informa de vulnerabilidades conocidas en las versiones consultadas; no demuestra
que se hayan explotado en CyP ni garantiza ausencia de otros problemas.

Se conserva el bloqueo transaccional del libro financiero para no introducir
carreras. Las consultas y esperas más costosas se redujeron; esto no equivale a
garantizar capacidad ilimitada. No se purga idempotencia financiera ni auditoría
para simular una mejora. Una futura división del almacén debe tener mediciones y
pruebas específicas.

No se inventa la ruta histórica de movimientos anteriores cuando no quedó
registrada: el monitor usa el cliente y su asignación disponibles. La impresora
física sigue siendo una prueba de Mayo. HTTPS del servicio externo depende del
proveedor de RRAA. No se hicieron movimientos de prueba sobre una base compartida.

## Medición local de las consultas

En PostgreSQL 18 aislado, con 5000 trazas ficticias y siete repeticiones por
consulta, las medianas fueron: lectura completa 70.486 ms, lectura común sin
historial de trazas 14.511 ms, comprobación específica de acceso 1.506 ms y página
de 50 trazas 4.549 ms. Se midieron llamadas al almacén en una misma máquina.
No son tiempos de respuesta de Render ni una prueba de carga o concurrencia máxima.
