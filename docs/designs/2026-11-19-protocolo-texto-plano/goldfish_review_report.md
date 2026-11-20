# Revisión EGM: protocolo de texto plano (CYP 0.1)

Fecha: 2026-11-19. Autor del plan: Claude Code (Fable 5.2). Una etapa, tres revisores nuevos en paralelo, cada uno
con el plan, el contrato y el código: `egm-codebase-details` (exactitud contra el código), `egm-implementation-readiness`
(el plan contra el contrato) y `egm-design` (arquitectura y seguridad).

Aviso que dieron los tres: el código se escribió mientras revisaban, así que leyeron también la implementación.
Sus citas de línea son del árbol de ese momento.

## Veredicto

Ningún fallo de viabilidad ni de autorización. La idempotencia es correcta. El plan había quedado por detrás del
código y un mecanismo escrito en él no protegía (el código ya lo hacía bien). Todo lo de abajo está resuelto.

## Comprobado sin hallazgo

- Extraer `authenticate` y eximir las rutas por `req.routeOptions.url` funciona; `authorizeRequest` corre sobre el
  mismo objeto que se devuelve.
- El ámbito encapsulado recibe en su manejador los errores de los ganchos heredados y del analizador;
  `removeAllContentTypeParsers` no toca la raíz; `/cyp_:cmd` es válida y gana al comodín `GET /*`.
- `app.jwt.verify` lanza el error crudo con `FAST_JWT_EXPIRED`.
- Cotizar y registrar con el mismo `now` no produce `QUOTE_CHANGED`; los Modos 1 y 2 se traducen bien.
- La clave `cyp:{usuario}:{idOperacion}` no choca con `mutate`; las transacciones van en serie; no hay purga.
- `POST /api/envios` da el acceso que se dice para cada rol.

## Hallazgos y qué se hizo

| # | Hallazgo | Resolución |
| --- | --- | --- |
| 1 | El límite de invitaciones equivocadas escrito en el plan (`app.createRateLimit`) no limita: siempre incrementa y una cabecera correcta pasaría aunque la dirección estuviera sobre el límite. La puerta responde antes del límite general. | El código ya llevaba cuenta propia con bloqueo antes de comparar. Plan reescrito (§6) y prueba añadida: la undécima equivocada y la correcta durante el bloqueo responden `DML`. |
| 2 | El `idSesion` es el token completo de la web y puede viajar en la dirección; filtrado, abre toda la API. | Los tokens del protocolo llevan `channel: "cyp"` y la API JSON los rechaza con 401. Probado. |
| 3 | La «ruta equivalente» falla abierta si la tabla de rutas cambia: `authorizeRequest` no lanza en rutas sin mapa. | Además de `authenticate`, cada petición llama a `requireRemittancePermission` con el permiso por su nombre. Pruebas con cuentas personalizadas. |
| 4 | `EIC` puede provocar reintentos sin fin; «otro `DomainError` → `PIN`» muestra textos de la web bajo «parámetros inválidos». | Código nuevo `ORC` para reglas sin código propio (no se repite); mensajes propios para las de configuración; el contrato dice ahora «unos 3 intentos» con `EIC`. |
| 5 | Monto mínimo en Modo 2 responde `INVALID_AMOUNT`, que salía como `PIN` y el contrato promete `MIN`. | `INVALID_AMOUNT` → `MIN`. Prueba en `quote` y en `send`. |
| 6 | Un `Content-Type` presente pero no válido responde 415 antes del analizador `*`. | Gancho `onRequest` del ámbito que fija `text/plain` en todo POST. Probado con `text` y con cabecera vacía. |
| 7 | Caracteres de control o invisibles daban un `PIN` que el contrato no anuncia. | `typedText`: se cambian por un espacio en lo que escribe el usuario. El contrato lo dice. |
| 8 | Un salto de línea en el `idSesion` respondía `SNE`. | `assertOneLine` antes de la sesión: `PIN` con el nombre del parámetro. |
| 9 | `PIN` sin Dato en varios casos; el contrato dice «el Dato dice cuál». | Dato `Parametros` cuando es la petición entera. El contrato lo explica. |
| 10 | `OPERATOR_INACTIVE` salía como `SPE`; `ACCESS_REVOKED` al iniciar sesión llevaba el mensaje de la web, de tú. | `OPERATOR_INACTIVE` → `CBI`; mensaje propio de usted. |
| 11 | `Pagina` mayor que 999 999 respondía `PIN`; el contrato promete lista vacía. `0.00` respondía `MIN` también en `TotalAPagar` y `MontoARecibir`. | Páginas hasta 999 999 999; `MIN` solo para `Monto` (lo demás acaba en `CCA` o `EIS`). |
| 12 | `UNAUTHORIZED` y `RATE_LIMITED` no existen como `DomainError`: mapa muerto. | Quitados. |
| 13 | Exportar `clientInRoute` no hacía falta. | `cyp_send` comprueba los dos clientes con `remittanceClientContact`; `remittances.ts` queda sin tocar. |
| 14 | Faltaban pruebas: regla b (repetir tras cambiar una tasa y cerrar la caja), dos envíos idénticos a la vez, `EIC`, `CBI` con sesión abierta, rol `undefined`, `recs` cerca de la medianoche UTC. | Añadidas. |
| 15 | El contrato decía «todavía no está programado» y no mencionaba la cabecera de la demo. | Contrato al día, con la sección «Central de pruebas». |
| 16 | El contrato describe la búsqueda y quién ve qué en `recs` de menos. | Una línea en cada sitio del contrato. |
| 17 | El plan no tenía fases, la lista de archivos estaba incompleta y dejaba decisiones abiertas. | Plan reescrito tal como quedó construido. |
| 18 | `docs/DEMO-PUBLICA.md` describe la puerta y no decía nada de la cabecera. | Actualizado. |

## No aplicado, y por qué

- **Solo POST** (elimina el token en la dirección): el formato de la otra parte usa GET; el contrato recomienda POST
  y el punto 4 de sus preguntas sigue abierto. El riesgo queda acotado por el hallazgo 2.
- **Clave de invitación aparte para el protocolo**: obligaría a Rardiel a crear otra variable en Render. Se usa el
  mismo código de la web; cambiarlo corta a los dos.
- **Un solo contador para los dos inicios de sesión**: se acepta que entre las dos rutas sean 20 intentos por minuto
  y dirección; unirlos cambiaba el mecanismo de `/api/auth/login`.
- **Prueba con PostgreSQL**: no se pudo ejecutar en la laptop (Docker apagado). El protocolo no añade SQL y guarda
  con las mismas funciones que la API JSON. Queda dicho como no comprobado.

## No comprobado

- Qué registran Render y Cloudflare de las direcciones (por eso el contrato recomienda POST).
- El `|` sin codificar en un GET a través del proxy de Render. Contra un servidor local real (curl) funciona.
- Si la aplicación de la otra parte es nativa. Si corre en un navegador o WebView, CORS le impediría leer las
  respuestas: se pregunta en el mensaje que acompaña al documento.
