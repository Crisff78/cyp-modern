# Un solo teléfono (29-10-2026)

Pedido de Rardiel: «Aquí se supone que telefono y celular es lo mismo, así que siempre deja telefono y quita celular de todos lados».

## Qué se ve

- En toda la aplicación sale **Teléfono** y ya no sale **Celular**.
- Clientes:
  - la ficha tiene un solo campo, Teléfono;
  - el listado tiene una sola columna, Teléfono.
- Solicitudes de autorización: una sola columna Teléfono, y un solo campo en la ventana.
- Envíos de dinero: los datos del remitente y del destinatario, y el detalle del envío, muestran solo Teléfono.
- Cobradores: el número del cobrador se llama Teléfono en la ficha, en el listado y en Entregas de dinero («Teléfono del cobrador»).

## Qué pasa con los números guardados

- No se borra nada de la base de datos. El campo `cellular` sigue existiendo y la API no cambia.
- Si una ficha tiene el teléfono vacío y el celular lleno, se muestra ese número como Teléfono. Al guardar, queda en los dos.
- Al cambiar o borrar el Teléfono de un cliente, el número viejo del celular se sustituye por el nuevo, para que no vuelva a salir.
- Si no se toca el Teléfono, los números guardados quedan como estaban.
- La búsqueda sigue encontrando a un cliente por cualquiera de sus números guardados.
- Al dar de alta un cliente nuevo, el teléfono se sigue guardando también como celular.
