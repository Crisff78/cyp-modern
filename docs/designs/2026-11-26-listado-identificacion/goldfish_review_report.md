# Revisión EGM del plan: la identificación en el Listado de Clientes (protocolo 0.10)

Un revisor nuevo, `egm-codebase-details`, el 2026-11-26 (cambio pequeño: una sola etapa). Sin bloqueantes. Resolución de
Claude Code (Opus 5.5).

## Importantes

- **La `INT` copiada seguía en el dato 20 de los envíos.** Resuelto: `identityOf` vale también ahí, comparada con la
  identificación interna del destinatario.
- **Frases del contrato que quedaban falsas:** los pasos, «Para qué sirve» de 2.1, `ClienteX` y la definición de
  Identificacion, el punto 2, el ejemplo, «Lo nuevo», la Identificacion de 2.2 y la del dato 20. Corregidas.

## Menores

- **El patrón `INT` podía ocultar un documento real** (`INT12345678` es válido). Resuelto: solo se vacía cuando es igual
  a la identificación interna del mismo cliente. Probado.
- **La copia de la web ocurre solo al pulsar «Generar identificación»** en un cliente nuevo sin cédula: dicho así.
- **Pruebas que se rompían** (paginado, `sep`, Zoilo, Zulema, `cli-2`): actualizadas a 6 datos.
- **Un Cobrador con `Lado` 1 recibe cédulas de otras rutas:** anotado en «Antes de producción».
- Comentarios con el nombre del archivo 0.9 y la descripción de `listRemittanceClients`: al día.
- La demo no tiene clientes con la `INT` copiada: el vaciado solo lo cubren las pruebas.
