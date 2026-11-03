# Platform architecture

Las aplicaciones consumen contratos compartidos. Los servicios son dueños de sus límites funcionales y reciben configuración genérica por entorno.

Flujo objetivo de chat/herramientas: `Usuario -> Uonify Core -> MCP Gateway -> módulo propietario -> auditoría`. Las pantallas especializadas consumen las APIs autorizadas de MasterERP; este flujo no obliga a enrutar todas sus peticiones a través de Uonify.

## Contrato frontend

El [contrato frontend común](FRONTEND_ARCHITECTURE.md) define Uonify como front general y la navegación federada hacia frontends de módulos principales. MasterERP conserva el núcleo de negocio y autorización. Finanzas concentra Administración, Contabilidad y BI en su raíz objetivo; el documento distingue objetivos, DEV documentado y decisiones pendientes.
