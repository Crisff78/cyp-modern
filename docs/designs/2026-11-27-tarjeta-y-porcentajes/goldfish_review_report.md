# Revisión EGM del plan: tarjeta y porcentajes (protocolo 0.13)

Una etapa con dos revisores nuevos sobre el primer borrador de `design_draft.md` (2026-11-27):
`egm-codebase-details` (el plan contra el código) y `egm-zoom-out` (alcance). Los hallazgos los resolvió Claude Code
(Opus 5.5).

## Bloqueante (los dos revisores)

- **Las peticiones de 16 datos se habrían roto.** El borrador decía que, con `REQUIRED` en 16, una petición de antes
  seguía igual. Pero `namedParameters` exige exactamente tantos datos como nombres. Con tres nombres más, toda petición
  de 16 datos daba `PIN`.
  - **Resuelto:** se aceptan 16 o 19 datos, y 17 o 18 dan `PIN`.
  - La `VersionApp` va de dato 17 o 20.
  - Pruebas para 16, 16 con `3.0`, 17, 18 y 19 con `3.0`.

## Menores, todos resueltos

- **`RecargoTarjeta` en la respuesta de Registrar Envío** se contradecía y se podía calcular. Además, las respuestas
  guardadas antes saldrían con otro número de datos (los dos revisores). **Quitado:** la respuesta conserva sus 10 datos
  y solo su `TotalAPagar` lleva el recargo con crédito.
- **El código nuevo `TEC`** (zoom-out). La aplicación no puede saber de antemano si el archivo está activado. **Resuelto:**
  `ORC` con su mensaje.
- **El control del archivo antes de buscar el `idOperacion`** rompería la repetición de un envío ya registrado (los dos).
  **Resuelto:** va después, como `CCA`.
- **La misma regla escrita dos veces**, en la web y en el protocolo (zoom-out). **Resuelto:** una función compartida,
  `cardArchiveApplies`, en `payment.mjs`.
- **`cardPaymentCharge` lanza `PaymentValidationError`** y el protocolo lo convertiría en `EIC`, aun en efectivo
  (codebase-details). **Resuelto:** en Cotizar, `PIN` con `Monto`.
- **El rechazo de la base de datos al pago con tarjeta** daría `EIC`, y la aplicación lo repetiría (codebase-details).
  **Resuelto:** `ORC`.
- **El titular pasaba por `typedText`**, que cambia los caracteres invisibles por espacios; la web lo valida tal como
  llega (codebase-details). **Resuelto:** se valida tal como llega. El contrato dice que el espacio va como `%20`.
- **Faltaba la prueba con la caja cerrada** y su nota (codebase-details). **Añadidas.**
- **Frases del contrato que dejan de ser ciertas** (los dos). Son el `TotalAPagar` y el Modo 1 de Cotizar, y «significan
  lo mismo» en la respuesta de Registrar Envío. **Añadidas al plan.**
- **Valores inventados**: `idTipoTarjeta` y `fees` (zoom-out). **Resuelto:** van a las preguntas 6 y 1.
- **Datos de tarjeta** (zoom-out). **Resuelto en el contrato:**
  - el número completo, el vencimiento y el CVV no van en ningún dato;
  - para pagos con tarjeta se recomienda POST;
  - ninguna respuesta devuelve el titular ni los 4 dígitos.
- **La huella, en forma canónica** (codebase-details). **Resuelto:** los 16 primeros datos, más los de tarjeta solo si
  alguno trae algo.

## Sin objeción

- El alcance: solo las dos cosas.
- El `TotalAPagar` con el recargo dentro.
- Que se usen `cardPaymentCharge` y `getCommissionPolicy`.
- `cardArchiveRequired`.
- El cálculo del recargo coincide con el de `createRemittance`, también en el redondeo.
- Nada se salta frente a la web: permisos, caja, cancelación y devolución.
