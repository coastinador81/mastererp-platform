# Platform architecture

Las aplicaciones consumen contratos compartidos. Los servicios son dueños de sus límites funcionales y reciben configuración genérica por entorno.

Flujo objetivo de chat/herramientas: `Usuario -> Uonify Core -> MCP Gateway -> módulo propietario -> auditoría`. Las pantallas especializadas consumen las APIs autorizadas de MasterERP; este flujo no obliga a enrutar todas sus peticiones a través de Uonify.

## Contrato frontend

El [contrato frontend común](FRONTEND_ARCHITECTURE.md) define app-dev.uonify.com como entrada general DEV a un espacio con dashboard, chat y menú de módulos habilitados y autorizados. Las pantallas se presentan dentro de Uonify con identidad y contexto comunes; el mecanismo técnico de integración sigue pendiente. Finanzas agrupa Administración, Contabilidad y BI y mantiene entrega propia. Su hosting independiente DEV existe para desarrollo y pruebas, sin imponer una raíz productiva financiera. MasterERP conserva el núcleo de negocio y la autorización de cada API.
