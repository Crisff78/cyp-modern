# Protocolo CYP 0.4, limpio: solo lo que existe hoy, con lo nuevo marcado

Plan escrito por Claude Code (Fable 5.2) el 2026-11-23, en la laptop de Rardiel, sobre `main` `8531486`. Esta es la
versión corregida después de la revisión (ver `goldfish_review_report.md`); el documento quedó así.

## De dónde sale

Orden de Rardiel del 2026-11-23: «Dame el mensaje que tengo que mandarle ahora, y el protocolo con todo pero
eliminando las partes que ya no van (las que tuvimos que modificar y que no es necesario mencionar porque ya no
están) e indicando las partes nuevas».

Quien programa la aplicación tiene la versión 0.1. Las versiones 0.2 y 0.3 no consta que se le mandaran. La 0.4 se
publicó en la central de pruebas el 2026-11-23 y todavía no se le ha enviado.

## Qué cambia

Solo el documento `docs/protocolo-cyp/Protocolo CYP 0.4.txt` y tres frases de `docs/PROTOCOLO-TEXTO-PLANO.md`. No
cambia ninguna línea de código: la central hace lo mismo.

### 1. Se quita lo que ya no existe

| Dónde | Qué se quita |
| --- | --- |
| Notas Generales, 9 | Las frases sobre el código de invitación y la cabecera `X-CyP-Invitacion`. Queda la regla de hoy: no hay que mandar ninguna cabecera especial, y si se manda alguna de más, la central no la mira. |
| «Agregado» y «Modificado» | Las dos secciones, con su historial por versión («se quitó la cabecera», «en la 0.1 eran solo por POST», «cambió la pregunta 4»). |
| Pregunta 4a del final | «desde la versión 0.2». |
| Pregunta 2 del final | «¿Qué es ese número?»: el documento ya le pone nombre (`VersionApp`) y la central no lo usa. |

El historial por versión sigue en git y en los planes de `docs/designs/`.

### 2. Se marca lo nuevo

«Nuevo» quiere decir nuevo desde la versión 0.1. La lista sale de comparar los dos documentos línea a línea.

- Cada parte nueva lleva `(NUEVO)` delante, en su propio punto o renglón. El único bloque largo (nota 1) dice hasta
  dónde llega: «todo lo que sigue hasta el título 2».
- Una sección corta, «Lo nuevo de esta versión», en el sitio de «Agregado» y «Modificado», partida en dos:
  **lo que esa persona tiene que revisar en su aplicación** y **lo que la central acepta ahora sin que cambie nada**.
- En la nota 1, lo de siempre queda primero y lo de `p=` y `VersionApp` junto y al final.

### 3. Lo que se aclara, sin cambiar ninguna regla

Salió de la revisión. Todo es cierto en el código o se comprobó en la demo:

- La respuesta de Iniciar Sesión tiene ahora 5 partes: va primero en «lo que tiene que revisar».
- Un código HTTP 400 (acento o espacio sin codificar) no se repite tal cual: se dice en las notas 3 y 4.
- Fuera de la central de pruebas, Iniciar Sesión por GET no está activado (respondería `PIN`); hasta que se decida,
  esa persona no tiene que cambiar nada.
- Qué hacer con el tope de 8000 caracteres si la aplicación solo manda GET: acortar la Nota.
- Un cuerpo de POST que empiece por `p=` responde `PIN`.
- El caso del `Texto` que parece una versión solo pasa si alguna vez no se manda `VersionApp`.
- La primera petición a la central de pruebas dormida: esperar hasta 2 minutos.
- Un ejemplo de Registrar Envío escrito como lo manda su aplicación.

### 4. Lo que se queda, a propósito

- **Los 12 puntos por confirmar.** Siguen abiertos y no describen nada que se haya quitado. La 4a sigue haciendo
  falta por la clave en una central real, y `docs/PROTOCOLO-TEXTO-PLANO.md` la cita.
- **La versión sigue siendo la 0.4**, con fecha 23/11/2026: es la primera 0.4 que se entrega.

## Comprobación

- Ninguna de estas palabras queda en el documento: «invitación», `X-CyP`, «Agregado», «Modificado», «versión 0.2»,
  «versión 0.3», «solo por POST».
- Las líneas de más de 79 caracteres son ejemplos de peticiones y respuestas: las ocho de antes y el ejemplo nuevo.
- En la demo, el 2026-11-23, con una sesión que no existe y la dirección escrita byte a byte: acento o espacio sin
  codificar, HTTP 400 sin cuerpo; codificados, `SNE`; `%ED`, `PIN`; `+`, `SNE`.
- Dos revisores nuevos: uno comparó el documento con el código y con la 0.1; otro lo leyó como quien programa la
  aplicación.
- Ninguna prueba ni código lee el documento (solo dos comentarios lo nombran).

## Para Rardiel (fuera del repositorio)

El mismo documento en su carpeta y el mensaje para mandar ahora.
