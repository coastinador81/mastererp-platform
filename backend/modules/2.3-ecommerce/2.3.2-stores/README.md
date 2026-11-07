# eCommerce

Objetivo específico: Gestionar venta online; catálogo y finanzas conservan sus datos propietarios.

Responsabilidad: eCommerce, dentro de Ecommerce.
Estado: catálogo/configuración desplegados; identidad Storefront candidata.

Administra tiendas multi-tenant, dominio, nodo de inventario, marca,
configuración y módulos opcionales. Expone configuración administrativa con JWT
y catálogo público de solo lectura limitado a una tienda `ACTIVE` cuyo dominio y
tenant coinciden. Catálogo e Inventario conservan sus datos propietarios.

La transición de clientes usa invitaciones administrativas de un solo uso. El
token se almacena únicamente como SHA-256 y la reclamación exige un ID token
validado por API Gateway para el cliente Cognito exclusivo del Storefront. El
enlace es `issuer + sub`; el correo es solo perfil y no otorga membresía del
tenant.


## Contrato y estado de esta capa

Código: 2.3.2. Nombre/ruta: `2.3.2-stores`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Ecommerce; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: backend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: siete pruebas unitarias, paquete Lambda y recorrido SQL integrado aprobados. Despliegue de identidad y smoke DEV pendientes.

Validaciones: estructura local mediante scripts/validate_structure.py. Pendientes: contratos específicos, responsable nominal y pruebas funcionales antes de habilitar esta capacidad.
