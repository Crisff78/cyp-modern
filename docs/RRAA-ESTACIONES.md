# RRAA — validación de estaciones

Contrato recibido el 9 de octubre de 2026: `GET /VALSTAT?p=idcliente|estacion|idestacion`.
Respuesta de texto: `OK|licencia` o `ER|Estación no encontrada.`.
No existe en este contrato una operación para crear estaciones en RRAA, consultar
grupos/versiones ni emitir licencias independientemente de la validación.

## Configuración y confianza

La API usa `RRAA_ENDPOINT` (URL de VALSTAT) y `RRAA_CLIENT_ID` en el entorno del
servidor. No se aceptan URL ni idcliente enviados por el navegador. En esta
instalación se utiliza inicialmente el idcliente del ejemplo recibido.
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
- POST `/api/estaciones` y `/api/estaciones/:id`: Admin, datos locales sin licencia
  ni versión digitadas. La API vuelve a consultar RRAA antes de guardar; la vista
  previa del cliente no es prueba de autorización. Solo OK crea/actualiza el registro.
- POST `/api/estaciones/:id/actividad`: `{active}`. Activar requiere validación nueva
  de los identificadores persistidos. Inactivar siempre es posible para Admin,
  aunque el proveedor esté fuera de servicio, y conserva los demás datos.
- Las nuevas asociaciones de PCP requieren estación activa y validación guardada
  para la empresa configurada y los mismos identificadores. Los vínculos históricos
  pueden conservarse o retirarse sin darles validación retroactiva.

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
El porcentaje comercial del gestor es una decisión de gerencia, no un dato de RRAA.

Pasos para comprobar estos puntos en el puesto habitual:
[Validación de navegador e impresora](VALIDACION-NAVEGADOR-IMPRESORA.md).
