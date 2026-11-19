# Revisión EGM del selector

Codex, 19 de noviembre. Dos revisores independientes contrastaron el plan con SessionStations, StationInstallationPanel y las rutas de instalaciones.

- Se aplican los permisos de oficina de consulta y edición de estaciones (111 y 113). El servidor vuelve a comprobarlos en la transacción. El portal del cobrador conserva el listado.
- El selector solo aparece con lectura local correcta, estaciones activas y cero vínculos. La selección no crea claves. «Continuar sin registrar» y el botón que nombra la estación distinguen las dos salidas.
- El registro usa la firma y validación existentes. La petición final se conserva en memoria para un reintento idéntico. Las pestañas serializan el registro del selector y vuelven a consultar los vínculos antes de iniciar uno nuevo. El servidor verifica en la misma transacción el destino y los vínculos conocidos. Un reintento confirmado por idempotencia se resuelve antes de repetir las comprobaciones.
- Tras una recarga, el servidor y la identidad persistida permiten comprobar un registro ya confirmado. No se guarda en disco el cuerpo firmado. Un recibo, la configuración RRAA y las demás instalaciones no cambian al seleccionar o salir.
