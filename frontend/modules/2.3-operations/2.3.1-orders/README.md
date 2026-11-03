# Pedidos

Objetivo específico: Gestionar pedidos y sus transiciones autorizadas.

Responsabilidad: Pedidos, dentro de Operaciones.
Estado: candidato funcional no desplegado. La UI permite filtrar, listar,
consultar detalle y ejecutar manualmente las transiciones autorizadas del
pedido. Mantiene disponible la operación humana aunque se incorporen agentes.


## Contrato y estado de esta capa

Código: 2.3.1. Nombre/ruta: `2.3.1-orders`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Operaciones; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: frontend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: aplicación Vite compilada con `npm run build`; consume las
cuatro rutas canónicas con bearer token y contexto tenant/empresa. La interfaz
no concede permisos: el backend/PostgreSQL vuelve a autorizar cada operación.

Validaciones: `npm run build` y estructura local mediante
`scripts/validate_structure.py`. Pendientes para habilitar: integración con el
app-shell/Uonify, configuración DEV real y pruebas E2E posteriores al despliegue.
