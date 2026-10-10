# RRAA — validación de estaciones

Contrato recibido el 9 de octubre de 2026: `GET /VALSTAT?p=idcliente|estacion|idestacion`.
Respuesta de texto: `OK|licencia` o `ER|Estación no encontrada.`.
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
No se configura el servicio real en la demo pública ni en los tests automáticos.
Los identificadores y licencias reales no se escriben en fixtures o Git.

El campo Estación es el código RRAA; ID dispositivo es idestacion. Nro. conserva
su función de identificador local de catálogo. Se rechazan `|`, controles y
campos vacíos en los parámetros; el servidor codifica la URL, bloquea redirecciones,
limita la espera y el tamaño de respuesta. Solo admite `OK` con licencia no vacía
o `ER` del contrato. Un error HTTP, timeout o respuesta malformada nunca autoriza.
El transporte es HTTP según el proveedor, sin cifrado TLS ni firma de respuesta.

## Flujo de CyP

- GET `/api/estaciones/rraa`: configuración disponible e idcliente, para lectores
  administrativos. No expone credenciales ni habilita edición en la demo pública.
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
