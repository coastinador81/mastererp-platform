# eCommerce

Objetivo específico: Gestionar venta online; catálogo y finanzas conservan sus datos propietarios.

Responsabilidad: eCommerce, dentro de Digital Sales.
Estado: candidato funcional implementado; no desplegado.

Administra tiendas multi-tenant, dominio, nodo de inventario, marca,
configuración y módulos opcionales. Expone configuración administrativa con JWT
y catálogo público de solo lectura limitado a una tienda `ACTIVE` cuyo dominio y
tenant coinciden. Catálogo e Inventario conservan sus datos propietarios.


## Contrato y estado de esta capa

Código: 2.4.2. Nombre/ruta: `2.4.2-ecommerce`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Digital Sales; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: backend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: pruebas unitarias, paquete Lambda y recorrido SQL integrado aprobados. Despliegue y smoke DEV pendientes.

Validaciones: estructura local mediante scripts/validate_structure.py. Pendientes: contratos específicos, responsable nominal y pruebas funcionales antes de habilitar esta capacidad.
