# App Shell

Ubicación de la consola principal Uonify, junto a `frontend/modules`. Estado: implementación pendiente. Responsable de layout, rutas, sesión y tenant activo; los módulos conservan su lógica funcional.

Contrato vigente: [arquitectura frontend común](../../docs/FRONTEND_ARCHITECTURE.md). El shell aporta responsabilidades compartidas de UI/contexto; no se adopta como contenedor inicial de microfrontends embebidos. Uonify es el front general y los frontends especializados tienen entradas federadas y entregas propias. Su ubicación no crea un producto Uonify adicional ni sustituye autorización backend.
