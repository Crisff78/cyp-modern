# Recibos térmicos: acentos y separación

La 2connet **2C-POS80-01-V6 USB** usa rollo de **80 mm (3 pulgadas)** y resolución de **203 dpi**, según su [ficha oficial](https://www.2connet.com/es/producto.php?id=103166). No corresponde seleccionar 76 mm para ese modelo.

## Para probar

1. Recargar CyP y abrir de nuevo el comprobante. Una ventana de impresión que ya estaba abierta conserva su versión anterior.
2. Seleccionar **Térmico 3 pulgadas (80 mm)** en CyP y papel de **80 mm** en el diálogo nativo de impresión. Usar tamaño real / 100%.
3. Usar el controlador oficial del fabricante para la V6 USB, disponible en su [página de descargas](https://www.2connet.com/es/descargas.php). Si Windows tiene «Generic / Text Only» o «Genérico / Solo texto», el administrador del equipo debe instalar/configurar el controlador gráfico oficial. La aplicación no puede sustituirlo desde el navegador.
4. Verificar en papel: «Código de operación», «Envío», «Identificación», «Dirección», nombres con tildes/ñ, separación de importes, devuelta y pie completo. Comprobar que los importes coincidan con el comprobante guardado.

## Qué cambió

- Los recibos térmicos se dibujan localmente como imágenes PNG a ocho puntos por milímetro. Los caracteres se convierten en píxeles en el navegador; no dependen de las fuentes residentes o la tabla de caracteres del equipo de impresión cuando se usa su controlador gráfico.
- Etiquetas y valores tienen separación real. Direcciones, referencias largas y notas se ajustan al ancho; los bloques cortos permiten saltos de página entre filas sin reducir todo un recibo largo a una sola hoja.
- Se mantiene la alineación izquierda. En rollo de 80 mm se reservan márgenes de 4 mm y 72 mm de contenido (576 puntos); 76 mm usa 70 mm de contenido y 58 mm usa 48 mm.
- El formato Carta/A4 conserva texto seleccionable. El diálogo de impresión sigue siendo el del navegador y sistema operativo. No se usa WebUSB ni un servicio externo de impresión.
- Las imágenes se preparan en memoria y no se envían a terceros ni se guardan en el navegador. Se utiliza el mismo contenido autorizado del comprobante, sin agregar ganancias internas ni datos completos de tarjetas.

## Límites de la comprobación

Las pruebas de navegador verifican caracteres españoles dibujados, imágenes decodificadas antes de imprimir, espacios entre campos, ajuste de líneas, alineación, varios anchos y fallo seguro si no se puede preparar la imagen. También se prueba el recorrido real desde Administración y la PWA con datos ficticios. Estas pruebas no acreditan una impresión física en la 2connet del usuario.

Un controlador de solo texto no imprime gráficos; por eso debe corregirse su configuración si es el que está instalado. Véase la [explicación del fabricante OKI sobre el controlador genérico de Windows](https://okiprinting-en-us.custhelp.com/app/answers/detail/a_id/676/~/using-generic-driver-in-windows-for-printer-fonts). No se diagnostica aquí el controlador realmente instalado: el usuario confirmó que la vista previa es correcta y el papel sale mal, pero no se inspeccionó ese equipo.
