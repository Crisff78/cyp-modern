# Integración de las ramas de CyP

La integración conserva las correcciones de `331c4a7` y los ajustes de presentación
de `main` en `9e41696`. Se mantienen la paleta corporativa, los encabezados con
degradado y los estilos de filtros, tablas y diálogos. Descargos Recurrentes sigue
oculto mediante el interruptor reversible existente.

Cuadres Diarios conserva el cálculo y cierre persistidos de `ConnectedSettlements`,
con jornadas y permisos validados por el servidor. El usuario eligió esta opción
el 2026-10-01. La edición manual de balances, denominaciones y reversión que existe
en la vista local queda pendiente: sus cambios en memoria no sustituyen un cierre
contable. Su código se conserva; esta integración no agrega una API para esas
operaciones ni las presenta como guardadas.

Cargos Recurrentes conserva el formulario y catálogo conectado, con creación,
edición y actividad persistidas en servidor. La ruta local alternativa no reemplaza
ese catálogo con filas derivadas de cargos ordinarios o almacenadas en el navegador.
Los datos locales previos y el código de la vista alternativa se conservan.
Las flechas navegan registros; no afirman guardar un orden que la API no admite.

Tasas de Cambio mantiene su pantalla conectada y Envios de Dinero mantiene su
espacio de trabajo. Los seis arreglos anteriores, los centavos seguros, DOP en el
libro de cobros, la jornada del servidor y el ledger inmutable se conservan.

La aprobación de integración no equivale a cobertura completa de QA. La matriz de
pantallas, roles y flujos se mantiene con evidencia por versión y estados probado,
no probado, bloqueado o no aplicable. El GPS físico fue confirmado por el usuario.
