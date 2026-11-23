# Revisión EGM del plan: usuario `cob` en la central de pruebas

Revisor nuevo `egm-codebase-details`, sobre la primera versión del plan, el 2026-11-23. Resolución de Claude Code (Opus 5.5).

## Bloqueante

- **Faltaban los documentos.** `docs/DEMO-PUBLICA.md` (líneas 33-35) decía qué accesos se conservan y `README.md`
  (líneas 36 y 74-76) cuáles hay. Resuelto: los dos nombran la cuenta y su clave.

## Importantes

- **Quién abre la caja.** El protocolo no puede abrirla. Resuelto: el plan y `DEMO-PUBLICA.md` dicen que se abre en la
  web con `cob`; la prueba lo hace así.
- **Faltaban pruebas de cotizar y registrar.** Resuelto: cotizar `OK`, registrar `CNA` sin caja y `OK` con caja.
- **La prueba fuera de demo debía ir por POST.** Por GET responde `PIN` antes de mirar la cuenta. Resuelto: `POST`
  responde `UCI`, y además la web 401 y la sesión de la demo no vale.
- **Faltaba el cuerpo de la función.** Resuelto: compara `id` o `email` en minúsculas y escribe la marca aunque la
  cuenta ya exista.

## Menores

- `demo-bootstrap.test.ts`: de 3 a 4 marcas. Resuelto.
- Import de `app.ts:74`. Resuelto.
- La base local de la prueba real debe llamarse `cyp_demo`. Anotado en el plan.
- «Solo tiene datos ficticios» chocaba con `DEMO-PUBLICA.md:244`. Resuelto: el plan lo matiza.

## Sin hallazgo

`index.ts` limita la cuenta a la demo pública con PostgreSQL; el almacén guarda la fila; las restricciones de la base la
aceptan; el rol Cajero tiene los permisos; `cob|cob|3.0` entra en la primera lectura y no se exige formato de correo;
ninguna prueba existente se rompe.
