# Preparación

Objetivo específico: Organizar preparación operativa de pedidos.

Responsabilidad: Preparación, dentro de Inventario.
Estado: contrato funcional publicado y consumido por Operaciones en DEV.

La API permite listar, iniciar, marcar líneas y completar una preparación. Solo
acepta pedidos `CONFIRMED`; al completar todas las líneas compromete la reserva
de Inventario y deja el pedido `READY`. Implementación en `preparation_api/`,
paquete reproducible en `lambdas/mastererp-dev-preparation/` y pruebas en
`tests/`. Permisos: `operations.preparation.read/write`.


## Contrato y estado de esta capa

Código: 2.1.3. Nombre/ruta: `2.1.3-preparation`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Inventario; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: backend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: flujo DEV comprobado y pruebas unitarias aprobadas. El
candidato local añade directorio paginado y búsqueda; aún no está publicado.

Validaciones: estructura local mediante scripts/validate_structure.py. Pendientes: contratos específicos, responsable nominal y pruebas funcionales antes de habilitar esta capacidad.
