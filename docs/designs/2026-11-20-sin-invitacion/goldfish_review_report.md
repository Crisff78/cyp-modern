# Revisión EGM del plan y cómo se resolvió

Dos revisores nuevos leyeron el plan y el código el 2026-11-20, antes de programar: `egm-codebase-details` (que no
quedara nada colgando y qué queda a la vista) y `egm-design` (la decisión y el riesgo). Los dos dan por buena la
eliminación; los dos marcaron como bloqueante que el aviso a Rardiel estaba incompleto. Lo que sigue es lo que
señalaron y qué se hizo; lo escribe Claude Code (Fable 5.2).

## Aplicado

| # | Hallazgo | Qué se hizo |
| --- | --- | --- |
| 1 | El aviso se quedaba corto. Los códigos reales de estación se ven **sin iniciar sesión** (`GET /api/auth/estaciones` devuelve el nombre, que es el código); el plan decía que solo los veía Administración. | Reescrito «Lo que queda a la vista», con lo que se ve sin sesión y lo que puede hacer Administración. |
| 2 | La clave de la demo no está solo en el README: va en otros documentos, en el código y dentro del paquete que la demo sirve. Hacer privado el repositorio no la taparía. | Comprobado en los dos paquetes compilados y escrito en el plan. Se retira esa mitigación. |
| 3 | Administración no solo ve: consulta RRAA en vivo, cambia claves, desactiva cuentas e inactiva estaciones. Un extraño podría dejar fuera al equipo. | Escrito en el plan y en `docs/DEMO-PUBLICA.md`. |
| 4 | El aviso tenía que ser un paso antes de publicar, no una nota. | El plan lo dice; va arriba del todo en el PR y en el mensaje a Rardiel, con una salida que no frena a nadie: cambiar la clave de Administración desde la propia demo antes de fusionar el PR de la demo. |
| 5 | Faltaba citar dónde está la regla de RRAA. | AGENTS.md de CyP: «Los datos de RRAA nunca van a Git ni se muestran sin tapar». |
| 6 | `publicOrigin` no podía pasarse siempre: una instalación normal añadiría su dirección local a los orígenes de las instalaciones de estaciones. | `publicOrigin?: string` en la configuración; `index.ts` lo pasa solo en modo público. |
| 7 | «`demo-access.test.ts` prueba solo la puerta» era falso: era la única prueba de la ruta codificada `/%61pi/snapshot`, de la política de contenido en modo público, de `Referrer-Policy` y del inicio de sesión con la web montada. | Todo eso pasa a `public-demo.test.ts`. |
| 8 | «`/demo-access` ya no existe» no decía qué responde. En la demo cae en el comodín y sirve el programa; sin la web montada, el `preHandler` responde 401. | La prueba monta la web y fija lo esperado: GET sin redirección, `POST` 401 o 404 sin cookie, el guion 404. |
| 9 | El ayudante `open()` de las pruebas del protocolo y sus dos usos no estaban en el plan. | `open(state, publicWeb = false, demo = true)`. |
| 10 | Documentos solo «modificar», sin líneas; faltaban `docs/LIMITE-POR-VISITANTE.md` y el comentario de `text-protocol-routes.ts`. En el contrato faltaban la frase «Esta es la versión 0.2» y el texto de la entrada 0.3. | Hechos y listados en el plan. |
| 11 | «Borre `DEMO_ACCESS_CODE` de Render» rompería una vuelta atrás: la versión anterior no arranca sin ella. | Ahora dice que se quede hasta dar por buena la publicación. |
| 12 | «Después de fusionar» no decía que la demo publica la rama `codex/public-browser-demo`. | Añadido. |
| 13 | `noindex` basta contra buscadores; un `robots.txt` lo estropearía. Probar la cabecera en página, archivo, API, `/cyp_*` y 404. | Sin `robots.txt`; la prueba cubre los cinco casos. |
| 14 | La 0.3 debía decirle a la otra parte que no tiene que cambiar nada. | En «Modificado» y en el apartado 9. |

## No aplicado, y por qué

- **Meter por defecto una mitigación en el código** (clave de la demo en una variable de Render, ocultar los nombres
  de estación antes de entrar). Rardiel pidió quitar la invitación y dijo que la seguridad de la demo no importa
  ahora; añadir protecciones sería decidir por él. Hay una salida sin código (cambiar la clave de Administración) y
  se le propone. Lo de la lista de estaciones queda como decisión suya.
- **Comprobar antes, en solo lectura, si la demo usa el RRAA real.** No se puede desde fuera: la invitación lo tapa
  hoy, y la IA no escribe el código. Consta la decisión de octubre de validar la demo con el RRAA real.
- **No abrir el PR de la demo hasta tener un «sí» escrito.** Los dos PR se abren juntos, como siempre; el de la demo
  lo fusiona Rardiel, que es quien publica, con el aviso delante.

## Sin hallazgo

- Borrar el módulo y no dejar un interruptor es la lectura correcta de la orden.
- No queda ninguna referencia a la puerta en clientes, service worker, `.env.example` ni CI. `INVITATION_HEADER` e
  `isTextProtocolPath` solo los usaba la puerta.
- El lector `application/x-www-form-urlencoded` solo lo usaba `/demo-access`; `/cyp_*` tiene el suyo.
- El servidor arranca con `DEMO_ACCESS_CODE` puesta o sin ella.
- Pasar a la 0.3 ahora es correcto: esperar dejaría la central y el contrato en desacuerdo.
