# Platform architecture

Las aplicaciones consumen contratos compartidos. Los servicios son dueños de sus límites funcionales y reciben configuración genérica por entorno.

Flujo objetivo de chat/herramientas: `Usuario -> Uonify Core -> MCP Gateway -> módulo propietario -> auditoría`. Las pantallas especializadas consumen las APIs autorizadas de MasterERP; este flujo no obliga a enrutar todas sus peticiones a través de Uonify.

## Contrato frontend

El [contrato frontend común](FRONTEND_ARCHITECTURE.md) define `dev.uonify.com` como producto principal y entrada general DEV con cuenta, espacios, chat y lanzador de aplicaciones habilitadas y autorizadas. Las aplicaciones comparten identidad y contratos, pero mantienen entrega y recuperación independientes. `app-dev.uonify.com` conserva el shell administrativo histórico durante la transición; su primer recorrido de Clientes/Proveedores está documentado en [FINANCE_UI_INTEGRATION.md](FINANCE_UI_INTEGRATION.md). MasterERP conserva el núcleo de negocio y la autorización de cada API.
