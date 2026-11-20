# Revisión EGM del plan y cómo se resolvió

Dos revisores nuevos leyeron el plan y el código el 2026-11-20, antes de programar: `egm-codebase-details` (los
hechos, contra el código) y `egm-design` (las decisiones). Ninguno encontró bloqueantes. Lo que sigue es lo que
señalaron y qué se hizo; lo escribe Claude Code (Fable 5.2).

## Aplicado

| # | Hallazgo | Qué se hizo |
| --- | --- | --- |
| 1 | La clave no es como el `idSesion`: es la de la central web y no vence. Y «solo en pruebas» era un hecho del despliegue, no del código: el día de producción la aplicación ya estaría hecha con GET. | Iniciar Sesión por GET solo en modo demo (`passwordByGet`). Fuera, sigue `PIN`. Hay prueba, y una sección «Antes de producción» en `docs/PROTOCOLO-TEXTO-PLANO.md`. |
| 2 | «Trabajan con GET» es de segunda mano: no dice si no pueden mandar POST o si lo prefieren. | El punto 4a del documento sigue siendo pregunta: ¿puede mandar POST en Iniciar Sesión? Si no, ¿puede poner una cabecera en un GET? |
| 3 | Un GET de Registrar Envío con una Nota larga puede pasar el máximo de dirección de Node o del proxy; la respuesta no sería del protocolo, y el contrato manda repetir. | Tope de 8000 caracteres con respuesta `PIN` y «mande esta petición por POST»; escrito en el documento; medido por HTTP real (12 521 caracteres: `PIN`; 20 000: 431). |
| 4 | Leer el estado entero para saber cuándo vence es caro, y una sesión revocada justo entonces daría `SNA` en el inicio de sesión. | `signIn` devuelve `expiresAt`; no se lee nada más. La web sigue devolviendo solo `token` y `user` (comprobado por HTTP). |
| 5 | `Vence` es hora dominicana sin zona: un teléfono con otra hora la leería mal. Y la sesión puede acabar antes. | El documento lo dice: compararla con la `FechayHora` de la central, no con el reloj del teléfono; puede terminar antes. |
| 6 | Faltaba una regla para poder añadir datos sin romper a quien ya lee las respuestas. | Regla nueva en las Notas: en versiones nuevas pueden venir datos de más al final; hay que ignorarlos. |
| 7 | El espacio codificado como `+` (lo hacen las librerías de formularios): la Clave daría `UCI` y una Nota se guardaría con `+`. | La regla no cambia. Aviso con ejemplo en las Notas y en 1.1, pregunta 4b, y una prueba. |
| 8 | El documento ya tenía «Agregado» y «Modificado»; el plan creaba otro bloque. | Se usan esas dos secciones. |
| 9 | Líneas del documento que quedaban falsas y el plan no listaba: «el cuerpo» en las reglas a) y c) del `idOperacion`; el título y «SHA-256 del cuerpo» en `PROTOCOLO-TEXTO-PLANO.md`. | Corregidas. Añadido un ejemplo de envío por GET con espacio y ñ. |
| 10 | Pruebas: se rompía una tercera comprobación (4 partes); comparar «la misma línea» falla si cambia el segundo; «8 h + 2 s» era frágil; el `#` se pierde en la dirección de prueba si no se codifica. | 5 partes; se compara la parte del envío; `Vence` se compara con `exp` y `expiresAt` reales; todo se manda con `encodeURIComponent`. |
| 11 | El plan no declaraba fases ni redactaba las frases del documento. | Fase única declarada; las frases están en el documento y resumidas en el plan. |
| 12 | La pregunta para la otra parte debía quedar fijada. | En el mensaje para mandar: «¿Qué recibe del inicio de sesión de LSAN que aquí no encuentra?». |

## No aplicado, y por qué

- **La clave en una cabecera (`X-CyP-Clave`) ya.** Sería una tercera forma de entrar sin saber si la necesitan. Queda
  escrita como salida para producción y se pregunta en 4a.
- **El estado de la Caja de Remesas en el inicio de sesión.** Cada dato nuevo es contrato; se espera a que aclaren
  qué piden.
- **Una duración en segundos además de `Vence`.** Dos datos para lo mismo son dos verdades.

## Sin hallazgo

- Quitar la comprobación basta: la puerta de la demo no mira el método, el `preHandler` deja pasar estas rutas y
  `rawParameters` ya lee la dirección.
- El límite de 10 por minuto es uno solo para GET y POST.
- El servidor no guarda direcciones en registros, trazas, filas de idempotencia ni claves de límite, y
  `Cache-Control: no-store` va también en los errores.
- La huella del `idOperacion` es la misma por GET que por POST, y un HEAD no ejecuta una petición.
- `Vence` nunca es posterior al final real de la sesión.
- Renombrar el documento no rompe pruebas ni guiones.
