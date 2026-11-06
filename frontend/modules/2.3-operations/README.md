# Operations frontend

Objetivo específico: Administrar E-commerce y su operación de pedidos,
preparación, rutas y nodos desde una aplicación autenticada independiente.

Responsabilidad: E-commerce administrativo, pedidos, preparación, rutas,
nodos, catálogo e inventario. El Storefront comprador y Digital Sales conservan
sus responsabilidades propias; este módulo consume sus contratos canónicos sin
copiar datos.

Estado: primera aplicación independiente compilable para
`ecom-dev.uonify.com`, basada en el patrón técnico de Finanzas. Comparte Cognito
MasterERP y resuelve tenant, empresa, módulos y permisos mediante las APIs de
identidad. El resumen organiza Gestión de e-Commerce y Gestión de Catálogo;
cada pantalla se muestra solo con su permiso. La API vuelve a autorizar cada
operación. Facturas permanece pendiente de contrato canónico.

## Contrato y estado de esta capa

Código: 2.3. Nombre/ruta: `2.3-operations`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Operaciones; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: frontend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: `npm run build`, pruebas Cognito y pruebas de acceso del
módulo pasan localmente. No acredita hosting DEV, configuración Cognito del
nuevo callback, infraestructura, datos reales ni aislamiento E2E.

Validaciones: estructura local mediante `scripts/validate_structure.py`.
Pendientes: callback/logout Cognito para el nuevo origen, CloudFront/S3 y proxy
de APIs propios, pipeline OIDC mínimo, pruebas con dos tenants, prueba visual y
publicación DEV autorizada. No realizar DNS ni despliegue como efecto implícito.
