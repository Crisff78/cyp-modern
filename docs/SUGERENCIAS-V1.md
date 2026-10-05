# Sugerencias V1: contrato de los datos añadidos

Estos cambios amplían los formularios existentes. Los campos nuevos de referencia
son opcionales y no reconstruyen información histórica desconocida. Importes
monetarios siempre son centavos enteros; monedas admitidas: DOP, USD y EUR.

Los límites del cobrador se guardan mediante `/api/cobradores/:id/limites`, con
solo `collectionLimit` y `payoutLimit`. El diálogo muestra el valor anterior y
el propuesto antes de confirmar; no modifica los datos personales del cobrador.

Los submodales Z/L/R conservan las asignaciones y límites por moneda de la
sesión del navegador. No modifican las asignaciones ni los límites operativos
de la API. En L, «Modificar límites operativos DOP» abre el diálogo persistido
descrito arriba, sin guardar el borrador de sesión. Son acciones separadas.

Cada cliente puede tener `preferredCurrency`; DOP es el valor histórico y de
alta por defecto. Las preferencias del remitente y destinatario son distintas.
Buscar por teléfono no identifica a una persona de forma única. Copiar teléfono
a celular o nota es una acción explícita que conserva los valores ya escritos.

Las cuentas tienen `nickname` y `note` informativos. La longitud mínima aprobada
para crear o cambiar una contraseña es 10, como la política pública de invitación
en `demo-access.ts` y `DEMO-PUBLICA.md`. El login de cuentas existentes y el mínimo
14 del bootstrap no demo mantienen su comportamiento.

Los servicios pueden registrar `referencePriceCents` y `referenceCurrency`
juntos, `taxReference`, `benefitReference` y `referenceQuantity`. Son referencias
manuales; las anotaciones de impuestos, beneficio y cantidad deben expresar su
unidad. Un campo vacío se borra con `null`; omitirlo al editar conserva su valor.
No son una fórmula fiscal, un precio aplicado automáticamente, control de stock
o cálculo de beneficio. Una referencia de precio cero requiere entrada explícita.

Un depósito nuevo puede incluir `depositComponents` de efectivo, cheque o
depósito bancario. Cada componente tiene un importe positivo y los no efectivos
requieren banco y referencia. La suma debe coincidir exactamente con el importe
total. Las denominaciones detallan únicamente el efectivo; los depósitos antiguos
sin componentes mantienen su contrato. Aceptar/cancelar conserva los eventos del
flujo existente, sin integración o confirmación externa del banco.

Las nuevas remesas conservan los contactos y la revisión de cotización al
confirmarse en el servidor. Las revisiones de tasa tienen hora UTC, actor y
referencia explícita. Una tasa A→B→A constituye cambios distintos; no revive una
cotización antigua. Los recibos muestran fecha y hora en America/Santo_Domingo,
independientemente de la zona del navegador. Los datos históricos ausentes se
muestran como desconocidos.

La comisión del negocio mantiene su fórmula existente. La comisión del gestor
es una anotación opcional introducida manualmente con nombre, importe y moneda
explícitos; no se deduce del operador ni altera principal, fondos, comisión del
negocio o roles. El informe la separa por gestor y moneda, distinguiendo las
operaciones canceladas. No calcula reparto, devengo ni pago al gestor. Los rangos
del informe corresponden a la fecha de emisión y al estado actual de la operación,
no a un informe de devoluciones por fecha de cancelación.

Las migraciones 017–021 son aditivas; no cambian importes del ledger ni rellenan
horas, contactos o comisiones desconocidos. Antes de publicar, se deben acreditar
tipados, builds, suites, navegador y PostgreSQL aislado para estos cambios.
TestSprite está retirado de la ejecución y de los criterios de aprobación por
instrucción explícita del usuario.
