# Comprobación en el puesto de trabajo

La aplicación ya ofrece el login compatible con el gestor de contraseñas del
navegador y la impresión de recibos. Estas comprobaciones requieren el perfil
habitual y la salida física; no se certifican con pruebas automatizadas. No hay
restricciones por marca de navegador o impresora: se usan formularios HTML,
autocomplete, FormData y window.print(). El usuario elige el dispositivo en el
diálogo nativo de impresión.

## Guardado de contraseña

1. Abrir CyP en el navegador habitual, fuera de modo privado. Mantener la misma
   dirección de acceso: localhost y 127.0.0.1 son sitios distintos para el gestor.
2. Comprobar en la configuración del navegador que está habilitada la opción de
   ofrecer guardar contraseñas y que CyP no figura entre los sitios excluidos.
3. Elegir el acceso e iniciar sesión. El usuario introduce personalmente sus
   credenciales; no deben compartirse, capturarse ni registrarse en una prueba.
4. Aceptar «Guardar» si el navegador lo ofrece. Cerrar sesión y regresar al login:
   verificar que propone la cuenta y completa la contraseña al autorizarlo.
5. Repetir en la terminal del cobrador si se utiliza allí. Cada origen/perfil
   conserva sus propias decisiones de guardado.

Los inputs llevan nombre, identificador y autocomplete apropiados. CyP no guarda
la contraseña en localStorage ni sustituye al gestor del navegador. Que aparezca
el botón de mostrar contraseña no acredita que el navegador la haya guardado.
Al enviar se leen los valores actuales del formulario, incluidos los completados
sin eventos de escritura. Los cambios de visibilidad no reemplazan esos valores
por un estado anterior de React. Se conservan validaciones, límites y roles.

## Impresión física

Usar un recibo ficticio de un entorno de prueba aislado; no crear una operación
real únicamente para probar la impresora.

1. Abrir la vista de impresión del recibo y verificar importe, moneda, comisión,
   detalle y referencia antes de imprimir.
2. Seleccionar «Papel de la impresora (A4 / Carta / otro)» o un ancho térmico de
   58/80 mm en el recibo. Elegir la impresora habitual y el mismo papel en el
   diálogo del navegador; para probar salida física, no elegir «Guardar como PDF».
3. Imprimir una copia. Revisar que sale físicamente, sin cortes de texto, con
   importes legibles y márgenes adecuados. Para una impresora A4, ajustar al papel
   de ese dispositivo en vez de declarar comprobado un rollo térmico.
4. Anotar navegador, modelo, papel y resultado. La cola del sistema o el archivo
   PDF por sí solos no prueban que salió ni que se lee correctamente.

Los recibos administrativos se separan por páginas, ocultan el escritorio y sus
controles al imprimir y permiten ajustar el ancho. No se envían trabajos a una
cola ni se elige una impresora silenciosamente. ESC/POS sigue siendo una
exportación opcional para equipos compatibles; requiere elegir 58 u 80 mm y un
puente de impresión. La impresión estándar no depende de ESC/POS.

No se certificó salida física en una impresora durante estas pruebas.

## Porcentaje comercial del gestor

La regla de reparto está implementada: el gestor recibe su porcentaje del monto
final en moneda de destino y la empresa recibe el resto de la comisión total.
Gerencia debe indicar el porcentaje real; RRAA no proporciona ese dato.

El administrador lo configura en Remesas → Tasas → Reparto de comisiones. El
valor inicial es 0%; no equivale a una tasa comercial aprobada. Los cambios se
aplican a nuevas remesas y las anteriores conservan el reparto guardado. Las
canceladas no incrementan el saldo vigente del gestor.

Gerencia confirmó que todavía no ha definido el porcentaje: se conserva 0% y se
actualizará desde este panel cuando comunique el valor. No se cambian saldos ni
repartos anteriores para anticipar esa decisión.
