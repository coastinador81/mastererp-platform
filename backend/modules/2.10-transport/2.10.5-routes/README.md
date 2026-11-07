# Rutas

Objetivo específico: Planificar recorridos operativos sin poseer repartidores.

Responsabilidad: Rutas, dentro de Transporte.
Estado: candidato funcional implementado; no desplegado.

Rutas planifica pedidos `READY`, enlaza un repartidor disponible del módulo
Transporte y gobierna paradas y entrega. No posee perfiles de repartidor. Incluye
API, repositorio SQL, paquete Lambda reproducible y pruebas unitarias.


## Contrato y estado de esta capa

Código: 2.10.5. Nombre/ruta: `2.10.5-routes`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Transporte; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: backend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: pruebas unitarias y recorrido SQL integrado aprobados localmente. Despliegue y smoke DEV pendientes.

Validaciones: estructura local mediante scripts/validate_structure.py. Pendientes: contratos específicos, responsable nominal y pruebas funcionales antes de habilitar esta capacidad.
