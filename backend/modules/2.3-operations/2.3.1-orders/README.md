# Pedidos

Objetivo específico: Gestionar pedidos y sus transiciones autorizadas.

Responsabilidad: Pedidos, dentro de Operaciones.
Estado: candidato funcional no desplegado. Incluye reglas de dominio,
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
y estructura local mediante `scripts/validate_structure.py`. No se ha
desplegado. La promoción requiere artefacto con dependencias, migración SQL,
parámetros de infraestructura y smoke test en DEV.
