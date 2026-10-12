# RRAA — validación de estaciones

Contrato recibido el 9 de octubre de 2026: `GET /VALSTAT?p=idcliente|estacion|idestacion`.
Respuesta de texto: `OK|licencia` o `ER|motivo`. El contrato da como ejemplo
`ER|Estación no encontrada`; el servicio responde hoy con códigos cortos: `ER|ENE`
(estación no encontrada para ese idcliente y dispositivo) y `ER|CNE` (el idcliente no
existe). CyP los muestra con su texto y conserva el código entre paréntesis.
No existe en este contrato una operación para crear estaciones en RRAA, consultar
grupos/versiones ni emitir licencias independientemente de la validación.

El 10 de octubre de 2026 Rardiel pidió redactar una especificación propia para
avanzar el diseño. Está en [Propuesta de identidad y datos de CyP](RRAA-PROPUESTA-CYP.md),
implementada como identidad lógica y consulta propias de CyP. No es documentación
del proveedor ni añade operaciones a VALSTAT; el contrato recibido sigue intacto.

## Configuración y confianza

La API usa `RRAA_ENDPOINT` (URL de VALSTAT) y `RRAA_CLIENT_ID` en el entorno del
servidor. No se aceptan URL ni idcliente enviados por el navegador. En esta
instalación se utiliza `idcliente=0`, tal como en la petición proporcionada.
Ese valor procede del contrato recibido, no de un identificador inventado por CyP.
Para otra empresa se debe configurar el identificador que entregue el proveedor.
No se configura el servicio real en los tests automáticos. La dirección del servicio,
los identificadores y las licencias reales no se escriben en fixtures o Git.

El campo Estación es el código RRAA; ID dispositivo es idestacion. Nro. conserva
su función de identificador local de catálogo. Se rechazan `|`, controles y
campos vacíos en los parámetros; el servidor codifica la URL, bloquea redirecciones,
limita la espera y el tamaño de respuesta. Solo admite `OK` con licencia no vacía
o `ER` del contrato. Un error HTTP, timeout o respuesta malformada nunca autoriza.
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
- La demo es compartida: el servidor admite 20 consultas a RRAA por minuto en total y
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
de Estaciones lo dice en dos líneas, con un par libre de ejemplo, y sus etiquetas y ayudas
nombran el control de prueba en lugar de RRAA (el aviso aclara «no es RRAA real»).

La «Estación de demostración» (Nro. DEMO-001) no tiene ID dispositivo y no está en el
control: se puede inactivar, con un aviso previo, y para volver a activarla hay que editarla
con un par registrado; el intento de activarla lo dice. La identidad de instalación de CyP
no usa el control para su ámbito (en la demo pública sigue sin empresa RRAA), pero
«Obtener Datos de CyP» informa el mismo estado de validación que la lista.

Fuera del modo demo no se puede activar: `buildApp` lo rechaza, también si se pasa como
proveedor. No cambia el contrato recibido del proveedor ni la validación real de las
instalaciones. Los servidores auxiliares que construyen la app por su cuenta (por ejemplo
`scripts/serve-review-api.mts`) no lo activan.

## Flujo de CyP

- GET `/api/estaciones/rraa`: configuración disponible e idcliente, para lectores
  administrativos. No expone credenciales ni la dirección del servicio, y no llama al
  proveedor. Con el control de prueba añade `simulated: true` y sus ejemplos.
- POST `/api/estaciones/validar`: Admin, `{stationCode,deviceId}`; consulta de solo
  lectura a RRAA para mostrar la licencia y su fecha. No crea/activa una estación.
  Devuelve `{clientId,stationCode,deviceId,license,validatedAt}`. La interfaz exige
  una respuesta completa que corresponda a la empresa, estación y dispositivo
  consultados. Una consulta fallida o un cambio de identificadores invalida el
  uso de la validación anterior en ese formulario hasta obtener una respuesta
  válida nueva; la API siempre vuelve a validar al guardar o activar.
  Esta consulta no necesita `Idempotency-Key` ni reutiliza una autorización
  anterior; cada llamada consulta al proveedor. Las operaciones que guardan,
  activan o asocian estaciones sí conservan sus claves de idempotencia.
- POST `/api/estaciones` y `/api/estaciones/:id`: Admin, datos locales sin licencia
  ni versión digitadas. La API vuelve a consultar RRAA antes de guardar; la vista
  previa del cliente no es prueba de autorización. Solo OK crea/actualiza el registro.
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
