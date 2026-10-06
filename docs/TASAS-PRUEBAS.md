# Revisión del flujo de tasas — 2026-10-06

Alcance: Administración → Tasas de Cambio y Envíos de Dinero → Tasas.
Las escrituras de prueba usan exclusivamente datos ficticios aislados.

## Fallos reproducidos y corregidos

1. Escribir `60,50` carácter por carácter eliminaba la coma y mostraba `6050`
   en la confirmación. Pegarlo podía dejar el campo vacío o conservar su valor
   anterior. Ahora se acepta coma o punto decimal; una entrada inválida queda
   visible y se rechaza completa, sin quitar caracteres silenciosamente.
2. El límite HTML de 19 caracteres cortaba `999999999999.9999999` y lo convertía
   en una tasa diferente válida de seis decimales. El campo deja visible un
   carácter adicional y la confirmación mantiene el límite válido de 19.
3. Una respuesta HTTP 200 `{}` podía anunciar un guardado correcto en Envíos.
   Ambas pantallas comprueban ID, moneda, fecha y tasa exacta antes de liberar
   la referencia pendiente. Una respuesta incompleta o distinta conserva datos
   y clave para recuperar la operación mediante el mismo reintento.

Las tasas se comparan con enteros BigInt, sin redondearlas mediante Number.
Se aceptan `.5`, `1.` y sus variantes con coma como `0.5` y `1`.
No se aceptan agrupadores de miles, notación exponencial, signos, espacios,
valores cero ni más de seis decimales o doce dígitos enteros.

## Evidencia de ejecución

| Comprobación | Resultado observado |
| --- | --- |
| API completa, MemoryStore | 193 PASS, 0 FAIL, 7 SKIP (PostgreSQL no configurado en esa ejecución) |
| Administración y Cobrador, suites locales | 117 PASS, 0 FAIL, 0 SKIP; incluye los tres fixtures de navegador existentes |
| Nuevas regresiones | 8 casos API, 9 de entrada decimal, 8 de respuesta de tasa |
| PostgreSQL aislado, caso 018 existente | 1 PASS, 0 FAIL, 0 SKIP; PostgreSQL 17.6, migraciones 001–021 |
| Componentes reales, navegador integrado | Coma pegada/tecleada, precisión excesiva, texto inválido, crear y editar USD, EUR, DOP, confirmación y reintentos |
| Respuesta incompleta y pérdida de respuesta | Aviso pendiente y botones de cambio bloqueados; mismo body, clave y timestamp al reintentar |
| Hora | Reloj readonly del formulario separado de la marca persistida del servidor, America/Santo_Domingo |

La revisión final del fixture manual produjo ocho solicitudes, cinco claves
distintas y cinco revisiones. Los tres pares de reintento conservaron el body
y la hora originales; no se duplicó el historial. DOP permaneció en `1.000000`.
La API también comprobó no-op, replays después de otros cambios, fechas
pasadas/futuras/incorrectas, permisos y que las cotizaciones anteriores
conservan su tasa. Los históricos sin timestamp siguen sin inventar una hora.

Una ejecución local anterior se hizo mientras se editaban fuentes y terminó
con dos fallos. Su reporte administrativo contenía 18 casos funcionales PASS,
pero el hash de una fuente cambió durante el recorrido. Se repitieron las
suites con fuentes estables: 117 PASS. Esa ejecución anterior no se usa como
aceptación final.

## Cómo repetir la revisión manual aislada

Con las dependencias del lockfile instaladas, desde `app/server`:

```powershell
pnpm exec tsx ../../scripts/qa-exchange-rates.mts
```

El script construye los dos componentes y una API real con MemoryStore,
sin leer `.env`, sin base de datos y escuchando solo en loopback. Abre la
dirección que imprime. Los controles amarillos simulan una respuesta perdida,
un rechazo de jornada o una respuesta incompleta; deben prepararse antes de
abrir la confirmación. `/qa/status` permite cotejar claves, respuestas e historial
del estado ficticio. Ctrl+C cierra el fixture y elimina su salida temporal.

## Límites

- No hubo guardados de prueba en Render, Neon compartido ni registros reales.
- El caso PostgreSQL aislado acredita persistencia de backend, no todos los
  formularios ni todas las pruebas PostgreSQL omitidas en CI.
- El resultado de CI y el commit desplegado se comprueban por separado en
  GitHub/Render; una compilación local no acredita publicación.
- No se cambian fórmulas, migraciones, claves, monedas, diseños ni servicios VPS.
- No se afirma cobertura del 100 % ni que no puedan quedar otros errores.
