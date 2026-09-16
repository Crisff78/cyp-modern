# CyP · Portal del cobrador

Web React/TypeScript, accesible desde el navegador y preparada como PWA. El backend debe estar disponible en `127.0.0.1:3001`; Vite sirve este portal en `127.0.0.1:5174` y redirige `/api` al backend.

Desde la raíz del repositorio:

```powershell
npm install
npm run dev --workspace @cyp/client-collector
npm run build --workspace @cyp/client-collector
```

La opción **Entrar a la demostración** envía las credenciales de prueba al servidor. Requiere `DEMO_MODE=true`; no hay datos simulados ni saldos calculados como autoridad en el frontend. La aplicación muestra que los datos de demostración son ficticios. El token de sesión se guarda en `sessionStorage`.

## Flujos conectados

- Mi ruta: cargos por cliente, búsqueda, filtros Todos / Pendientes / Cobrados / Con atraso, prioridad «Obligado a cobrar», teléfono y enlace de dirección a Maps.
- Cobros y pagos: hojas accesibles Radix, teclado grande, abonos, desglose opcional de efectivo y validación del saldo. El servidor valida saldo disponible, cierre de jornada y límites.
- Cada intento monetario guarda temporalmente importe y `Idempotency-Key` en la pestaña antes de enviarlo. Un fallo de red conserva esa referencia, incluso tras cerrar y reabrir la hoja o recargar. El reintento manual reutiliza la referencia. No se envía dinero en segundo plano ni se encolan movimientos sin conexión. Los errores definitivos 4xx permiten corregir los datos.
- Recibos: enlaces públicos `/?receipt=<token>`; lectura desde `/api/recibos/:token`, compartir nativo, copiar, WhatsApp, impresión de navegador 58/80 mm y descarga ESC/POS. El archivo binario necesita un puente de impresión externo compatible. El navegador no imprime directamente en dispositivos arbitrarios.
- Bolsillo: saldo recibido del servidor y desglose informativo calculado del libro de movimientos, límites separados, cierre de sesión e instalación.
- Ubicación: solo se solicita permiso al pulsar Compartir mi ubicación. `watchPosition` envía a `/api/tracking` como máximo cada 45 segundos; se detiene manualmente, al salir o cerrar la aplicación. HTTPS/localhost y el permiso de ubicación son necesarios. No promete seguimiento en segundo plano.

## PWA y privacidad

`public/sw.js` solo se registra en producción. Precarga el HTML estático, el manifiesto, el icono y los recursos compilados presentes en el HTML. **Nunca almacena API, URLs con parámetros (incluyendo recibos), respuestas autenticadas, tokens ni datos de clientes en Cache Storage.** Las navegaciones con parámetros reciben el mismo HTML genérico de respaldo si falla la red; los datos del recibo siguen requiriendo conexión. El estado de la ruta vive en memoria; si se pierde la conexión durante una sesión se muestra en modo de lectura y se deshabilitan cobros y pagos. Una apertura en frío sin conexión muestra el shell y necesita reconexión para autenticar y cargar datos. Los recursos estáticos del mismo origen se buscan ignorando `Vary`, para admitir servidores que añaden `Vary: Origin` a JS/CSS públicos.

`manifest.webmanifest` contiene icono SVG escalable, nombre, ámbito y colores. La disponibilidad de instalación depende del navegador; si no emite `beforeinstallprompt` se explican sus pasos nativos. El icono SVG puede requerir variantes PNG para dispositivos/versiones que no admitan SVG en instalación.

En producción, configurar el servidor frontal con fallback a `index.html` para la navegación de la PWA y proxy de `/api` a la API. La URL pública de recibos del backend debe coincidir con la URL pública de este portal.

## Verificación

`npm run build --workspace @cyp/client-collector` ejecuta TypeScript estricto y genera el bundle Vite. El service worker se prueba con el build servido por un servidor con proxy `/api` o el hosting final; Vite dev lo omite deliberadamente.
