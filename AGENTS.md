# CyP Modern — estado compartido

Este archivo resume el estado operativo para quienes trabajan en CyP Modern. La
historia detallada pertenece al Superbrain del proyecto. Antes de actuar, comprobar
el código, la rama y el entorno real; este archivo no sustituye esa verificación.

## Objetivo

Mantener la API REST, el portal administrativo y la PWA del cobrador para cobros,
pagos autorizados, envíos de dinero, seguimiento y cuadre. CyP Modern es un
proyecto separado de Hermes-BI.

## Stack y límites

- Node.js 22.12 o posterior, TypeScript, pnpm y un único `pnpm-lock.yaml`.
- `app/server`: Fastify, PostgreSQL, dominio, migraciones y pruebas.
- `app/client-admin`: portal React/Vite. `app/client-collector`: PWA React/Vite.
- Puertos de desarrollo: API 3001, administración 5173 y cobrador 5174.
- PostgreSQL es el almacén del modo real. La demo requiere activación explícita:
  sin `DATABASE_URL` usa un archivo local; con esa variable abre la base indicada
  y habilita cuentas demo. Usar solo una base dedicada con datos ficticios.
- Los secretos, respaldos, extractos y datos de clientes quedan fuera de Git.
  El repositorio público contiene migraciones y ejemplos ficticios.
- No se usa Docker ni SQL Server para este proyecto.

## Decisiones activas

- El libro original de cobros en DOP y la caja de envíos por operador/moneda son
  independientes. Consultar [docs/ENVIOS-API.md](docs/ENVIOS-API.md) para reglas
  de tasas, comisión, actores, pago completo, cancelación y reportes.
- Los importes, permisos, estados, referencias e idempotencia se validan en la
  API; la interfaz no decide el saldo contable.
- Los monitores C/Z/R usan el mapa conectado a la API local. `MapViewer` de
  CobranzaMapas queda sin activar hasta contar con origen y sesión reales; su
  UUID de muestra no acredita una sesión válida.
- GPS requiere permiso explícito del dispositivo y HTTPS al salir de localhost.
  Una prueba automatizada no acredita precisión física.
- La base definitiva y los respaldos no se suben al repositorio público. Cada
  integrante prepara su propia configuración y aplica las migraciones que necesite.

## Current state

**Last updated:** 2026-10-10, hora dominicana, por Codex.

### Done so far

- Base actual incorporada por fast-forward: main del compañero
  `60191c943a8cd5118fd8a4d5909f45ec9bbba8b3`; rama de trabajo
  `codex/october-nine-corrections`. Se conservan roles, permisos, tema,
  cotización inversa, política central y reparto de comisiones, referencias de
  productos y validación real de RRAA del compañero.
- Las 27 solicitudes no vacías de `C Y P NUEVO.txt` tienen implementación.
  Matriz de las 36 anteriores, las 27 nuevas y la entrada vacía5.6:
  `docs/OCTUBRE-09-CORRECCIONES.md`. Evidencia local distingue ejecución,
  lectura estática y límites externos; no certifica el100% del producto.
- Cambios nuevos: bancos y referencias/notas de cobro; filtros/detalle de
  entregas; tasas centrales readonly en Remesas, recientes primero y compra/
  venta separadas; cuadres DOP/USD/EUR separados; código e identificación
  interna reservados por servidor, sin inventar cédulas; logo, soporte,
  clave propia con revocación, semana de Santo Domingo, herramientas visibles
  y listado/recibo individual con pie configurable. El comprobante de remesa
  omite el reparto de comisión y conserva el total recibido.
- Migraciones aditivas027–029. PostgreSQL17.6 aislado en loopback probó
  hashes001–029, concurrencia, persistencia, constraints, contactos congelados
  y cambio de clave; clúster privado detenido al terminar. No hubo pruebas
  con escritura en datos compartidos. Tres tipos y tres builds locales PASS.
  Pruebas de navegador reales con Edge temporal y MemoryStore están en la
  matriz; las omitidas de CI no se cuentan como ejecutadas.
- PR20 abierto con fuente inicial26634f7. Corregido también el bootstrap de
  demos sin marcadorV2 para usar la política central activa sin cambiarla.
  Tres casos nuevos PASS; servidor final251PASS/12SKIP/0FAIL y tipos/build PASS.
  La reserva temporal del cliente ya no se reenvía tras un refresco fallido:
  Shell9/9 prueba tres refrescos503 y ubicación/edición200.
- GitHub no inició los jobs del push ni del PR por bloqueo de facturación;
  runs38021641503/38021671283, cero steps. No es CI verde. `pnpm check` local
  terminó exit0: Cobrador12PASS, Administración165PASS, servidor previo
  248PASS/12SKIP reemplazado por final251PASS/12SKIP del arreglo; tres tipos
  y tres builds PASS. Recibo en `.codex-lab/oct9-review/check-publication.log`;
  revisión de rollout
  confirma001–023 intactas y024–029 aditivas, sin consultar ledger remoto.
- GitHub y Render son la fuente del estado de publicación. El servicio
  existente usa `codex/public-browser-demo`; no crear otra demo ni repetir
  merges antiguos. Las migraciones del arranque son transaccionales y solo
  aceptan la base dedicada `cyp_demo`. La versión y CI vigentes deben
  consultarse antes de cualquier actualización.
- Antecedentes preservados: PR3/4 y PR7–10 publicaron validaciones, mínimo de
  clave3, ruta No definida y hora/reintentos de tasas; PR18/19 conservaron
  cambios del compañero y contraste oscuro. Evidencia detallada y recibos
  en Superbrain/Activity/2026-10-05,2026-10-06 y2026-10-08; no repetir
  publicaciones ni rehacer el video histórico de mínimo10 sin petición.

### Next step

1. Cerrar comprobación local y actualizar PR20 con el arreglo de bootstrap;
   consultar el estado de CI y comprobar Live/health y UI de la misma demo.
   GitHub no puede iniciar CI hasta resolver el bloqueo de facturación.
2. Para completar identidad automática de estación, obtener del proveedor el
   contrato de obtención/registro/vinculación de `idestacion`; VALSTAT solo
   valida una combinación ya recibida. No usar un UUID de navegador como
   prueba de identidad del equipo; Obtener Datos sigue sin contrato.
3. Gerencia debe definir los porcentajes comerciales; conservar0% y no
   recalcular remesas anteriores. Mayo debe comprobar la impresión física.
4. Mantener continuidad local y Codex Superbrain Vault Sync Disabled; sin
   sync remoto, Agent Mail, VPS, credenciales ni pruebas reales/compartidas.

### Blockers / límites

- El ejemplo VALSTAT recibido no añade una operación de identidad automática.
  La licencia y el ID del proveedor no se persisten en Git ni Superbrain.
- Compra/venta se guardan como valores separados; las remesas conservan su
  tasa operativa y no se inventa una fórmula comercial. Los datos históricos
  ausentes o monedas incompatibles no se rellenan automáticamente.
- Impresión física pendiente de Mayo; PDF y navegador no la acreditan.
  GPS físico y guardado de contraseña del navegador tienen confirmación
  humana previa, no una nueva prueba física de Codex. TestSprite excluido.
- Las pruebas omitidas en CI siguen omitidas; no cobertura100% ni promesa de
  ausencia de otros bugs. No se restauran ni resetean registros compartidos.
- La instalación local3001/5173/5174 es independiente. Render gratuito puede
  dormir; los evaluadores comparten datos ficticios y cuotas de alojamiento.
- Jev/MoA son asesores selectivos, sin veto sobre este alcance autorizado.
- La cuenta rardiel888 publica en el repositorio de Crisff78, sin permiso admin.
  El titular debe revisar su bloqueo de facturación o acudir a soporte de GitHub;
  no se presenta un gate local como ejecución de CI.
