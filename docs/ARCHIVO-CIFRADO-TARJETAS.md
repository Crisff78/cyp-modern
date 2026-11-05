# Archivo cifrado de tarjetas — preparado, desactivado por defecto

CyP registra un pago que ya se efectuó por verifone. Este módulo no cobra ni autoriza tarjetas. No es una certificación PCI DSS.

## Estado en la demo

`CARD_VAULT_ENABLED` permanece desactivado. En Render se siguen guardando titular, banco, referencia y últimos cuatro dígitos. No se conserva el número completo ni el vencimiento. Los controles temporales de la demo solo admiten datos ficticios. El CVV nunca se envía ni se guarda.

## Preparación del servidor de la empresa

1. Aplicar las migraciones con el procedimiento habitual. `048_encrypted_card_archive.sql` agrega una tabla separada de sobres cifrados, sin modificar remesas anteriores.
2. Preparar HTTPS y una ubicación de secretos fuera del repositorio, la base de datos y sus respaldos ordinarios. No reutilizar JWT_SECRET, una contraseña ni una clave guardada en la misma tabla.
3. Generar una clave privada RSA de 3072 bits en ese servidor con `node app/server/scripts/generate-card-vault-key.mjs --out=/ruta/privada/card-vault.env`. La carpeta debe existir y tener permisos restringidos. El script no sobrescribe ni imprime la clave; crea el archivo con modo 0600 en sistemas compatibles. En Windows hay que restringir también las ACL de archivo/carpeta al servicio y a los administradores autorizados.
4. Cargar las variables del archivo mediante el gestor de secretos o el servicio del sistema. Definir `CARD_VAULT_RETENTION_DAYS` con el plazo aprobado por Gerencia (1–365 días, sin valor predeterminado). Cambiar `CARD_VAULT_ENABLED=true` y reiniciar. Una configuración incompleta impide activar el módulo; no se inventa una clave ni se guarda en texto plano.
5. Comprobar el aviso de archivo cifrado en la pantalla y probar con datos ficticios antes de usar datos reales. Respaldar la clave en un almacén de secretos separado; sin ella no se puede recuperar el archivo. Una rotación requiere conservar las claves anteriores protegidas durante el plazo de los registros aún vigentes, identificadas por keyId.

No se requiere configurar esta clave en Render: por decisión del usuario, solo se prepara el código para el servidor de la empresa.

## Contrato y protección

- Snapshot autenticado: `cardStorage.enabled=false` o clave pública JWK, identificador y plazo. Nunca incluye la clave privada.
- Solo cuando está activado: el cliente cifra `{pan, expiry}` con RSA-OAEP/SHA-256 antes de enviar. Valida 16 dígitos, comprobación de Luhn y MM/YY; eso no acredita que la tarjeta esté activa ni tenga fondos. El CVV desaparece de la captura productiva y está prohibido en el contrato.
- El cuerpo de creación admite `cardArchive: {version:1,keyId,ciphertext}`. No admite PAN, vencimiento o CVV en texto plano, ni dentro de payment. El servidor descifra temporalmente, valida una lista estricta de dos campos y comprueba que coincida last4. Una clave cambiada, un CVV oculto dentro del sobre o un formato inválido se rechazan sin crear la operación.
- El servidor vuelve a cifrar con AES-256-GCM y una clave aleatoria por registro; esa clave se envuelve con RSA-OAEP/SHA-256. El cifrado vincula remesa, actor, creación, caducidad y keyId. No se guarda CVV. Se limpian los buffers temporales; no se promete borrado criptográfico de todas las copias internas que pueda mantener el motor JavaScript.
- Archivo y remesa se confirman en una misma transacción. La idempotencia conserva el sobre cifrado; un reintento no reenvía PAN ni duplica filas. Con el archivo activado, una creación nueva de crédito exige el sobre; los reintentos ya confirmados conservan su respuesta histórica.
- No hay una ruta API para revelar números completos o vencimientos. Los recibos y reportes siguen mostrando solo los últimos cuatro. La respuesta de creación confirma cardStored; el cliente no anuncia que archivó la tarjeta sin esa confirmación.
- El archivo no puede modificarse ni borrarse antes de caducar. Los registros vencidos se depuran al iniciar y cada hora, sin borrar la remesa ni su comprobante. El mantenimiento de respaldos, copias externas y claves debe respetar también el plazo aprobado; la depuración solo cubre la tabla principal.

## Diagnóstico sin registrar operaciones

`/api/health` agrega `cardRecordsReady` cuando usa PostgreSQL: `true` si su validador admite el formato de tarjeta actual, `false` si lo rechaza y `null` si no pudo comprobarse. Son consultas sintéticas de solo lectura; no crean envíos ni modifican caja. Un `false` identifica una incompatibilidad, no autoriza saltarse la restricción.

Los errores internos incluyen una referencia de soporte. Las restricciones conocidas del comprobante devuelven CARD_PAYMENT_REJECTED y confirman el rollback; no se repite indefinidamente una operación que la base ya rechazó. No se muestran detalles SQL ni datos de tarjeta al usuario. Esta mejora no acredita haber identificado la causa de un fallo remoto sin verificar su diagnóstico.

## Avisos del navegador

Los controles solicitan `autocomplete=off`, no tienen nombre de formulario para PAN/vencimiento/CVV y se limpian al confirmar, cancelar u ocultar la página. Eso no puede prohibir las funciones propias del navegador ni de sus extensiones. Para equipos de trabajo, desactivar Guardar y rellenar métodos de pago en la configuración o política administrada de Edge/Chrome. No modificar el guardado de contraseñas del login de CyP.

Referencias oficiales: https://www.pcisecuritystandards.org/faqs/1280/ ; https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/Turning_off_form_autocompletion ; https://support.microsoft.com/en-us/edge/saving-credit-or-debit-card-info-in-microsoft-edge
