# Pedidos

Objetivo específico: Gestionar pedidos y sus transiciones autorizadas.

Responsabilidad: Pedidos, dentro de Ecommerce.
Estado: desplegado y validado en DEV. Incluye reglas de dominio,
repositorio sobre funciones PostgreSQL controladas, adapter HTTP para API
Gateway v2 y entrada/paquete reproducible de Lambda.


## Contrato y estado de esta capa

Código: 2.3.1. Nombre/ruta: `2.3.1-orders`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Ecommerce; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: backend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: 18 pruebas en `tests/` cubren dominio y adapter HTTP. La
Lambda exige claims verificados de API Gateway, resuelve `issuer + sub` contra
la identidad interna y delega autorización de tenant/empresa a PostgreSQL.
La creación exige `Idempotency-Key` y una referencia opaca de reserva emitida
por Inventario. El artefacto se genera con
`lambdas/mastererp-dev-orders/package.py`.
El checkout Storefront crea esa reserva y el Pedido atómicamente mediante
`ventas_digitales.checkout_crear`, resolviendo identidad, tienda y precios en el
servidor. El endpoint administrativo de Pedidos conserva su contrato separado.
La lectura de la ficha incluye `history`, proyectado desde los eventos
inmutables del pedido con estado, motivo, detalle, actor y fecha; el Admin no
fabrica historial local.
Las notas internas se persisten de forma idempotente mediante
`POST /v1/companies/{company_id}/orders/{order_id}/notes`. La cancelación previa
al despacho coordina pedido, reserva de inventario y venta vinculada en una sola
transacción; si alguna autorización o precondición falla, no deja efectos parciales.
La lectura y escritura de notas tipa explícitamente los UUID en el adapter para
resolver las firmas PostgreSQL controladas sin depender de parámetros `unknown`.

Validaciones: `python -m unittest discover -s backend/modules/2.3-ecommerce/2.3.1-orders/tests -p 'test_*.py'`
y estructura local mediante `scripts/validate_structure.py`. El checkout E2E,
la observación DEV y el retiro reversible de escritores legacy aprobaron.

## Confirmación eCommerce y Ventas — AWS DEV validado

Al confirmar un pedido de eCommerce, el adapter resuelve su origen en PostgreSQL y ejecuta `administracion.venta_desde_pedido` en la misma transacción mastererp_app/SSL. Devuelve el pedido y un bloque `sale`. Otros orígenes/transiciones mantienen su comando previo. Depende de 046 y 047 de Database, aplicadas/reaplicadas en DEV. Ver [contrato oficial de datos](https://github.com/eticayservicios/mastererp-database/blob/dev/docs/SALES_ORDER_COMMAND.md).

Endpoint existente: `POST /v1/companies/{company_id}/orders/{order_id}/transitions`. JWT, `X-Tenant-Id` y cuerpo `{version,status:"CONFIRMED",reason,detail?}`. Idempotency-Key opcional; fallback estable `sv:<pedido_id>:<version>`. Campos opcionales: sale_date, exchange_rate, exchange_date, exchange_source. Fecha omitida: zona horaria de empresa; moneda distinta requiere cambio explícito. Reason/detail se conservan y participan en idempotencia.

Rol aprobado `tenant.finance_admin` (Administradores de Finanzas): administration.sales.write + administration.read + operations.orders.read, sin escritura operativa general. No se modificaron pertenencias de usuarios reales ni se reemplazó su rol de propietario. El helper privado confirma únicamente PENDING→CONFIRMED, con pago efectivo pendiente de cobro o métodos actuales/legacy VALIDATED. No verifica pagos bancarios por sí mismo ni inventa su validación.

Despliegue: source e2013ad, artefacto CI 42318856201, ZIP ARM64 SHA-256 61f69a11947e9fe16f0070f846f366c3d2d17a8801c2aa09d289e68c447aadc8; stack propietario mastererp-dev-operations. Se conservaron IDs, rol de ejecución, entorno, red, rutas, integración, JWT y CORS. El workflow Validate Orders backend candidate prueba y empaqueta en Linux remoto; no despliega automáticamente. Infrastructure usa scripts/deploy_orders_sales.py y change set revisado; no reimporta la API.

Resultados: 18 pruebas unitarias remotas; importación del driver y comprobación de binarios/dependencias; 14 casos HTTP reales, incluidos datos persistidos, replay, contenido distinto, versión, denegaciones y concurrencia con commit. Misma clave: 200/200 con mismo ID; distinta clave para el mismo pedido: 200/409 y una sola venta. Tres pedidos CONFIRMED, tres ventas y auditoría comprobados. Ver [evidencia HTTP](../../../../docs/sales-dev-evidence/sales-http-result-v2.json) y [persistencia](../../../../docs/sales-dev-evidence/sales-final-persisted-evidence.json).

Se conservan ventas selladas de prueba en un tenant DEV suspendido con pertenencia inactiva; no se desactivan triggers para borrarlas. No son un ambiente QA nuevo. Hubo un fallo inicial de empaquetado por typing_extensions.py ausente: se restauró el ZIP previo por CloudFormation, se corrigió el paquete y se repitió la suite con éxito. El artefacto x86 inicial se bloqueó antes de desplegar; el runtime real es Python 3.12 ARM64.

Pendientes: asignar roles a personas reales sin perder propiedad, frontend propio de Ventas, otros orígenes, captura/verificación de cambio en consumidores, validación real de pagos y cancelaciones coordinadas. No hay facturación ni cobros automáticos.
