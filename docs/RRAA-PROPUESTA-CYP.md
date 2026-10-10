# Propuesta propia de CyP: identidad de instalación y consulta de datos

**Versión:** 1.0, 10 de octubre de 2026. **Estado:** diseño propuesto, sin
implementación ni aprobación del proveedor. Redactado para CyP a petición de
Rardiel; no es documentación oficial de Gamera/RRAA.

El único contrato externo recibido sigue siendo `GET /VALSTAT` y sus respuestas
de licencia o error, descritos en [RRAA — estaciones](RRAA-ESTACIONES.md).
Las rutas de este documento pertenecen al diseño de una API propia de CyP:
**no existen todavía, no deben llamarse ni presentarse como endpoints de RRAA**.

## 1. Objetivo y separación de identificadores

| Campo | Significado | Origen y edición |
|---|---|---|
| `stationId` | Registro de estación del catálogo CyP | Servidor CyP; identificador interno existente. |
| `installationId` | Identidad lógica de una instalación/perfil de navegador | Servicio propio propuesto; solo lectura tras el registro. |
| `stationCode` | Código de estación RRAA | Valor autorizado por el proveedor, conservado en el catálogo. |
| `deviceId` / `idestacion` | Identificador que acepta VALSTAT | Contrato del proveedor; permanece independiente. |

No convertir automáticamente `installationId` en `idestacion`, ni una clave
generada por CyP en licencia RRAA. El Nro. de catálogo conserva su significado.

## 2. Identidad lógica propuesta

1. El navegador, en un contexto seguro, genera un par ECDSA P-256 mediante
   Web Crypto. La clave privada se crea con `extractable: false`, uso `sign`;
   se conserva como `CryptoKey` en IndexedDB. No se guarda en texto, localStorage,
   Git, logs ni documentos. La clave pública SPKI puede enviarse al servidor.
2. CyP deriva `installationId` del SHA-256 de la clave pública SPKI, con prefijo
   propio `CYP-INST-`. Este valor es una referencia, nunca una autorización.
3. Un Admin autenticado inicia el registro para una estación existente. La API
   exige una prueba de posesión de la clave y aprobación explícita del Admin.
   Tener una sesión o conocer el ID de una estación no basta para registrarla.
4. Las consultas protegidas de esa instalación exigen una firma de un desafío
   nuevo con la clave registrada. Copiar únicamente el texto del ID no permite
   producir esa firma. La autorización efectiva sigue dependiendo del rol.

La restricción de exportación limita las operaciones de la API Web Crypto;
**no prueba almacenamiento en TPM, identidad de hardware ni resistencia a la
copia de un perfil comprometido**. Borrar el perfil, cambiar de navegador o
reinstalar puede crear otra instalación: se requiere nuevo registro y revocación
de la anterior, sin reutilizar automáticamente una licencia.

Si se exige identidad física, deberá especificarse y comprobarse un autenticador
o componente con vinculación verificable al equipo. Este diseño lógico no cierra
ese requisito. Las credenciales sincronizables tampoco se deben contar como
prueba de un único equipo.

## 3. Operaciones propias propuestas, aún no implementadas

| Ruta propuesta | Uso | Requisitos |
|---|---|---|
| `POST /api/estaciones/:id/instalaciones/desafios` | Emitir desafío para registro o consulta | Sesión autorizada, estación de la empresa y propósito permitido. |
| `POST /api/estaciones/:id/instalaciones` | Registrar clave pública y prueba firmada | Admin, confirmación, desafío de registro e `Idempotency-Key`. |
| `POST /api/estaciones/:id/datos` | «Obtener Datos» del catálogo CyP con prueba de posesión | Sesión autorizada y desafío de consulta; operación de lectura. |
| `POST /api/estaciones/:id/instalaciones/:installationId/revocar` | Revocar instalación | Admin, motivo, revisión esperada e `Idempotency-Key`. |

Se propone POST para consultar datos porque la firma y el desafío se envían en
el cuerpo; no se colocan pruebas de acceso en URL. La respuesta no contiene
clave privada ni cambia la estación, licencias, vínculos o estado RRAA.

### Desafíos y comprobación

- Nonce aleatorio de 32 bytes, caducidad de 60 segundos y un solo uso.
- Vincular a empresa, estación, instalación, sesión, origen y propósito.
- Firmar bytes UTF-8 definidos por versión: dominio `CYP-INSTALLATION-V1`,
  propósito, ID del desafío, nonce y los campos vinculados, con codificación
  inequívoca. Rechazar campos adicionales, algoritmos y tamaños no admitidos.
- Verificar firma y autorización en el servidor, y consumir el desafío
  atómicamente. Rechazar reutilización, vencimiento, instalación revocada,
  empresa/estación distinta y propósito incorrecto.
- Limitar intentos y tamaño de petición. Los errores no generan una estación
  validada ni sustituyen una licencia. Auditar actor, fecha y resultado sin
  guardar firmas, nonces, credenciales ni cuerpos privados.
- El reintento idempotente de una mutación ya confirmada devuelve su resultado
  original antes de intentar consumir de nuevo el desafío. Un fallo de lectura
  requiere un desafío nuevo, sin repetir mutaciones.

### Datos de respuesta propuestos

`stationId`, `stationCode`, `installationId`, `installationStatus`,
`active`, `rraaValidationStatus`, `rraaValidatedAt?`, `queriedAt` y
`cypBuildVersion?`. Las marcas de tiempo son UTC del servidor.

La versión CyP procede del build real si está disponible; si falta, se omite.
La versión RRAA y la «versión recibida» se omiten mientras el contrato externo
no las proporcione. `rraaValidationStatus` informa la comprobación registrada,
no declara que el proveedor haya autorizado esta consulta propia. No se devuelve
el texto de una licencia en esta respuesta.

## 4. Persistencia y presentación propuestas

Guardar empresa, estación, identificador lógico, clave pública, algoritmo,
estado, revisión, fecha/actor de registro y fecha/actor/motivo de revocación.
No modificar claves históricas ni registrar una nueva instalación por refrescar
una pantalla. Los desafíos caducados se eliminan según una retención acotada.

La pantalla separará «ID de instalación CyP» de «ID del proveedor RRAA».
El primero será de solo lectura. «Obtener Datos de CyP» indicará su origen y
mostrará fecha de consulta; el control de RRAA permanecerá separado. Hasta que
este diseño se implemente, el botón actual sin contrato sigue deshabilitado.

## 5. Compatibilidad con la integración actual

Se mantienen la validación real VALSTAT antes de guardar/activar y la comprobación
de nuevas asociaciones de PCP. No hay modo de aprobación por ID generado,
respuesta simulada, documentación o ausencia del proveedor. La demo pública no
se conecta al proveedor real ni adquiere una licencia por publicar esta propuesta.

Antes de habilitar la adaptación externa debe acordarse cómo RRAA emite/registra
`idestacion`, cómo se vincula al equipo y qué operación aporta sus datos. El
contrato propio puede desarrollarse separadamente; no inventa compatibilidad.

## 6. Criterios para una futura implementación

Pruebas con datos ficticios y almacén aislado: persistencia de clave/registro,
ID textual copiado sin clave rechazado, firma incorrecta, repetición, caducidad,
revocación, aislamiento entre empresas/estaciones, concurrencia de desafíos,
reintentos idempotentes y consulta sin cambios. Comprobar registro, revocación,
campos de solo lectura y pérdida del perfil en el navegador.

Estos son criterios de aceptación futuros; **no son pruebas ejecutadas**. No
acreditan identidad física ni interacción con RRAA.

## Referencias técnicas

- [Web Cryptography API, W3C](https://www.w3.org/TR/WebCryptoAPI/): claves,
  firma y control de exportación. La API no garantiza almacenamiento en hardware.
- [Web Authentication Level 3, W3C](https://www.w3.org/TR/webauthn-3/): distingue
  credenciales de un dispositivo de las elegibles para respaldo/sincronización.

Estas fuentes describen estándares web; no documentan el servicio de Gamera.
