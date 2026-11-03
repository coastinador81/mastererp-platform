# Uonify

## Experiencia integrada objetivo

En DEV, app-dev.uonify.com es la entrada general: dashboard común con chat y menú de módulos habilitados para el tenant y autorizados para el usuario. Las pantallas de Finanzas y otros módulos deben presentarse en ese espacio con navegación, identidad y contexto comunes; conversar es opcional. La integración técnica y las rutas internas siguen pendientes. El alojamiento independiente de Finanzas DEV se conserva para pruebas. Ver [contrato oficial](../../../docs/FRONTEND_ARCHITECTURE.md). Esta decisión no acredita el dashboard integrado ni las pantallas de módulos implementados.

Objetivo específico: Canal conversacional y de voz para consultar y coordinar operaciones con los módulos propietarios.

Responsabilidad: Chat, voz, memoria, conversaciones, selección de modelos, guardas y orquestación. Cerebro principal compartido.
Estado: estructura funcional; implementación pendiente.


## Contrato y estado de esta capa

Código: 0. Nombre/ruta: `0-uonify`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Uonify; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: frontend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: la reserva documental no acredita implementación; conservar cualquier código/plantilla existente y revisar evidencia específica antes de marcar implementado.

Validaciones: estructura local mediante scripts/validate_structure.py. Pendientes: contratos específicos, responsable nominal y pruebas funcionales antes de habilitar esta capacidad.

