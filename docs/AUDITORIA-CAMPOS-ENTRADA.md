# Auditoría de campos de entrada y prevención de inyección — CyP

Fecha: 6 de octubre de 2026. Checkout: `C:\CyP`, rama `main`, revisión `d62334d74907d9293685ee665299bdf52830cfe1`.

## Resultado

Hay brechas reales de validación de formato y consistencia, pero **no se encontró una inyección SQL demostrable en los caminos de persistencia revisados**. Los valores introducidos por usuarios se envían a PostgreSQL mediante parámetros. No corresponde bloquear apóstrofos, espacios o símbolos en todos los campos: eso dañaría datos legítimos y no sustituye la protección SQL.

La recomendación es una política por campo, compartida entre interfaz y servidor. El servidor debe rechazar datos inválidos incluso cuando se omite el formulario. Las consultas deben conservar sus parámetros. Esto coincide con [OWASP: prevención de SQL Injection](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html).

**Esta entrega es un análisis y una propuesta. No se cambiaron restricciones, código funcional, credenciales ni datos.**

## Alcance y trazabilidad

- Análisis sintáctico de todos los archivos `.ts`/`.tsx` de los dos clientes y de `app/shared`, excluyendo declaraciones y pruebas: **511 controles nativos** `input`/`select`/`textarea` y **175 descriptores con clave y etiqueta** de formularios dinámicos.
- Los números son ubicaciones de código, no campos únicos ni controles visibles simultáneamente. Incluyen ramas antiguas, componentes genéricos, controles de solo lectura, filtros y mocks; los descriptores complementan los controles que se generan en un bucle.
- Revisión de **237 entradas de esquemas de objetos Zod**, sus validaciones posteriores en dominio y **87 llamadas `query()` en `app/server/src`**.
- Revisión adicional del formulario HTML de invitación, de las migraciones SQL y de identificadores SQL de herramientas locales. No se ejecutaron migraciones, importaciones, restauraciones ni comandos contra PostgreSQL.
- Se comprobó la rama activa de `mdiWindows.map` en `App.tsx`: catálogos mediante `ConnectedCatalog`, herramientas mediante `ConnectedAdminTools`, Clientes mediante `ClientsLegacyView`, tasas mediante `ConnectedExchangeRates` y cuadre mediante `ConnectedSettlements`. Los componentes legacy que aún existen no se confunden con el camino conectado.

Archivos de detalle:

| Archivo | Contenido |
|---|---|
| [inventario-ui.csv](auditoria-campos/inventario-ui.csv) | Cada control: componente, archivo/línea, etiqueta o vínculo, tipo, `readOnly`, `disabled`, restricciones actuales, evento y política propuesta. |
| [descriptores-dinamicos.csv](auditoria-campos/descriptores-dinamicos.csv) | Campos generados por descriptores: clave, etiqueta, opciones, obligatoriedad y propuesta. |
| [contratos-api.csv](auditoria-campos/contratos-api.csv) | Esquemas y expresiones actuales de validación del servidor. Los alias `id`, `text`, `name`, `money`, etc. se interpretan con su declaración en el mismo archivo. |
| [consultas-sql.csv](auditoria-campos/consultas-sql.csv) | SQL y argumentos separados, con las expresiones dinámicas identificadas. |
| [pruebas-aisladas.json](auditoria-campos/pruebas-aisladas.json) | Resultados reproducidos con datos ficticios, API en memoria y consulta capturada. |

La clasificación del inventario es orientativa y se deriva de etiqueta, tipo, clave y vínculo de estado. Los controles `DYNAMIC` dependen de sus descriptores; los atributos pasados mediante `...props` no siempre aparecen como atributos directos. La matriz de dominio que sigue determina qué regla aplicar. No equivale a haber visitado todas las ventanas, roles y estados en un navegador, ni valida datos históricos de la base real.

## Hallazgos comprobados y prioridad

| Prioridad | Hallazgo | Evidencia | Corrección propuesta |
|---|---|---|---|
| Alta de integridad | Configuración general acepta valores y claves arbitrarios. | `app.ts:1066` admite `z.record(z.string(), z.unknown())`; `domain.ts:578` solo verifica tamaño. Prueba: guardó GPS de texto, puerto de texto y una clave desconocida. | Esquema explícito de claves, tipos, longitudes, monedas, puertos, coordenadas y porcentajes; rechazar extras. Mantener lectura de configuración antigua con revisión de compatibilidad. |
| Alta de integridad | `day1`/`day2` de cargos recurrentes permiten eludir el rango numérico mediante strings. | `catalog-routes.ts:35`: unión de string hasta 40 con entero 0–31. La API aceptó `day1: "abc"`, `day2: "99"`. El frontend conectado convierte a número, pero una petición directa evita esa conversión. | Un único tipo/rango acorde a frecuencia, o parser estricto compartido para strings de dígitos. No admitir letras. Definir cuándo vacío/0 significa «no aplica». |
| Media | Correo y teléfonos de Clientes tienen longitud máxima, pero no formato. | `app.ts:118–127`; un cliente ficticio guardó `phone: "telefono-no-valido"`, `cellular: "abcdef"`, `email: "esto-no-es-correo"`. | Correo válido o vacío; teléfono internacional válido o vacío. Aplicar igual en PCPs, Cobradores y configuración. |
| Media, salida de datos | Algunos reportes CSV permiten fórmulas de hoja de cálculo. | `App.tsx:1007`, `csvCell`, conserva `=1+1`; `downloadReportTable` lo usa para CSV. Se revisó su acceso desde los reportes compactos activos. | Neutralizar prefijos de fórmula en cada celda de texto exportada. Reutilizar una única función segura; `app/shared/remittances/output.ts` ya contiene una defensa para su exportador. No bloquear esos caracteres al capturar nombres/notas. |
| Media/contrato por confirmar | Número, grupo y tipo de Estaciones son strings libres; número de PCP/Ruta/Zona también es textual. | `admin-tools-routes.ts:16–18`, `catalog-routes.ts:17–18`. Se aceptó una estación con número `no-numero` y tipo/grupo libres. | Decidir si son consecutivos numéricos o códigos de negocio; validar según esa decisión. Grupo/tipo de estación requieren lista autorizada si el negocio los define como catálogo. Revisar datos históricos antes de convertir. |
| Media de experiencia | Restricciones de UI no son uniformes. | Solo 19 controles tienen `maxLength` directo y ninguno `pattern` directo; otros heredan props o validan en `onChange`/submit. `ClientDataDialog` no aplica formato de correo/teléfono. | Mostrar mensajes por campo; alinear longitudes con API; admitir pegado, teclado móvil e IME. `inputMode` ayuda al teclado, no valida. |
| Baja / mantenimiento | Coexisten vistas conectadas y formularios antiguos/mocks con reglas diferentes. | Inventario de `App.tsx` y rama MDI. Compra/Venta de la antigua tasa aceptan texto, mientras la tasa conectada usa un decimal positivo de hasta seis posiciones. | Actualizar primero el componente activo y los contratos; documentar/aislar las ramas antiguas para evitar arreglar pantallas que no se usan. |

Las primeras tres brechas permiten datos inválidos; **no son por sí mismas prueba de SQL Injection**. El riesgo CSV es diferente y ocurre al abrir una exportación en una hoja de cálculo.

## Matriz de restricciones por campo y módulo

En todos los textos ordinarios: longitud máxima coherente con la API, rechazo de NUL y controles no admitidos, y normalización acordada. No transformar contraseñas. El carácter `<` puede ser texto legítimo en una nota («saldo < 100»); debe escaparse en HTML, no interpretarse como marcado. [OWASP: validación de entradas](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html).

| Módulo / campos | Letras | Números | Símbolos necesarios | Regla recomendada |
|---|---|---|---|---|
| Login: Usuario/Correo | Sí | Sí | `@ . _ + -` y símbolos válidos del correo | El login actual usa email; validar correo para cuentas nuevas. Si se incorpora usuario corto, contrato separado de correo. Máximo actual 200. |
| Login, alta/cambio de clave: Contraseña y Confirmación | Sí | Sí | Sí; también espacios | Conservar exactamente la contraseña. Alta/cambio actual: 10–200; login: 1–200. No quitar símbolos, espacios ni aplicar `trim`. Confirmación idéntica, sin registrar el valor. |
| Invitación demo HTML | Sí | Sí | Sí | Comparación de credencial completa; configuración actual 10–256. Añadir límite equivalente a petición; no un filtro de palabras SQL. |
| Clientes: Código | Según contrato | Sí, con ceros iniciales | Guion/underscore y separadores del código | La API permite hasta 80 y la importación genera códigos `LEG-...`: no convertir todos a números. Separar consecutivo del ID técnico. |
| Clientes: Cédula/pasaporte | Pasaporte sí | Sí | Guiones/separadores del documento | No imponer solo números a pasaportes. Proponer tipo de documento y validador por tipo/país; máximo actual 80. Cédula dominicana: validar sus 11 dígitos tras normalización y, cuando corresponda, su verificación. |
| Clientes: Nombre, Conocido por | Sí, Unicode | Sí para negocios/apodos legítimos | Espacios, apóstrofos, guiones, puntos, `&`, paréntesis | Texto legible, máximo actual 160. `O'Connor`, `Colmado #2` y nombres acentuados no deben romperse. |
| Clientes: Dirección, Ubicación, Sector | Sí | Sí | `# / - . ,`, espacios y otras referencias | Texto de dirección/referencia, no numérico. Dirección API hasta 240; sector 160. Ubicación legacy no es un sustituto de coordenadas ni un campo del cuerpo actual de Cliente. |
| Clientes/PCPs/Cobradores/configuración: Teléfono, Celular, Fax | No en número principal | Sí | `+` inicial, espacios, `- ( )` | Validar 8–15 dígitos normalizados si se adopta telefonía internacional; números nacionales según país. Extensión con regla explícita, no texto arbitrario. Vacío si opcional. Contrato actual teléfonos hasta 40. |
| Clientes/Usuarios/configuración: EMail/Correo | Sí | Sí | Los válidos en correo | Validador de correo completo; conservar `+` y símbolos legítimos. Cliente opcional vacío. Usuarios ya validan correo; cliente/configuración no. Máximo cuentas/cliente 200. |
| Clientes, movimientos y autorizaciones: Nota/Motivo | Sí | Sí | Puntuación y símbolos legibles | Texto plano. Nota de cliente/cargo/envío hasta 2000; cancelación de movimiento/envío hasta 500; nota de cuenta hasta 1000. Saltos de línea solo en campos preparados. |
| Cobradores: Nombre | Sí | Según nombre legítimo | Espacios, apóstrofos, guiones | Texto legible hasta 160. No usar una lista negra SQL. |
| Cobradores: Identificación/Cuenta | Sí cuando es código | Sí | Separadores del identificador | Identificación/cuenta actuales hasta 160. Una cuenta bancaria y un ID de usuario no son el mismo formato: no tratarlos automáticamente como enteros. |
| Cobradores L: Límite de Cobro/Pago | No | Decimal monetario | Punto decimal | Hasta dos posiciones; centavos enteros en API. Límite real actual 1–1,000,000,000 centavos. El borrador de sesión admite cero: no confundirlo con el límite operativo del servidor. |
| Cobradores Z/R, PCPs, Clientes: selección de Zona/Ruta/Grupo/Cuenta | No texto arbitrario | ID si procede | Los del ID, internamente | Selección de entidad existente y autorizada. Nombre mostrado y UUID/ID no se validan igual. Las asignaciones Z/R de sesión no alteran la API real. |
| Estaciones: Estación/Descripción | Sí | Sí | Espacios y puntuación adecuada | Nombre hasta 160; descripción hasta 1000. |
| Estaciones: ID del dispositivo/Licencia/Versión | Sí | Sí | Separadores, puntos, guiones y símbolos del proveedor | Hasta 160 actual. No asumir que dispositivo es un entero ni UUID; licencias/versiones requieren contrato del proveedor. |
| Estaciones/PCPs/Rutas/Zonas: Nro. | Solo si es código legacy | Sí | Separadores solo si es código | Consecutivo realmente numérico: entero positivo textual sin exponentes, longitud y unicidad. Código existente alfanumérico: conservar formato. Pendiente verificar dominio/datos reales antes de exigir dígitos en todos. |
| Estaciones: Grupo/Tipo | Solo catálogo | Solo ID | Sin texto fuera de opciones | Lista autorizada del negocio; actualmente backend acepta strings hasta 160. |
| Grupos, Zonas, Rutas: Nombre | Sí | Sí cuando corresponde | Puntuación legítima | Texto Unicode hasta 160; unicidad según módulo. |
| Zonas/Rutas: Desde/Hasta | Depende del contenido | Sí | Separadores del rango/dirección | Actualmente strings hasta 160. Si representan códigos de clientes, comparar códigos/rangos; si describen extremos geográficos, son texto. La etiqueta sola no justifica hacerlos numéricos. |
| Servicios: Bien/Servicio/Caption/Abrev. | Sí | Sí | Unidades, guiones, puntos, etc. | Hasta 160. Productos como `Alambre THHN 10 BLANCO` requieren letras y números. |
| Servicios: Precio de referencia | No | Decimal monetario | Punto decimal | Dos posiciones, cero o positivo si está informado; máximo real 1,000,000,000 centavos, moneda asociada obligatoria. |
| Servicios: Impuestos/Beneficio/Cantidad de referencia con unidad | Sí para unidades | Sí | `%`, separadores y unidades | Son anotaciones informativas de texto: cantidad hasta 64 y otras hasta 160. No convertir a número puro sin separar primero valor, unidad y carácter informativo. |
| Servicios: Obligado cobrar/Activo/Importe fijo | No | No | Ninguno | Booleanos reales; servidor no debe aceptar strings `"true"`/`"false"`. |
| Motivos de Atraso: Valor/Motivo | Sí | Sí si se necesita | Puntuación normal | Texto legible obligatorio hasta 160. |
| Usuarios: Nombre/Apodo/Nota | Sí | Sí según contenido | Puntuación legítima | Nombre 160, apodo 120, nota 1000; validación y permisos en servidor. |
| Usuarios/Permisos: Rol/Categoría/Permiso | Solo catálogo | ID/code | Los del ID/code | Selección autorizada; la API actual de cuentas admite `admin`/`collector`. El listado frontend de permisos de sesión no acredita permisos reales. |
| Cargos/Descargos: Cliente/Moneda/Servicio/Concepto | Según campo | Según campo | ID/texto del catálogo | Cliente existente, moneda DOP/USD/EUR, servicio según contrato, concepto texto hasta 160. No aplicar una regla numérica al nombre del cliente. |
| Cargos/Descargos: Precio/Monto/Importe/Total | No | Decimal monetario | Punto decimal | Dos posiciones en captura y centavos exactos en API; positivo y máximo del libro. Total se calcula, no se confía en un readonly enviado. |
| Cargos/Descargos: Cantidad/Multiplicador | No | Decimal si el negocio lo admite | Punto decimal | En el cálculo actual `decimalProductCents` admite dos posiciones. Cantidad de billetes es entero, cantidad de servicio puede ser decimal: no unificarlas incorrectamente. |
| Recurrentes: Fecha Inicial/Final/Frecuencia | No entrada libre | Fecha válida/enum | Separadores del control | ISO fecha real, final >= inicial; frecuencia del catálogo del servidor. Vacío de final solo donde contrato lo permite. |
| Recurrentes: Día1/Día2 | No | Enteros de calendario | Ninguno | Validar por frecuencia; cerrar bypass de strings. No basta `inputMode="numeric"` o `Number()`. |
| Cobros/Pagos: Documento/Doc/Nombre del cliente/Total | No edición | Calculado | Formato de presentación | Son resultados/IDs de servidor o placeholders. `-1`/`Nuevo` de la UI no es un número válido para alta en base. |
| Cobros/Pagos: Fecha/Cobrador/Forma/Banco | Selección o etiqueta | ID/fecha | Los de la selección | Fechas válidas y catálogos autorizados. Respetar controles readonly/disabled en los flujos conectados; no reabrir campos solo porque existían en el demo. |
| Cobros/Pagos/Depósitos: Número/Referencia bancaria | Sí si proveedor lo permite | Sí | `- / .` y separadores permitidos | Referencia de texto hasta 160, no importe. Evitar perder ceros iniciales. |
| Depósitos/Entregas/Cuadres: Denom./Cantidad/Importe | No | Denominación y cantidad enteras | Decimal solo para presentar dinero | Validar denominación admitida, cantidad >= 0 entera, suma y moneda en servidor; no aceptar total calculado por cliente sin verificar. No desbloquear grillas readonly por esta auditoría. |
| Tragamonedas: Entrada/Salida | Por confirmar | Habitualmente contadores | Decimal solo si contador admite fracción | La API actual guarda ambos como texto hasta 100. Definir si son lecturas numéricas o identificadores antes de imponer formato; no asumir una inyección por ser texto. |
| Tragamonedas: Valor Mon./Porciento/Nro. | No | Número finito / entero según campo | Punto decimal en valor/porcentaje | Valor API 0–1,000,000,000; porcentaje 0–100; número entero positivo. Precisar escala del valor antes de tratarlo como centavos. |
| Mapas/GPS: Latitud/Longitud | No | Decimal con signo | `-` y `.` | Rangos lat [-90,90], lng [-180,180], finitos y pareja coherente; permisos del dispositivo aparte. |
| Monitores: segundos de refresco | No | Entero positivo | Ninguno | Límite razonable de frecuencia/rango; no permitir negativos, decimales, infinito ni intervalos vacíos. Es configuración UI, no saldo financiero. |
| Monitores/reportes: Moneda/Estado/Ruta/Zona/Servicio/Cobrador/Formato | Solo opciones | ID | Los del ID | Opciones permitidas; la selección visual no impide forjar una petición. Validar parámetros que llegan a API. |
| Reportes/sesiones/trazas/clientes: Buscar/Digite/filtros de texto | Sí | Sí | Sí | Consulta acotada, por ejemplo 160 donde API ya lo exige; conservar apóstrofos y símbolos de datos buscados. Parámetros SQL si se incorpora búsqueda en base. |
| Sesiones/Tragamonedas/reportes: Fecha/hora inicial/final | No | Fechas/horas válidas | Separadores de control | Verificar calendario, horario y orden; zona horaria explícita. |
| Paginadores: Página/offset/limit | No | Enteros | Ninguno | Página >= 1 y <= total; API actual limit 1–100, offset 0–1,000,000 en herramientas. |
| Configuración: Empresa/Dirección/Teléfono/Correo/Fax/Licencia | Según campo | Según campo | Los descritos para cada familia | Esquema tipado por clave; los límites genéricos de JSON actuales no equivalen a validar estos campos. |
| Configuración: Moneda/Servicio TM/Concepto TM | Solo catálogo | ID | Los del ID | Moneda y entidad existentes; `No definido` solo si el contrato permite ausencia. |
| Configuración: switches/checks/CDC | No | Porcentaje CDC | Punto decimal CDC | Booleanos reales; CDC numérico dentro de 0–100 o rango explícito del negocio. |
| Impresoras/configuración: URL | Sí | Sí | `: / . -` y sintaxis válida de URL | URL HTTP(S)/host conforme al puente utilizado; `localhost`/LAN puede ser legítimo. Si un backend llega a conectarse a ese destino, hacer además revisión SSRF/allowlist de destinos. No se demostró SSRF actual. |
| Impresoras/configuración: Puerto | No | Entero 1–65535 | Ninguno | No admitir `abc`, espacios como valor, exponente o decimal. |
| Impresoras/configuración: Nombre/Imp. | Sí | Sí | Espacios y separadores del nombre | Nombre de impresora acotado o catálogo; no usarlo como comando shell. |
| Remesas: Principal/Efectivo inicial/Contado/Comisión de gestor | No | Decimal monetario | Punto decimal | `decimalCents` estricto y centavos seguros; apertura/contado/comisión informativa admiten cero según contrato, principal > 0. Caja independiente del libro DOP. |
| Remesas: Comisión (%) | No | Decimal 0–100 | Punto decimal | Convertir exactamente a puntos base enteros 0–10000; no letras ni valores fuera del rango. |
| Remesas/Tasas: Tasa de cambio | No | Positivo hasta seis decimales | Punto decimal | Backend `normalizeRate`: 1–12 dígitos enteros y 0–6 decimales, positivo. DOP=1. No aceptar texto porque Compra/Venta legacy lo hacían. |
| Remesas: Remitente/Destinatario/Operador/Moneda | Solo selección | ID | Los del ID | Entidades existentes, activas y permitidas por servidor. |
| Remesas: Gestor/Nota/Motivo de cancelación | Sí | Sí según contenido | Puntuación legítima | Gestor hasta 160, nota 2000, motivo obligatorio hasta 500. |
| Importación de Cargos/Descargos: Archivo y filas | Por columna | Por columna | CSV, comillas/separador según formato | `accept` no basta. Parser de estructura, longitudes, fechas, importes exactos, filas y tamaño; validar nuevamente en API. El CSV importado nunca se ejecuta como SQL. |
| Recibos: Token/Enlace privado/ancho 58–80 | No edición salvo ancho | ID/enum | Base64URL/URL | Token servidor `[A-Za-z0-9_-]{32}`; URL mostrada readonly; ancho enum 58/80. No restringir el token a números. |

## Lo que ya protege el proyecto

1. Persistencia conectada con placeholders `$1`, `$2`, etc. en `store.ts`, `catalog-store.ts`, `admin-tools-store.ts` y `remittance-store.ts`.
2. La única interpolación de tabla en el servidor de operaciones (`store.ts:454`) elige entre constantes `collections` y `payments`; el ID/estado siguen separados. El helper de lectura de herramientas recibe consultas constantes. Las migraciones ejecutan archivos locales de código, no el archivo subido en el formulario.
3. Esquemas Zod y controles de dominio para importes, moneda, fechas, GPS, entidades, permisos, estados e idempotencia. Los importes financieros del libro son enteros positivos con máximo; remesas usa enteros seguros y cálculos con `BigInt`.
4. PostgreSQL tiene checks de dinero/posición y reglas de saldo en migraciones. La evidencia es el SQL versionado; **no se verificó que la instalación local tenga todas esas migraciones aplicadas**.
5. React representa textos ordinarios como texto; la impresión de reportes revisada escapa HTML. No apareció `dangerouslySetInnerHTML` en los clientes revisados. El exportador compartido de remesas neutraliza fórmulas CSV, pero el exportador de `App.tsx` no lo hace.

Las herramientas locales de backup/paridad/restauración componen identificadores SQL porque estos no son parámetros de valor; usan escape de identificadores y, para el nombre de base de restauración, una allowlist. Se revisaron sus fuentes, **no se ejecutaron**. La importación legacy conserva códigos alfanuméricos y usa parámetros; debe incorporar validación de calidad antes de un futuro uso, sin asumir que saneamiento de caracteres reemplaza parametrización.

## Pruebas ejecutadas

Se usó `Fastify.inject` contra una instancia creada con `MemoryStore(seed())`, sin `.env`, conexión PostgreSQL, puertos nuevos ni red externa. Hubo **18 peticiones comprobadas**, incluyendo dos altas ficticias auxiliares de servicio/grupo. Todas devolvieron el estado esperado, incluidas las aceptaciones indeseadas que demuestran las brechas. La muestra no pretende cobertura E2E de las 511 ubicaciones.

Se hicieron otras dos comprobaciones:

- Se extrajo y ejecutó aisladamente `csvCell` con `=1+1`: conservó la fórmula. No se abrió Excel ni se ejecutó una fórmula.
- Se capturó la llamada de `saveCatalogMasters` con un cliente PostgreSQL simulado: el texto que contenía sintaxis SQL viajó en el arreglo de parámetros, no en la sentencia. **No se ejecutó SQL en una base real.**

Los tokens de las pruebas permanecieron en memoria y no aparecen en los artefactos. No se hicieron pruebas ofensivas contra la demo, producción ni bases locales. No se ejecutó TestSprite/túneles. Al ser una auditoría de solo documentación, no se cambiaron scripts de build ni se requirió recompilar la aplicación.

## Plan de corrección recomendado

1. Definir contratos por familia y revisar compatibilidad de datos históricos: códigos, documentos, números de ruta/zona/PCP y entrada/salida de máquinas. No convertir globalmente a numéricos.
2. Corregir primero esquemas del servidor para configuración, contactos y días de recurrencia; mantener SQL parametrizado y límites existentes de negocio. Acompañar con pruebas que omitan el frontend.
3. Aplicar las mismas políticas a componentes activos mediante helpers compartidos; usar `maxLength`, `inputMode`, tipos apropiados, mensajes claros y validación al enviar. Validar pegado y cambios completos, no solo teclas individuales; no mutilar silenciosamente nombres ni importes.
4. Unificar exportadores y probar neutralización de fórmulas, escape HTML/XML y conservación de importes. La codificación depende del destino, no del filtro de teclado.
5. Mantener regresiones: nombres con ñ/acentos/apóstrofos, pasaportes alfanuméricos, teléfonos internacionales, correos con `+`, contraseñas con símbolos/espacios, importes exactos y permisos.

Aceptación mínima: las brechas aceptadas en `pruebas-aisladas.json` pasan a devolver un error por campo antes de guardar; las entradas legítimas siguen funcionando; no se modifica ningún saldo ni cálculo por introducir la nueva validación.

## Límites de la conclusión

Este análisis no certifica que el sistema esté libre de todas las vulnerabilidades. No incluye pentest de producción, permisos del usuario PostgreSQL, datos históricos, configuración de despliegue ni dependencias. La protección SQL comprobada es por lectura de los caminos existentes y captura de parámetros; las futuras consultas deben conservar ese diseño. La auditoría de campos no sustituye autorización, reglas contables, escape de salidas ni pruebas del entorno real.
