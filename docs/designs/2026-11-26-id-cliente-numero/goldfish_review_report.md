# Revisión EGM del plan: el `idCliente` como número entero (protocolo 0.8)

Dos revisores nuevos sobre la primera versión del plan, el 2026-11-26: `egm-codebase-details` y `egm-design`. Resolución
de Claude Code (Opus 5.5).

## Bloqueantes

- **El contrato prometía un entero que las reglas no siempre daban** (los dos). Con números repetidos salía la `INT`, y
  sin identificación interna, el `id` largo. Resuelto: el número está garantizado por cómo se crean los datos (la
  identificación interna solo la genera la central con una secuencia única y no se puede cambiar; ningún `id` es solo
  cifras; en la demo todos los clientes tienen identificación interna). Los casos de respaldo quedan solo para datos que
  hoy no pueden existir, y `taken` impide además un número igual a un `id`. Fuera de la demo, que todos los clientes
  tengan identificación interna pasa a ser requisito en «Antes de producción». El contrato da el máximo de cifras y dice
  cómo guardarlo.
- **La lectura del pedido no estaba confirmada** (diseño): donde la 0.7 hace mandar la cédula es al entregar, y eso
  cambiar la forma del id no lo arreglaba. Resuelto: `cyp_pend` acepta un cuarto dato, `idDestinatario`, y el contrato
  cambia el paso de la entrega para usarlo. La cédula queda para comprobar a quién se entrega. Lo de «varios registros»
  se explica en el contrato (un registro por envío). No se pudo pedir la petición exacta: el mensaje para la otra parte
  se la pide si era otra cosa.

## Importantes

- **Mirar primero el `id` haría que un número ya guardado pasara en silencio a otro cliente.** Resuelto: primero el
  número y, solo si no es de nadie, el `id`.
- **El mapa de salida con todos los clientes.** Resuelto: `clientIds` usa todos (inactivos y de otras rutas).
- **El número como texto, no con `Number`.** Resuelto: se quitan los ceros como texto; `INT00000000` sale `0`.
- **La respuesta guardada de `pay` traería la `INT` al repetir.** Resuelto: la repetición vuelve a armar el registro con
  el `idCliente` de hoy. Probado alterando el texto guardado.
- **`taken` no miraba la forma numérica.** Resuelto en `client-identities.ts`, con prueba.
- **La web copia la `INT` en la cédula** al crear un cliente sin cédula. Anotado en el plan y en el documento interno; en
  la demo no hay ninguno (comprobado por la forma de las 25 cédulas).
- **Sin la `INT`, un número equivocado cae en otro cliente.** Resuelto en parte: el contrato pone el ejemplo del Codigo
  (`CLI00000012` no es el `idCliente` 12). No se añaden datos a la respuesta de Registrar Envío.
- **Frases del contrato que quedaban falsas** (formato, descripción, puntos 5 y 3, el c de 3.2, 4.1, pasos, «Lo nuevo»,
  preguntas 7 y 11, ejemplos). Corregidas. Las cédulas repetidas fuera de la demo van a «Antes de producción».
- **Archivos que faltaban en la tabla** (`text-protocol.ts`, `client-identities.ts`) y las marcas de cada fila. Puestos.

## Menores

- `0031`: solo se acepta el número tal como sale; con ceros delante se busca como `id`. Así no hay otra huella posible.
- El Dato de `CFR` al entregar es la forma de salida, no el texto que llegó: dicho así en el plan.
- La palabra «Identificación interna» de la web no va en el contrato: va en el mensaje para Rardiel.
- La otra parte tiene la 0.7 (Rardiel, 2026-11-25): el documento interno, que decía la 0.6, se corrige.
- La transcripción no va al repositorio: es público y los audios de las reuniones no salen de la laptop. El plan dice
  dónde está.
- Un número ambiguo responde «Cliente no encontrado»: aceptado, porque hoy no puede pasar.
- `cyp_pend` con `31` en `Texto` encuentra los `ENV/REC…31`: el contrato dice que para un destinatario se use
  `idDestinatario`.

## No comprobado por los revisores

El audio y la transcripción; el tipo del `idCliente` del sistema viejo y de la aplicación de la otra parte; si ella ve
la web; los datos de la demo (los midió Claude, con `cob` y solo leyendo).
