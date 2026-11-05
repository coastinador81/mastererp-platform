# Inventario

Objetivo específico: Consultar y controlar existencias; reglas de movimientos pendientes de contrato.

Responsabilidad: Inventario, dentro de Catálogo.
Estado: candidato funcional no desplegado. Incluye lectura, ajuste versionado,
reservas/finalización y paquete Lambda sobre funciones SQL controladas.
El checkout Storefront usa la misma propiedad de Inventario mediante la función
transaccional `ventas_digitales.checkout_crear`; no replica stock ni acepta nodo
o disponibilidad enviados por el navegador.


## Contrato y estado de esta capa

Código: 2.1.6. Nombre/ruta: `2.1.6-inventory`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Catálogo; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: backend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: pruebas unitarias del adapter, ZIP determinista y pruebas
SQL de stock, reserva, consumo e insuficiencia.

Validaciones: estructura local mediante scripts/validate_structure.py. Pendientes: contratos específicos, responsable nominal y pruebas funcionales antes de habilitar esta capacidad.
