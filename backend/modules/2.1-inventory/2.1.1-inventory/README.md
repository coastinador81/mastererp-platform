# Inventario

Objetivo específico: Consultar y controlar existencias; reglas de movimientos pendientes de contrato.

Responsabilidad: Inventario, dentro de Inventario.
Estado: desplegado y validado en DEV. Incluye lectura, ajuste versionado,
reservas/finalización y paquete Lambda sobre funciones SQL controladas.
El checkout Storefront usa la misma propiedad de Inventario mediante la función
transaccional `ventas_digitales.checkout_crear`; no replica stock ni acepta nodo
o disponibilidad enviados por el navegador.


## Contrato y estado de esta capa

Código: 2.1.1. Nombre/ruta: `2.1.1-inventory`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Inventario; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: backend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: pruebas unitarias del adapter, ZIP determinista y pruebas
SQL de stock, reserva, consumo e insuficiencia.

## Recepciones de órdenes de compra

`mastererp-dev-inventory-receipts` añade lectura y validación de órdenes mediante
la función controlada `administracion.purchase_read`, propiedad de Finanzas.
Expone listado y detalle, omitiendo importes en su respuesta. Requiere la
capacidad vigente `erp.finance / administration.purchases.read`. No registra
recepciones ni modifica existencias. El contrato de Compras DEV entrega
borradores sin aprobación/emisión ni producto de Catálogo por línea; por ello
la validación los marca como no aptos para recibir hasta que Finanzas publique
esos datos y se implemente el seguimiento de recepciones.

Validaciones: estructura local mediante `scripts/validate_structure.py`, E2E
Storefront y consistencia Pedido–Reserva. Los escritores legacy del corte están
retirados reversiblemente; el retiro físico requiere autorización separada.
