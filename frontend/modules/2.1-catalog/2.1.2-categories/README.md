# Categorías

Objetivo específico: Clasificar productos en categorías coherentes.

Responsabilidad: Categorías, dentro de Catálogo.
Estado: candidato funcional implementado, pendiente de integración al app-shell.


## Contrato y estado de esta capa

Código: 2.1.2. Nombre/ruta: `2.1.2-categories`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Catálogo; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: frontend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: UI manual para árbol, altas y edición; consume exclusivamente la sesión runtime del app-shell.

Validaciones: estructura local mediante scripts/validate_structure.py. Pendientes: contratos específicos, responsable nominal y pruebas funcionales antes de habilitar esta capacidad.
