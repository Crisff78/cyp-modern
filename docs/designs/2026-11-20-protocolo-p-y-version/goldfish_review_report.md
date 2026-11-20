# Revisión EGM del plan y cómo se resolvió

Dos revisores nuevos leyeron el plan y el código el 2026-11-20, antes de programar: `egm-design` (la decisión y lo
que cuesta) y `egm-codebase-details` (que lo que el plan dice del código sea cierto). Ninguno encontró nada que el
código desmienta; los dos dijeron que el plan no estaba listo para ejecutar tal como estaba. Lo que sigue es lo que
señalaron y qué se hizo; lo escribe Claude Code (Fable 5.2).

## Aplicado

| # | Hallazgo | Qué se hizo |
| --- | --- | --- |
| 1 | La expresión de la versión alcanzaba teléfonos con puntos: `809.555.0100` casaba, y hoy esa búsqueda funciona (`remittance-client-search.ts:15`). Devolvería todos los clientes, en silencio. | `/^\d{1,3}(\.\d{1,3}){1,2}$/`: casa `3.0`, `1.14`, `10.2.1` y no un teléfono. Probado. |
| 2 | Las dos salvedades del plan (el primer dato y «donde va un importe») eran más complicadas de lo necesario y dejaban un error falso: un envío con `Nota` `500.00` bajaba a 15 datos y respondía «lleva siempre 16 datos». | Regla nueva: la versión es siempre un dato de más y se quita solo si la petición ya tiene sus datos obligatorios (`REQUIRED`). En Registrar Envío solo puede ser el dato 17. |
| 3 | El coste estaba mal contado: `Referencia` y `Banco` nunca van los últimos; faltaban el `Texto` como último dato, los opcionales escritos `2.0` y la `Nota` con un pipe sin limpiar. | «Lo que cuesta» reescrito en el plan y en `docs/PROTOCOLO-TEXTO-PLANO.md`; el caso del `Texto` y su salida, en el contrato. |
| 4 | Iniciar Sesión: con una clave mala de 197 a 200 caracteres y `\|3.0` detrás, la segunda lectura no pasaba la validación y salía `PIN` en vez de `UCI`. El bucle no estaba escrito. | Bucle escrito: si la segunda lectura no cabe, vale la respuesta de la primera. Probado con 198 caracteres. |
| 5 | `Usuario\|\|3.0` daría `UCI` y no «Falta la Clave». | Responde `PIN` (Clave), como `Usuario\|`. Probado. |
| 6 | Un cuerpo de POST que empiece por `p=` respondería `UCI` o `SNE` a ciegas. | Responde `PIN` (Parametros) con un mensaje que lo dice. Probado. |
| 7 | Decir y probar que `?P=` y `?p%3D` no son el prefijo. | En el comentario de `rawParameters`, en el contrato («en minúscula», «justo después del ?») y en la prueba. |
| 8 | No afirmar que el `3.0` es «la versión de su aplicación»: no se sabe. Darle nombre propio. | `VersionApp`: «El número que su aplicación pone al final (hoy, 3.0). No es la versión de este documento…». La pregunta 2 del contrato pregunta qué es. |
| 9 | El formato general de LSAN es `Estado\|FechayHora\|Versión\|Otros Datos`: una aplicación que manda versión puede esperarla en las respuestas y leer mal el `idSesion`. | Sin cambio de código. Anotado como primera hipótesis del próximo fallo en `docs/PROTOCOLO-TEXTO-PLANO.md`, y preguntado en el contrato. |
| 10 | Si manda el `\|` sin codificar, puede mandar igual espacios, `ñ` o `+`. Faltaba caracterizarlo. | Hecho contra un servidor local, byte a byte, y escrito: UTF-8 con `%` funciona; sin codificar, HTTP 400; `%ED`, `PIN`; `+` es un signo de más. El contrato avisa del 400. |
| 11 | Líneas del contrato que dejaban de ser ciertas y el plan no listaba: «se parte solo por el primer pipe», «decodifica todo lo que sigue al ?», «siempre los 16 datos», «menos el idSesion», «sobra un dato». Faltaba la entrada 0.4 en «Modificado». | Cambiadas todas. Las «Pet:» no se tocan una a una: una frase en las Notas Generales dice que `p=` y `VersionApp` valen en todas. |
| 12 | «20 intentos de clave por minuto» pasa a ser hasta 30 comprobaciones. | Corregido en `docs/PROTOCOLO-TEXTO-PLANO.md`. |
| 13 | Fuera del modo demo, Iniciar Sesión por GET se rechaza, y su aplicación entra por GET. | Añadido a «Antes de producción». |
| 14 | El plan no pasaba la norma: sin fases, `withoutVersion` sin firma, el texto de la 0.4 sin escribir, «Modificar» sin decir qué. | Plan reescrito con dos fases, el código tal como quedó y los cambios del contrato uno por uno. |
| 15 | Las pruebas nuevas de inicio de sesión gastarían el límite de 10 por aplicación. | Cada prueba nueva abre su propia aplicación; cuenta nueva en el `fixture`. |
| 16 | «Ya no hay preguntas» era falso: sigue la pregunta 2, sobre la Versión. | El mensaje a la otra parte no añade preguntas; la 2 del contrato se rehízo. |

## No aplicado, y por qué

- **Preguntarle antes qué es el número y dónde lo manda.** La central no lo usa: la respuesta no cambia lo que se
  programa. Y Rardiel pidió decidir con lo que hay.
- **Aceptar solo lo visto** (`p=` y el número en Iniciar Sesión). Es la opción prudente, pero si lo manda en todas,
  la siguiente prueba falla otra vez y cuesta otra ronda a mano. Un `p=` que su documento no escribe sugiere un
  constructor de direcciones genérico, que pondría el número en todas.

## Sin hallazgo

- Quitar `p=` antes de decodificar es correcto, y nadie más lee la consulta de `/cyp_*`.
- Las dos lecturas de la Clave: misma cuenta, misma función, y `signIn` no deja rastro al fallar. A un atacante solo
  le dan un segundo candidato forzado a `intento|n.n`.
- La huella del `idOperacion` es idéntica, byte a byte, para todo lo que ya estaba guardado.
- Ningún importe puede registrarse distinto: se exigen los 16 datos y la central vuelve a cotizar.
- Ninguna prueba existente se rompe.
- Pasar a la 0.4 es correcto.

## No comprobado por los revisores

La captura, el documento LSAN, la transcripción de la reunión y la prueba en la demo: los revisores leyeron el plan,
la norma, el contrato y el código.
