# Preparación

Objetivo específico: Organizar preparación operativa de pedidos.

Responsabilidad: Preparación, dentro de Inventario.
Estado: interfaz manual candidata implementada; no integrada al app-shell.

Permite consultar preparación, marcar o reabrir líneas con motivo y completar
el pedido. Obtiene el access token exclusivamente de
`window.mastererpAuth.getAccessToken()` y no materializa credenciales Vite.


## Contrato y estado de esta capa

Código: 2.1.3. Nombre/ruta: `2.1.3-preparation`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Inventario; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: frontend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: build Vite local aprobado. Integración Uonify y smoke DEV pendientes.

Validaciones: estructura local mediante scripts/validate_structure.py. Pendientes: contratos específicos, responsable nominal y pruebas funcionales antes de habilitar esta capacidad.
