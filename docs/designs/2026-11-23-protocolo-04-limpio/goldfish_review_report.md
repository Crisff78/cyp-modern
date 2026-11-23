# Revisión EGM del documento y cómo se resolvió

Dos revisores nuevos leyeron el documento limpio el 2026-11-23, antes de entregarlo: `egm-codebase-details` (lo
comparó con el código, con las pruebas, con la 0.1 y con la 0.4 de antes de limpiar) y `egm-comprehension` (lo leyó
como la persona que programa la aplicación y ya tiene la 0.1). Lo que sigue es lo que señalaron y qué se hizo; lo
escribe Claude Code (Fable 5.2).

## Aplicado

| # | Hallazgo | Qué se hizo |
| --- | --- | --- |
| 1 | **Bloqueante, de los dos.** «Lo que su aplicación ya hacía con la versión 0.1 sigue funcionando igual» era falso: Iniciar Sesión responde 5 partes y no 4 (una aplicación que las cuente falla), y `/cyp_clients?idSesion\|3.0` ya no busca «3.0». | «Lo nuevo de esta versión» se parte en dos: lo que tiene que revisar en su aplicación (las 5 partes, los datos de más, el 400 y el caso del Texto) y lo que la central acepta ahora sin que cambie nada. La frase se quitó. |
| 2 | El documento decía sin condición que las siete se aceptan por GET, pero fuera del modo demo Iniciar Sesión por GET responde `PIN` (`passwordByGet: config.demo`). Y el lector no sabía si tenía que programar POST. | La nota 2 lo dice: en la central real, por ahora, no está activado; se decide con él; hasta entonces no tiene que cambiar nada. |
| 3 | El 400 por un acento sin codificar chocaba con «si llega otro código HTTP, la petición se puede repetir»: lo repetiría sin fin, también en Registrar Envío. | Notas 3 y 4: un 400 no se repite tal cual; hay que corregir la dirección. |
| 4 | Ese 400 no estaba comprobado: no sale del código ni de las pruebas, que no pasan por la red. | Comprobado en la demo con la dirección escrita byte a byte y una sesión que no existe: acento o espacio sin codificar, HTTP 400 sin cuerpo; codificados, la petición llega. Anotado en `docs/PROTOCOLO-TEXTO-PLANO.md`. |
| 5 | «No tiene que mandar ninguna cabecera» dejaba la duda de si estorba la que la 0.1 pedía, y chocaba con el `Content-Type` de la nota 2. | «Ninguna cabecera especial… Si manda alguna de más, no pasa nada: la central no la mira». Sin nombrar la que se quitó. |
| 6 | Con el tope de 8000 caracteres, una aplicación que solo manda GET no sabía qué hacer. | «…o, si su aplicación solo manda GET, acorte la Nota (al codificarla, cada letra con acento ocupa 6 caracteres)». |
| 7 | El caso del Texto que parece una versión: quien siempre manda `3.0` al final no sabía si le aplicaba. Y «un importe nunca se confunde» no decía por qué. | Dice que solo pasa si alguna vez no manda `VersionApp`, y el porqué: la central solo la aparta cuando la petición ya trae sus datos obligatorios. |
| 8 | La pregunta 2 afirmaba y preguntaba a la vez qué es el número. La 4a no decía para qué serviría una cabecera. | La 2 solo pregunta por la Versión en las respuestas. La 4a: «¿puede mandar la Clave en una cabecera, en vez de en la dirección?». |
| 9 | Marcas ambiguas: el título de la nota 2 cubría puntos que ya estaban en la 0.1; «hasta el final de esta nota»; «Esto vale…»; marcas a mitad de un punto; la de `Vence`, repetida. | La marca va en cada punto nuevo de la nota 2; «todo lo que sigue hasta el título 2»; «Las reglas de este apartado valen…»; las marcas pasan a renglón propio; se quita la repetida. |
| 10 | La central que se duerme estaba marcada pero no en el resumen, y «un minuto o más» pasa de los 30 segundos de espera que aconseja la nota 4. | Está en el resumen, y la nota 9 dice que para esa primera petición espere hasta 2 minutos. |
| 11 | «Son nuevas la 2 y la 4»: las dos ya estaban en la 0.1 y la 4c no cambió. | «Tienen parte nueva la 2 y la 4 (a y b). Las demás son las mismas». |
| 12 | No decía qué responde un cuerpo de POST que empieza por `p=`. | «Si el cuerpo empieza por p=, la central responde ER con PIN». |
| 13 | Frases más simples, y falta un ejemplo de Registrar Envío con su forma de llamar. | Adoptadas («prueba la Clave con ese final y sin él», «la central cuenta 16 y toma VersionApp por la Nota», «compara los datos, no la forma de mandarlos»). Ejemplo añadido en 3.2, con `p=` y `3.0` como dato 17. |
| 14 | «¿Hubo una 0.2 y una 0.3?» | «Esta es la versión 0.4, la siguiente a la 0.1 que usted tiene». |

## No aplicado, y por qué

- **Decir en el documento que la cabecera de invitación ya no hace falta.** Es lo único que la 0.1 pedía y la 0.4
  calla. Rardiel pidió no mencionar lo que ya no está. El documento dice la regla de hoy (ninguna cabecera especial;
  una de más no estorba) y el mensaje que acompaña al documento lo dice con su nombre.
- **Marcar `Vence` también en su definición.** La marca ya está junto a la respuesta de Iniciar Sesión.

## Sin hallazgo

- Ninguna regla se perdió al limpiar: solo faltan las supresiones queridas.
- No queda ningún resto de lo quitado ni frases que cuenten lo de antes.
- Cada marca es nueva respecto de la 0.1, y nada nuevo sin marca obliga a cambiar la aplicación.
- Lo marcado coincide con el código: `p=`, `VersionApp`, las dos lecturas de la Clave, el tope de 8000, `Vence` y
  que la central no pide cabeceras.

## No comprobado por los revisores

Que la central de pruebas se duerme (depende del alojamiento; medido por Claude Code el 2026-11-23: la primera
petición tardó 75 segundos) y qué código responde una sesión vencida (`SNE` o `SNA`), que no era de esta tarea.
