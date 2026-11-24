# Revisión EGM del plan: listado con teléfono y dirección, e `idCliente` corto

Dos revisores nuevos sobre la primera versión del plan, el 2026-11-24: `egm-codebase-details` y `egm-design`. Resolución de
Claude Code (Fable 5.2).

## Bloqueante

- **«Los clientes sin identificación interna son los de las semillas y sus ids son cortos» era falso.** Tampoco la tienen
  los de la demo V2 (ids de 17 y 27 caracteres), los importados ni los anteriores a la migración 029. Comprobado en la
  demo: 44 de 45 clientes sin ella. Resuelto: el plan lo dice, y la demo pública da identificación interna a todos en
  el arranque (`assignMissingClientIdentities`). Fuera de la demo queda como decisión en «Antes de producción».

## Importantes

- **Datos del Cliente devolvería `DOP` en silencio con el id corto** (la moneda se buscaba por el texto recibido).
  Resuelto: se busca por el cliente ya resuelto; prueba con un cliente en EUR, por el corto y por el largo.
- **Orden al registrar y `MCL`.** Resuelto: la resolución va tras el `idOperacion`, no lanza error, `MCL` se decide con
  los clientes resueltos y `createRemittance` recibe los `id` internos. Pruebas: mismo cliente por sus dos ids, dos
  textos iguales que no existen, y repetición idéntica con el destinatario ya inactivo.
- **`idOperacion` con la otra forma del id.** Resuelto: es `OPD` con el `NumEnvio` y no crea otro envío; probado y
  escrito en el contrato (3.2).
- **Un `id` podría chocar con la identificación interna de otro cliente.** Ningún camino lo produce hoy. Resuelto:
  `clientOf` busca por identificación interna solo si el texto tiene esa forma, y `taken()` mira también los `id`.
  Comprobado en la demo y en las bases de prueba: 0 choques.
- **Privacidad: el listado acelera cien veces sacar teléfonos y direcciones.** Aceptado por orden de Rardiel; escrito
  en «Lo que cuesta» y en «Antes de producción», con la salida de vaciarlos a un Cobrador para clientes de otra ruta.
- **Tres aserciones existentes se rompían** (`text-protocol.test.ts`, listado con 3 campos). Actualizadas.
- **Faltaba la tabla de archivos** y varios documentos que citaban la 0.5. Resuelto.
- **El contrato no debe prometer el formato.** Resuelto: «normalmente 11 caracteres», texto de hasta 80, no se arma ni
  se saca del `Codigo`, y si la central devuelve otro `idCliente` se usa el nuevo. Ejemplos con números distintos para
  `INT…` y `CLI…`. Pregunta 7 reescrita.

## Menores

- La inmutabilidad en memoria depende del código, no de la base: dicho en el plan y en `PROTOCOLO-TEXTO-PLANO.md`.
- `int00000012` en minúsculas es `CNE`: probado; el contrato dice «con sus mayúsculas».
- `Telefono` en el listado es teléfono o celular: dicho en 2.1.
- `idEnvio` e `idUsuario` se quedan; anotado que una petición futura sobre un envío use el `NumEnvio`.
- La comprobación tras publicar nombra qué se mira: todos los clientes del listado y uno en Datos del Cliente.
- El comentario de cabecera decía que el protocolo no tiene nada propio: ahora nombra el `idCliente`.

## Sin diferencia (comprobado por los revisores)

Aceptar las dos formas no puede duplicar un envío; mantener la huella sobre el texto recibido es lo correcto; el listado
pasa por la misma puerta y la misma regla de ruta que Datos del Cliente; ningún camino borra clientes ni reutiliza una
identificación interna.
