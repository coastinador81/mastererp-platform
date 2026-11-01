# Tenant Onboarding frontend

Objetivo específico: Guiar el alta de tenants, conservar su progreso y aprovisionar las capacidades autorizadas.

Responsabilidad: alta de tenant. Estado: planned.

## Contrato y estado de esta capa

Código: 1.1. Nombre/ruta: `1.1-tenant-onboarding`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Plataforma Base; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: frontend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: pendiente: README no equivale a pantalla implementada.

Validaciones: estructura local mediante scripts/validate_structure.py. Pendientes: contratos específicos, responsable nominal y pruebas funcionales antes de habilitar esta capacidad.
