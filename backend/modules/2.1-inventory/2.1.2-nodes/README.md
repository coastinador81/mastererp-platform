# Nodos

Objetivo específico: Gestionar nodos de operación y su contexto.

Responsabilidad: Nodos, dentro de Inventario.
Estado: candidato funcional no desplegado. Configura el perfil operativo de una
sucursal, consulta nodos y controla transiciones con versión y auditoría.


## Contrato y estado de esta capa

Código: 2.1.2. Nombre/ruta: `2.1.2-nodes`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Inventario; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: backend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: pruebas unitarias del adapter, ZIP determinista y pruebas SQL.

Validaciones: estructura local mediante scripts/validate_structure.py. Pendientes: contratos específicos, responsable nominal y pruebas funcionales antes de habilitar esta capacidad.
