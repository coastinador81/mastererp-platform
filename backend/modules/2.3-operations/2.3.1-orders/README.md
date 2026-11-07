# Pedidos

Objetivo específico: Gestionar pedidos y sus transiciones autorizadas.

Responsabilidad: Pedidos, dentro de Operaciones.
Estado: desplegado y validado en DEV. Incluye reglas de dominio,
repositorio sobre funciones PostgreSQL controladas, adapter HTTP para API
Gateway v2 y entrada/paquete reproducible de Lambda.


## Contrato y estado de esta capa

Código: 2.3.1. Nombre/ruta: `2.3.1-orders`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Operaciones; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: backend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: 14 pruebas en `tests/` cubren dominio y adapter HTTP. La
Lambda exige claims verificados de API Gateway, resuelve `issuer + sub` contra
la identidad interna y delega autorización de tenant/empresa a PostgreSQL.
La creación exige `Idempotency-Key` y una referencia opaca de reserva emitida
por Inventario. El artefacto se genera con
`lambdas/mastererp-dev-orders/package.py`.
El checkout Storefront crea esa reserva y el Pedido atómicamente mediante
`ventas_digitales.checkout_crear`, resolviendo identidad, tienda y precios en el
servidor. El endpoint administrativo de Pedidos conserva su contrato separado.

Validaciones: `python -m unittest discover -s backend/modules/2.3-operations/2.3.1-orders/tests -p 'test_*.py'`
y estructura local mediante `scripts/validate_structure.py`. El checkout E2E,
la observación DEV y el retiro reversible de escritores legacy aprobaron.


## Candidato de conexión con Ventas — 7 noviembre 2026

Dependencia SQL: 046 de Database, ya aplicada/reaplicada en DEV. El candidato del repositorio resuelve el origen con `operaciones.pedido_origen_ecommerce`. Solo al confirmar un pedido eCommerce usa `administracion.venta_desde_pedido` en la misma transacción de aplicación y devuelve el pedido vigente con un bloque adicional `sale`. Otros orígenes y otras transiciones conservan la función operativa existente. No hay dos commits ni una escritura directa desde el navegador.

Se conserva el endpoint y cuerpo de transiciones. Idempotency-Key es opcional aquí; si falta, la clave estable es `sv:<pedido_id>:<version>`. Campos opcionales: sale_date, exchange_rate, exchange_date, exchange_source. Sin fecha se usa la zona horaria de la empresa; moneda distinta requiere cambio explícito. La razón técnica registrada por el comando de venta es SALE_CONFIRMED; el reason/detail del endpoint antiguo no se traslada todavía a ese evento y debe resolverse antes del despliegue para no degradar auditoría.

Necesita el permiso nuevo administration.sales.write, cuya asignación al rol funcional está pendiente de decisión del propietario. No se amplían roles existentes automáticamente. El backend candidato todavía NO está desplegado: primero revisar permisos, auditoría y pruebas HTTP. Pagos mobile/transfer del checkout mantienen la incompatibilidad previa con mobile_payment/bank_transfer de la transición; no se transforman pagos pendientes en validados.

El workflow Validate Orders backend candidate ejecuta pruebas unitarias y empaquetado en Linux remoto, sin AWS deploy. El empaquetador incluye PyJWT/cryptography y dependencias como el ZIP actual; antes omitía esos paquetes aunque el ZIP ya desplegado sí los contenía. Son las mismas versiones utilizadas por eCommerce, sin instalación local. Pruebas de doubles no acreditan persistencia HTTP. La publicación AWS futura pertenece al stack mastererp-dev-operations, modificando solo OrdersArtifactKey y verificando change set/IDs; nunca reimportar APIs con SAM.


### Contrato ampliado 047 y aprobación del rol

El propietario aprobó Administradores de Finanzas. La dependencia para este candidato es ahora 046 + 047: 047 conserva reason/detail y los incluye en la idempotencia cuando existen. La confirmación financiera usa un helper privado acotado, sin conceder operations.orders.write al rol de Finanzas. No hay asignación automática a usuarios reales ni pérdida del rol de propietario existente. La validación de pagos admite alias actuales/legacy solo con VALIDATED; efectivo pendiente de cobro conserva el contrato vigente.

Las notas anteriores sobre motivo pendiente describen el candidato anterior y quedan superadas por 047. El backend no se considera desplegado hasta registrar el change set del stack propietario y las verificaciones HTTP. Las pruebas HTTP crearán únicamente un tenant DEV de fixture identificado, que quedará inactivo al terminar si contiene ventas selladas; no se desactivan triggers para borrar su historial.
