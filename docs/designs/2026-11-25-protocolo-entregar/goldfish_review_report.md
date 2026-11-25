# Revisión EGM del plan: entregar un envío desde la aplicación (protocolo 0.7)

Dos revisores nuevos sobre la primera versión del plan, el 2026-11-25: `egm-codebase-details` y `egm-design`. Resolución
de Claude Code (Fable 5.2). La primera versión no tenía `idOperacion` en `cyp_pay` y respondía `OK` a cualquier
repetición de quien ya había entregado.

## Bloqueantes

- **El `OK` de una repetición no se distinguía del `OK` de una entrega nueva** (los dos revisores). La caja estaba a
  salvo, el efectivo no: con una lista vieja, o si la persona volvía otro día, el usuario veía `OK` y pagaba otra vez.
  Era un retroceso frente a la web, que exige `Idempotency-Key`. Resuelto: `cyp_pay` lleva `idOperacion`, como
  Registrar Envío. El mismo con los mismos datos devuelve la respuesta guardada; otro sobre un envío ya entregado es
  `ENP` con Dato 1; el mismo con otros datos, o uno usado para registrar un envío, es `OPD`. Probado en los dos sentidos.
- **`ENP` no le llegaba al Cajero cuando otro ya había entregado o el envío estaba cancelado: recibía `ENE`**, porque
  deja de ver ese envío. Resuelto: `deliverableByReference` (`remittances.ts`) devuelve el envío si la cuenta lo ve o lo
  vería estando pendiente; solo entonces el adaptador responde `ENP` con el `idEstado`. Prueba con dos Cajeros y con un
  cancelado.

## Importantes

- **El orden prometido no salía de llamar a `payRemittance`.** Resuelto: el adaptador busca por `NumEnvio` y decide
  `ENE`, `MNC` y `ENP`; `TRANSFER_NOT_FOUND`, `TRANSFER_NOT_PENDING` e `INSUFFICIENT_CASH` entran en el mapa de códigos;
  `FORBIDDEN` se traduce a `CFR` solo alrededor de `payRemittance`, para que una falta de permiso siga siendo `SPE`. El
  plan y el contrato escriben el orden real, que empieza por sesión, permiso y formato. La cabecera de
  `text-protocol-routes.ts` ya no dice que el protocolo solo tenga de propio el `idCliente`.
- **Los permisos de `answer()` eran de dos ramas.** Resuelto: tabla `ACCESS` por comando (ruta equivalente y permiso por
  nombre). Dentro de la transacción de `pay` van `currentAccessUser`, `authorizeRequest` y
  `requireRemittancePermission`, como en `send`.
- **`REQUIRED` no estaba en el plan.** Resuelto: `pay: 4` y `pend: 1`; casos nuevos en `text-protocol-format.test.ts`
  (`980.00` al final de `pay` sigue siendo el importe). El contrato avisa del `Texto` con forma de versión también en
  Envíos por Entregar y dice que en `pay` van siempre los 4 datos.
- **Pruebas que se rompían con el sexto dato del inicio de sesión** (nueve aserciones). Actualizadas, y también la del
  registro, que pasa de 19 a 20 datos. La tabla de archivos del plan las nombra.
- **`CFR` y `CNA` reutilizados dejaban falso el contrato.** Resuelto: en `pay`, `CFR` lleva el `idCliente` del
  destinatario y `CNA` y `CSF` llevan mensaje y Dato con la moneda de destino; el contrato los redefine.
- **Frases del contrato que dejaban de ser ciertas** («siete peticiones», «la única petición que mueve dinero»,
  `DatosUsuario` de cinco datos, listados, qué códigos traen Dato, qué repetir, pasos, índice, «No incluido», pregunta 1).
  Corregidas una por una. Las marcas `(NUEVO)` de la 0.6 se quitan y «Lo nuevo de esta versión» dice en una frase qué
  trajo la 0.6, porque no consta que la otra parte la recibiera.
- **A la aplicación le faltaba con qué identificar a quien recibe.** Resuelto: dato 20 del registro, la identificación
  del destinatario tomada de la copia del envío.
- **El orden entregar-confirmar.** La web dice «Confirma después de entregar el dinero». Resuelto en el contrato: se
  pide Entregar y el dinero se da solo con el `OK`; el `OK` se guarda como comprobante.
- **Entregar por GET.** Aceptado en la central de pruebas, como el resto. No se hizo un interruptor ni un límite propio:
  anotado en «Antes de producción», con el alcance real (un `idSesion` de Cajero alcanza a todos los pendientes) y que
  dejar `pay` solo por POST no lo cierra.

## Menores

- `MNC` se compara con `payoutOf`, no con `receiveAmount`: dicho en el plan y probado con cargo de entrega.
- Mensajes propios para `ENE`, `ENP`, `MNC`, `CSF` y para el `RNE` de `pend`.
- `PuedeEntregar` es `can(POST /api/envios/x/pagar)`; Supervisión tiene 0 y sí puede listar: dicho en el contrato.
- La búsqueda de `pend` no es la de la web: dicho en el plan; el contrato dice que la identificación se encuentra con o
  sin guiones y que los envíos antiguos se encuentran solo por sus números.
- `env00000001` o un número mal formado es `PIN`; uno bien formado que no existe, `ENE`. Probado.
- A `recordMutationTrace` se le pasa el envío. La repetición no deja traza: anotado.
- «No incluido» nombra el recibo de quien recibe y ver lo ya entregado.
- Una cuenta con permisos adicionales puede ver otros envíos: dicho en 5.1.
- El nombre `pay` se queda (es la palabra de la orden); no se cambió a `deliver`.

## Aceptado sin hacer

- **La demo no queda probada para entregar.** Una entrega allí no se deshace y mueve la caja de la cuenta con la que
  prueba la otra parte. Se probó en local con PostgreSQL. Para que la otra parte pueda entregar en la demo, ese día
  tiene que abrir su Caja de Remesas en la moneda de destino, con fondos, desde la web: va en el mensaje para ella.
- El estado de las cajas en `pend` o en otra petición, y «mis entregas de hoy»: quedan en «Antes de producción».
- La central no guarda qué documento enseñó quien recibió: anotado.
- Si se entrega un envío entre dos páginas de `pend`, la siguiente se salta una fila: anotado.
- Observación fuera de alcance, sin comprobar: el diálogo de la web enseña `receiveAmount` y la lista `payoutOf`.

## No comprobado por los revisores

Si la aplicación de la otra parte puede mandar POST; si el proxy de la plataforma guarda direcciones; el comportamiento
con dos `pay` simultáneos (las transacciones del almacén van en serie; no se probó con carga).
