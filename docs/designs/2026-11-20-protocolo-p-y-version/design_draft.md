# Protocolo de texto plano 0.4: aceptar `p=` y la versión al final

Plan escrito por Claude Code (Fable 5.2) el 2026-11-20, en la laptop de Rardiel, sobre `main` `37d14e2`. Esta es la
versión corregida después de la revisión (ver `goldfish_review_report.md`); el código y el contrato quedaron así.

## De dónde sale

La aplicación de la otra parte llama así (captura del 2026-11-20): `…/cyp_login?p=Usuario|Clave|3.0`. La central
espera `…/cyp_login?Usuario|Clave`.

Orden de Rardiel del 2026-11-20: «él vino a hablarme y me hizo la pregunta 2 (lo de la p=), yo le respondí que si
se puede hacer en todas. Las preguntas que tienes, primero quiero que reflexiones con la información que hay y que
ha habido para determinar que es lo que debemos hacer».

## Lo que se sabe, y de dónde

1. **El `p=` va en todas las peticiones.** Lo decidió Rardiel y ya se lo dijo a la otra parte.
2. **El contenido lo definimos nosotros; el transporte es el de su aplicación.** En la reunión del 2026-11-19
   (transcripción de máquina, sin cotejar con el audio) dijo «ustedes ponen lo que ustedes quieran», «ustedes tienen
   que hacer un protocolo» y que él manda los datos «con parámetros». Y explicó qué espera del inicio de sesión: un
   código de sesión que después manda en cada petición. La central ya lo da.
3. **Su ejemplo (LSAN 1.14) no muestra el `p=`** en ninguna de sus 39 peticiones, aunque su aplicación lo manda. Es
   una costumbre de su aplicación que el documento no escribe. Las líneas `Res:` de LSAN son `OK|FechayHora|…`, como
   las de CyP, pero su formato general dice `Estado|FechayHora|Versión|Otros Datos`: ver «Lo que queda sin saber».
4. **Comprobado en la demo el 2026-11-20**, ya sin invitación y con usuario y clave falsos:
   `GET /cyp_login?p=…|…|3.0` responde `UCI`. La central lee el usuario como `p=Usuario` y la clave como `Clave|3.0`.
   El `|` sin codificar pasa por Render sin problema.
5. **No se sabe** qué es el `3.0` ni si lo manda en todas las peticiones o solo al iniciar sesión.

Todo lo que le ha fallado ha sido de transporte: la invitación, el POST, el `p=` y el número del final. Las dos
primeras ya están resueltas y publicadas.

## La decisión

Había tres salidas: (a) aceptar solo lo visto (`p=` y el número en Iniciar Sesión); (b) preguntarle antes qué es el
número y dónde lo manda; (c) aceptar su forma de llamar en las siete peticiones.

Se hace (c). La central no usa el número, así que su respuesta a (b) no cambiaría lo que se programa; y con (a),
si lo manda en todas, la siguiente prueba vuelve a fallar y cuesta otra ronda a mano. Lo que cuesta (c) está en
«Lo que cuesta» y va escrito en el contrato.

## Qué se hace

### Fase 1: el código

**`p=` delante de los Parámetros, solo en GET** (`rawParameters`, `app/server/src/text-protocol.ts`):

```ts
const query = url.slice(at + 1);
return decodeURIComponent(query.startsWith("p=") ? query.slice(2) : query);
```

- Se quita antes de decodificar, y solo un `p=` literal y en minúscula justo después del `?`. `?P=…` y `?p%3D…` no
  son el prefijo: se leen como datos.
- Por POST el cuerpo son los Parámetros tal cual. Un cuerpo que empiece por `p=` responde `PIN` (Parametros) con
  «Por POST los datos van tal cual en el cuerpo, sin p= delante»; si no, respondería `UCI` o `SNE` a ciegas.

**El número del final** (`VersionApp` en el contrato):

```ts
const VERSION = /^\d{1,3}(\.\d{1,3}){1,2}$/;
export const isVersion = (value: string) => VERSION.test(value);
const REQUIRED: Record<Exclude<ProtocolCommand, "login">, number> = { logout: 1, clients: 1, client: 2, quote: 4, send: 16, recs: 1 };
export function withoutVersion(command: Exclude<ProtocolCommand, "login">, parts: string[]) {
  return parts.length > REQUIRED[command] && isVersion(parts[parts.length - 1]) ? parts.slice(0, -1) : parts;
}
```

- Casa `3.0`, `1.14`, `10.2.1`. No casa un teléfono con puntos (`809.555.0100`), que hoy se puede buscar.
- Es siempre un dato de más: se quita solo si la petición ya tiene sus datos obligatorios. Así un importe en último
  lugar (`/cyp_quote?idSesion|USD|DOP|100.00`) sigue siendo el importe, y en Registrar Envío solo puede ser el dato 17.
- `answer` (`text-protocol-routes.ts`) llama a `withoutVersion` justo después de partir por `|` y antes de
  `assertOneLine` y de leer los datos. La central no usa el número.
- `send` deja de recibir el texto crudo: la huella del `idOperacion` es `parts.slice(1).join("|")`, ya sin el número.
  Sin número es el mismo texto que antes, así que las operaciones guardadas siguen valiendo.

**Iniciar Sesión** (`login`, `text-protocol-routes.ts`): la clave puede llevar `|`, así que `Usuario|Clave|3.0` tiene
dos lecturas. Se prueban las dos, primero sin el último dato.

```ts
const email = raw.slice(0, at), rest = raw.slice(at + 1), cut = rest.lastIndexOf("|");
const versioned = cut >= 0 && isVersion(rest.slice(cut + 1));
if (versioned && cut === 0) throw missing("Clave");
for (const password of versioned ? [rest.slice(0, cut), rest] : [rest]) { … }
```

- Cada lectura pasa por la misma validación y el mismo `signIn`. Solo se pasa a la segunda si la primera dio
  `INVALID_CREDENTIALS`; `ACCESS_REVOKED` y los demás errores salen a la primera.
- Si la segunda lectura no pasa la validación (más de 200 caracteres), la respuesta es la `UCI` de la primera.
- `Usuario||3.0` responde `PIN` (Clave), como `Usuario|`.
- Cada petición sigue contando una vez en el límite de 10 por minuto; una petición con número puede comprobar dos
  claves, la que se mandó y esa misma con `|3.0`.

### Fase 2: el contrato y las notas

`docs/protocolo-cyp/Protocolo CYP 0.3.txt` pasa a `Protocolo CYP 0.4.txt`:

- Cabecera y «Esta es la versión 0.4».
- Notas Generales, 1): la forma `url/cyp_cmd?p=Parámetros|VersionApp`; qué es `p=`; qué es `VersionApp` («El número
  que su aplicación pone al final (hoy, 3.0). No es la versión de este documento…»); su forma; que va siempre el
  último; que un importe no se confunde con él; el caso del `Texto` que es solo un número con punto y su salida
  (`/cyp_clients?idSesion|3.0|1`); y que las «Pet:» no repiten ni `p=` ni `VersionApp`.
- Notas Generales, 2) y 3): «después del ? (o después de ?p=)»; una letra con acento o un espacio sin codificar hacen
  que el servidor rechace la dirección (HTTP 400).
- 1.1 Iniciar Sesión: la petición como la manda su aplicación y las dos lecturas de la Clave.
- 3.2 Registrar Envío: `VersionApp` es el dato 17; con 15 datos y `VersionApp` la central la tomaría por la Nota;
  «los mismos datos» no cuenta `VersionApp`.
- Códigos de error: `VersionApp` al final no cuenta como dato de más.
- «Agregado» y «Modificado»: entradas de la 0.4. Pregunta 2 del final, rehecha.

`docs/PROTOCOLO-TEXTO-PLANO.md`: título y enlaces a la 0.4; apartado de `p=` y la versión con lo que cuesta; la
huella sin la versión; «20 peticiones de clave (hasta 30 comprobaciones)»; apartado nuevo «Lo que se sabe de la
aplicación de la otra parte»; y en «Antes de producción», que su aplicación entra por GET y fuera del modo demo eso
responde `PIN`. `docs/API_CONTRACTS.md`: el enlace.

## Lo que cuesta

- Un `Texto` que sea solo un número con punto (`3.0`) y vaya el último se toma por el número: la búsqueda saldría sin
  texto. Salida escrita en el contrato: mandar también la `Pagina`.
- `Modo`, `Pagina`, `Lado` o `idEstado` escritos `2.0` al final dejan de responder `PIN` y se toman por el número.
- Registrar Envío con 15 datos y el número guarda el número como `Nota` (antes, `PIN`). Se ve al integrar.
- Una `Nota` con un pipe sin limpiar que termine en `|2.5` pierde ese final (antes, `PIN`).
- Ningún importe puede registrarse distinto: se exigen los 16 datos y la central vuelve a cotizar.

## Lo que queda sin saber

- **Qué es el `3.0`.** No hace falta para que funcione; la pregunta 2 del contrato lo pregunta.
- **Si su aplicación espera una Versión en las respuestas**, en tercer lugar, como dice el formato general de LSAN.
  No se cambia nada: ningún ejemplo de LSAN la trae. Si lee mal el `idSesion`, es lo primero que hay que mirar.
- **Cómo codifica acentos y espacios.** Caracterizado contra un servidor local: en UTF-8 con `%` funciona; sin
  codificar, Node responde 400; `%ED` (Latin-1) responde `PIN`; `+` es un signo de más.

## Archivos

| Archivo | Qué |
| --- | --- |
| `app/server/src/text-protocol.ts` | `p=` en `rawParameters`; `isVersion`, `REQUIRED` y `withoutVersion` |
| `app/server/src/text-protocol-routes.ts` | `answer` quita el número; `login` prueba las dos lecturas; la huella de `send` |
| `app/server/test/text-protocol.test.ts`, `text-protocol-format.test.ts` | Seis pruebas nuevas y una cuenta nueva |
| `docs/protocolo-cyp/Protocolo CYP 0.3.txt` → `0.4.txt` | Renombrado y modificado |
| `docs/PROTOCOLO-TEXTO-PLANO.md`, `docs/API_CONTRACTS.md` | Modificados |

Sin migración. No cambian las respuestas, la API JSON ni la web.

## Lo que no se hace

- **`p=` en POST.** Su aplicación usa GET; se rechaza con un mensaje que lo dice.
- **Usar el número** (rechazar aplicaciones viejas, devolver una versión). No se sabe qué significa para ellos.
- **Tratar `+` como espacio.** La regla escrita sigue; el contrato lo avisa.
- **Aceptar la clave por GET fuera del modo demo.** Sigue siendo decisión de Rardiel («Antes de producción»).

## Pruebas

- Formato (`text-protocol-format.test.ts`): `rawParameters` con `p=`, `P=`, `p%3D`, `&` como dato y `p=` en un
  cuerpo; `isVersion` y `withoutVersion` con la tabla de casos.
- Iniciar Sesión: `p=Usuario|Clave|3.0`, sin número, con una clave con pipes, una cuenta cuya clave termina en
  `|2.5` (con y sin número detrás), `Usuario||3.0`, clave mala con número (`UCI`) y clave mala de 198 caracteres con
  número (`UCI`, no `PIN`).
- Las otras peticiones con `p=` y con número; Registrar Envío con los dos, repetido sin ellos y por POST (el mismo
  envío); `Nota` `150.00` se guarda; 15 datos y número guardan el número como `Nota`.
- Toda la suite del servidor, el cobrador, tipos de los tres paquetes y `pnpm build`.
- Por HTTP real contra un servidor local, con su formato exacto.
- Después de publicar, en la demo, con usuario y clave falsos: `GET /cyp_login?p=x|y|3.0` debe seguir dando `UCI`
  (ya solo porque la clave es mala) y `GET /cyp_clients?p=abc|x|3.0` debe dar `SNE`.

## Para Rardiel (fuera del repositorio)

`Protocolo CYP 0.4.txt` en su carpeta, la 0.3 a `anteriores/`, y el mensaje 4 rehecho: «su forma de llamar ya
funciona», sin preguntas nuevas.
