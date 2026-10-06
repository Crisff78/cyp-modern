# Contratos de integridad — Fase 1

Implementación sobre la auditoría del 6 de octubre de 2026. La parametrización SQL, los cálculos contables y los permisos existentes se conservan.

## Días de cargos recurrentes

- `day1` y `day2` son opcionales en todas las frecuencias definidas, según la aclaración del usuario.
- Cada valor presente admite un número entero de 1 a 31 o un string de uno/dos dígitos que represente ese rango. `"01"` se normaliza a 1; `"abc"`, `"99"`, `"1e1"`, `"1.0"`, signos, espacios y booleanos se rechazan.
- Los días no usados se envían como `null` o se omiten. El string vacío se rechaza en API; el adaptador del formulario convierte el input vacío en `null`.
- La opción `No Definida` solo admite días no usados. No se añadieron días obligatorios ni nuevas reglas de generación del calendario.
- La base legacy usa columnas `text NOT NULL`. Para conservar compatibilidad sin una migración, el servidor almacena el día validado como string de dígitos y la ausencia como `""`. Nunca almacena los literales `"null"`/`"undefined"`.
- El formulario conectado aplica el mismo rango al guardar y al activar/inactivar registros; para `No Definida`, los controles de día quedan deshabilitados.

## Contactos

Se reutilizan los mismos esquemas en Cliente (`phone`, `cellular`, `email`), PCP (`phone`) y Cobrador (`cellular`). No se agregaron propiedades inexistentes a esos endpoints.

| Campo | Contrato |
|---|---|
| Teléfono/celular | Opcional vacío; máximo 40 caracteres formateados. Solo dígitos ASCII, espacios, guiones, paréntesis y `+` opcional al inicio. Entre 8 y 15 dígitos. Se conserva el formato, quitando solo espacios de los extremos. |
| Correo de cliente | Opcional vacío; máximo 200 caracteres y formato estándar Zod `string().email()`. Admite direcciones válidas con `+`. |

La creación y la edición tienen las mismas reglas. No se filtran símbolos de nombres, apodos, direcciones, notas, documentos ni contraseñas. Estas últimas no se recortan ni transforman. La validación de correo existente de cuentas permanece vigente.

## CSV

`app/shared/csv.ts` concentra la neutralización y el escape. Los reportes de `App.tsx`, el dashboard y la exportación compartida de remesas la usan.

- Anteponer `'` si el texto empieza con `=`, `+`, `-` o `@`, incluso detrás de espacios iniciales.
- Conservar también la defensa anterior frente a tabulación, CR y LF iniciales.
- Escapar comillas y delimitar correctamente celdas con separadores/saltos de línea.
- Mantener el delimitador y el comportamiento previo de comillas de cada exportador.
- Aplicar esto al exportar, sin modificar la información guardada ni los formularios.

## Verificación

Las pruebas nuevas usan la API real mediante `Fastify.inject` y `MemoryStore`, sin conexión a bases de datos, con altas/ediciones válidas e inválidas y comprobación de que el rechazo no modifica el estado. Se captura la persistencia de días para verificar la compatibilidad con las columnas existentes. Las pruebas de exportación verifican blobs y las funciones reales de descarga de reportes, además de entradas con fórmulas y texto legítimo.

Los límites reutilizados están en `app/shared/input-contracts.json`. No se ejecutan migraciones ni se sanea automáticamente información histórica. La configuración general con esquema libre permanece fuera del alcance de esta fase solicitada.
