# RRAA — validación de estaciones

Contrato recibido el 9 de octubre de 2026: `GET /VALSTAT?p=idcliente|estacion|idestacion`.
Respuesta de texto: `OK|licencia` o `ER|motivo`. El contrato da como ejemplo
`ER|Estación no encontrada`; el servicio responde hoy con códigos cortos: `ER|ENE`
(estación no encontrada para ese idcliente y dispositivo) y `ER|CNE` (el idcliente no
existe). CyP los muestra con su texto y conserva el código entre paréntesis.
El 14 de octubre de 2026 el proveedor añadió el contrato de consulta:
`GET /STATDAT?P=idcliente|estacion`, con respuesta
`OK|IDDISPOSITIVO|LICENCIA|SO` o `ER|motivo`. La `P` de STATDAT es mayúscula;
VALSTAT conserva `p` y el orden `idcliente|estacion|idestacion`. La consulta real
de solo lectura confirmó este flujo y la coincidencia de licencia entre ambas
operaciones, sin crear, guardar ni activar estaciones durante esa comprobación.

STATDAT permite obtener la identidad ya registrada para una empresa y estación.
No crea estaciones en RRAA ni identifica automáticamente el hardware de la
computadora que abre el formulario. SO se conserva como código del proveedor:
no se interpreta como versión del software ni se inventa su nombre. El contrato
no devuelve número local, descripción, grupo, tipo ni versión.

El 10 de octubre de 2026 Rardiel pidió redactar una especificación propia para
avanzar el diseño. Está en [Propuesta de identidad y datos de CyP](RRAA-PROPUESTA-CYP.md),
implementada como identidad lógica y consulta propias de CyP. No es documentación
del proveedor ni añade operaciones a VALSTAT. La consulta STATDAT es independiente
de esa propuesta y proviene del contrato nuevo recibido del proveedor.

## Configuración y confianza

La API usa `RRAA_ENDPOINT` (URL de VALSTAT) y `RRAA_CLIENT_ID` en el entorno del
servidor. No se aceptan URL ni idcliente enviados por el navegador. En esta
instalación se utiliza `idcliente=0`, tal como en la petición proporcionada.
Ese valor procede del contrato recibido, no de un identificador inventado por CyP.
Para otra empresa se debe configurar el identificador que entregue el proveedor.
No se configura el servicio real en los tests automáticos. La dirección del servicio,
los identificadores y las licencias reales no se escriben en fixtures o Git.

Para consultar RRAA, el operador escribe Estación, el código registrado. Obtener
Datos y Obtener Licencia consultan STATDAT para la empresa configurada y comprueban
VALSTAT usando el ID devuelto. ID dispositivo, licencia, SO y empresa son de solo
lectura. Nro. se asigna consecutivamente dentro de la transacción al crear;
al editar se conserva. Descripción es texto local editable (hasta 1000 caracteres):
CyP lo guarda al confirmar el alta o la edición, lo conserva al consultar RRAA y
descarta los cambios sin guardar al cancelar. No procede de STATDAT. Los demás
metadatos existentes se muestran sin inventar valores del proveedor. Se rechazan `|`, controles y
campos vacíos en los parámetros; el servidor codifica la URL, bloquea redirecciones,
limita la espera y el tamaño de respuesta. Solo admite `OK` con licencia no vacía
o `ER` del contrato; STATDAT exige exactamente sus cuatro campos completos. Un
error HTTP, timeout, discrepancia de identidad/licencia o respuesta malformada
nunca autoriza.
El transporte es HTTP según el proveedor, sin cifrado TLS ni firma de respuesta.

## RRAA real en la demo pública

Decisión de Rardiel del 12 de octubre de 2026: la demo pública valida las estaciones contra
el RRAA real. Basta con que el servicio de Render tenga `RRAA_ENDPOINT` (la URL de VALSTAT,
sin parámetros) y `RRAA_CLIENT_ID`; se escriben en la configuración del servicio, no en Git.
Si falta alguna o tienen un valor inválido, la demo arranca igual, lo dice en su registro y
responde el control de prueba descrito abajo.

- Solo se crea, se edita o se activa la estación que RRAA reconoce. Las siete estaciones de
  ejemplo del catálogo aparecen como «No validado»: se pueden inactivar (la confirmación
  avisa de que no tiene vuelta atrás) y no se pueden editar ni reactivar.
- Los códigos de estación, los ID de dispositivo y las licencias que se guardan son los
  reales del proveedor; los ven los lectores administrativos. Junto con la ubicación que
  un cobrador comparta voluntariamente (ver [DEMO-PUBLICA.md](DEMO-PUBLICA.md)), son los
  únicos datos reales que admite la demo. Nombre, número y dispositivo son únicos, así que
  cada estación real se registra una sola vez en la base compartida.
- La demo es compartida: el servidor admite 20 consultas a RRAA por minuto en total,
  contando conjuntamente STATDAT y VALSTAT, y
  responde 429 `RRAA_RATE_LIMITED` a las demás sin llamar al proveedor. Si RRAA no
  responde, el servidor espera medio minuto antes de volver a consultarlo y entretanto
  contesta 429 `RRAA_PAUSED`: cada consulta se espera con la base bloqueada para escribir.
- El transporte sigue siendo HTTP sin TLS, ahora entre Render y el proveedor.
- La identidad de instalación de CyP no cambia de ámbito: en la demo pública sigue sin
  idcliente, para conservar las instalaciones ya registradas.

## Control de prueba de la demo

Decisión de Rardiel del 12 de octubre de 2026, a raíz de la observación «aunque sea como
prueba, los datos para poder crear la estación deberían estar referenciados al control de la
empresa». En modo demo (datos ficticios), cuando el arranque normal del servidor (`index.ts`)
no tiene un RRAA real configurado —también en la demo pública— la API usa un control de
prueba propio de CyP (`createDemoStationControl`, en `rraa.ts`). Responde como VALSTAT para la
empresa ficticia `EMPRESA-DEMO` sin contactar ningún servicio y solo encuentra:

- `EST-PRUEBA-01` a `EST-PRUEBA-99`, cada una con su dispositivo `DISP-PRUEBA-NN`;
- las seis estaciones de ejemplo del catálogo, `DEMO V2 · Estación 1` a `6`, con su
  `DEMO-V2-DISPOSITIVO-0N`.

Con cualquier otro dato responde «Estación no encontrada». Permite probar el alta, la edición,
la activación y la asociación a PCP con datos referenciados al control de la empresa mientras
no existe la conexión con el proveedor. Sus licencias `LIC-DEMO-…` son ficticias y no
acreditan nada. `GET /api/estaciones/rraa` lo anuncia con `simulated: true`, tres parejas que
siguen libres en el catálogo (`examples`) y el rango completo (`exampleRange`); la pantalla
de Estaciones lo dice en dos líneas, con una estación libre de ejemplo, y sus etiquetas y ayudas
nombran el control de prueba en lugar de RRAA (el aviso aclara «no es RRAA real»).

La «Estación de demostración» (Nro. DEMO-001) no tiene ID dispositivo y no está en el
control: se puede inactivar, con un aviso previo, y para volver a activarla hay que editarla
con una estación registrada y obtener sus datos; el intento de activar una estación
desconocida se rechaza. El control de prueba devuelve ID/licencia ficticios y `SO-DEMO`
por estación, sin contactar RRAA ni usar identificadores aleatorios de navegador.
La identidad de instalación de CyP
no usa el control para su ámbito (en la demo pública sigue sin empresa RRAA), pero
«Obtener Datos de CyP» informa el mismo estado de validación que la lista.

Fuera del modo demo no se puede activar: `buildApp` lo rechaza, también si se pasa como
proveedor. No cambia el contrato recibido del proveedor ni la validación real de las
instalaciones. Los servidores auxiliares que construyen la app por su cuenta (por ejemplo
`scripts/serve-review-api.mts`) no lo activan.

## Flujo de CyP

- GET `/api/estaciones/rraa`: configuración disponible e idcliente, para lectores
  administrativos. No expone credenciales ni la dirección del servicio, y no llama al
  proveedor. `canObtainData: true` anuncia la consulta por estación. Con el control
  de prueba añade `simulated: true` y sus ejemplos.
- POST `/api/estaciones/obtener-datos`: Admin, cuerpo estricto `{stationCode}`.
  Obtiene el dispositivo/licencia/SO de STATDAT y comprueba la misma combinación
  con VALSTAT. Devuelve `{clientId,stationCode,deviceId,license,operatingSystem,validatedAt}`.
  No guarda ni activa nada y no necesita `Idempotency-Key`. No admite empresa,
  endpoint, ID, licencia ni SO enviados por el navegador.
- POST `/api/estaciones/validar`: Admin, `{stationCode,deviceId}`; consulta de solo
  lectura compatible con consumidores anteriores. Si STATDAT está disponible,
  exige que el ID enviado corresponda al que devuelve para esa empresa y estación
  antes de comprobar VALSTAT. No crea/activa una estación.
  Devuelve `{clientId,stationCode,deviceId,license,validatedAt}` y SO cuando está disponible. La interfaz exige
  una respuesta completa que corresponda a la empresa, estación y dispositivo
  consultados. Una consulta fallida o un cambio de identificadores invalida el
  uso de la validación anterior en ese formulario hasta obtener una respuesta
  válida nueva; la API siempre vuelve a validar al guardar o activar.
  Esta consulta no necesita `Idempotency-Key` ni reutiliza una autorización
  anterior; cada llamada consulta al proveedor. Las operaciones que guardan,
  activan o asocian estaciones sí conservan sus claves de idempotencia.
- POST `/api/estaciones` y `/api/estaciones/:id`: Admin, datos locales sin licencia
  ni SO ni versión digitados. `number` es opcional: al crear se asigna `máximo + 1`
  bajo el bloqueo transaccional; al editar se mantiene el anterior. `deviceId` puede
  omitirse; si se envía, tiene que coincidir con STATDAT. El ID y la licencia siempre
  proceden del proveedor. La API vuelve a consultar RRAA antes de guardar; la vista
  previa del cliente no es prueba de autorización. Solo OK crea/actualiza el registro.
  `active` es opcional: al crear, la estación empieza inactiva; al editar sin
  `active`, se conserva el estado actual. Con permisos personalizados, cambiar la
  actividad desde la edición exige el 114, igual que la ruta de actividad.
- POST `/api/estaciones/:id/actividad`: `{active}`. Activar requiere validación nueva
  de los identificadores persistidos. Inactivar siempre es posible para Admin,
  aunque el proveedor esté fuera de servicio, y conserva los demás datos.
- Las nuevas asociaciones de PCP requieren estación activa y validación guardada
  para la empresa configurada y los mismos identificadores; además consultan
  nuevamente RRAA antes de guardar la asociación. Si RRAA rechaza o no responde,
  no se agrega el vínculo ni se guardan cambios parciales. Los vínculos históricos
  pueden conservarse o retirarse sin darles validación retroactiva ni requerir
  otra consulta al proveedor.

La licencia proviene exclusivamente del servidor. Se persisten empresa, código,
dispositivo, fecha y actor de la comprobación (migración aditiva 025). Un cambio
de empresa configurada invalida la autorización guardada para nuevas activaciones
y asignaciones. La marca «Validada» acredita la última comprobación, no una garantía
perpetua de que el proveedor no haya revocado posteriormente la estación.

La migración aditiva **031_station_rraa_operating_system.sql** guarda SO en
`operating_system`, separado de `version`, con límites de longitud y sin controles
ni separadores. Los registros históricos conservan sus campos y SO queda `NULL`;
no se recalculan ni activan. Debe aplicarse antes de arrancar esta versión con
PostgreSQL: `pnpm db:migrate --from=031 --to=031 --apply`, después del respaldo
local y con las migraciones anteriores ya instaladas. La comprobación de
persistencia y constraints usa exclusivamente una base aislada con datos ficticios.

Las mutaciones conservan idempotencia, revisión de sesión y auditoría. Un reintento
de una operación ya guardada devuelve el resultado original sin repetir la consulta
externa. ER o indisponibilidad no guardan cambios ni sustituyen una licencia válida
por datos arbitrarios; no reactivan una estación. Se puede inactivar explícitamente.

## Verificación humana independiente

El login ya dispone de name/id, autocomplete y visualización segura de contraseña.
El navegador decide si ofrece guardarla; no se guardan claves en localStorage.
Confirmar guardado/autocompletado en el perfil habitual requiere al usuario y
su configuración de navegador. Una prueba de impresión verifica contenido, ruta
de impresión y cola, pero solo observar el papel acredita salida/legibilidad física.
Los porcentajes comerciales los configura Admin; no son datos proporcionados por RRAA.

Alcance actualizado por Rardiel el 10 de octubre: ambos porcentajes se introducen
y modifican manualmente por Admin desde la configuración existente; no se requiere
recibir números externos para cerrar esa funcionalidad. La prueba de papel queda
a cargo de Mayo, fuera del trabajo del asistente. La comprobación digital no
certifica la salida física ni su legibilidad.

Pasos para comprobar estos puntos en el puesto habitual:
[Validación de navegador e impresora](VALIDACION-NAVEGADOR-IMPRESORA.md).
