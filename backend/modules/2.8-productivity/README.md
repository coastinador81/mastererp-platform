# Productivity backend

> Organización vigente: Productividad conserva Opsphere, Google Workspace y Microsoft 365. Marketing pertenece a 2.4-marketing y MasterCRM a 2.7-crm. Los apartados históricos conservados describen el contrato/estado previo cuando difieran; no modifican el mapa nuevo.


Objetivo específico: Agrupar herramientas de productividad y relación con clientes.

Responsabilidad: productividad, marketing y CRM. Estado: planned.

## Contrato y estado de esta capa

Código: 2.8. Nombre/ruta: `2.8-productivity`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Productividad; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: backend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: la reserva documental no acredita implementación; conservar cualquier código/plantilla existente y revisar evidencia específica antes de marcar implementado.

Validaciones: estructura local mediante scripts/validate_structure.py. Pendientes: contratos específicos, responsable nominal y pruebas funcionales antes de habilitar esta capacidad.
