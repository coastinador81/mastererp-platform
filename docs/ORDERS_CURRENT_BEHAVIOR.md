# Pedidos: comportamiento actual y límites de responsabilidad

Este documento describe los contratos vigentes de `2.3.1-orders`; no concede
permisos ni sustituye la validación funcional en DEV.

## Alcance y propietarios

- **Pedidos** conserva pedido, líneas, snapshots, estado, notas, correcciones e historial consolidado.
- **Inventario** emite y consume reservas, registra movimientos y reintegros.
- **Finanzas** valida pagos, registra ventas, procesa reembolsos y emite o vincula documentos fiscales.
- **Preparación** conserva el avance físico anterior a la entrega.
- **Rutas** conserva asignación, parada, repartidor y evidencia de cada intento.

Todo acceso se delimita por identidad, `tenant_id`, `empresa_id`, permisos y,
cuando aplica, nodo o sucursal. La interfaz nunca concede permisos.

## Creación, pago y preparación

El checkout resuelve tienda, identidad, productos, precios, dirección y pago en
backend. La creación requiere una reserva opaca de Inventario e idempotencia.
Los snapshots son históricos: cambios posteriores del cliente no los reescriben.

Los pagos electrónicos permanecen pendientes hasta que Finanzas los valida. La
confirmación crea o vincula la venta mediante su contrato financiero. El flujo
normal es `PENDING → CONFIRMED → PREPARING → READY → OUT_FOR_DELIVERY → DELIVERED`.
Preparación consume la reserva cuando todas las líneas quedan listas.

## Entrega, evidencia e historial

Rutas solo toma pedidos elegibles. Al iniciar una ruta, sus pedidos pasan a «En
ruta». Una parada entregada cierra el pedido; una parada fallida registra el
intento y devuelve el pedido a listo para una nueva asignación. La ruta se
completa cuando todas sus paradas están cerradas.

La ficha consulta evidencia de Rutas: resultado, ruta, parada, fecha, repartidor,
motivo, observaciones, coordenadas, precisión y distancia disponibles. El
historial consolida eventos persistidos por Pedidos, Finanzas, Preparación y
Rutas con actor, fecha y referencias. El navegador no fabrica eventos.

## Dirección, notas y cancelación

`operations.orders.address.correct` corrige únicamente el snapshot operativo en
estado seguro y sin ruta activa. Exige permiso, versión optimista, motivo,
coordenadas válidas y auditoría; no modifica la libreta del cliente.

Las notas son persistentes e idempotentes. La cancelación previa al despacho
coordina pedido, reserva y venta vinculada en una transacción. No se permite
cancelar una entrega consumada.

## Comprobante y factura fiscal

Cada intento entregado permite descargar un PDF operativo con identidad
empresarial disponible, pedido, ruta, parada, repartidor, ubicación,
observaciones, productos y total. Se deriva de evidencia real de Rutas y se
rotula como no fiscal.

Pedidos no emite facturas fiscales. Finanzas es responsable de numeración,
datos fiscales, impuestos, inmutabilidad, proveedor autorizado, anulaciones y
notas de crédito. Pedidos solo mostrará el documento autorizado por Finanzas.

## Devoluciones y reembolsos

La primera etapa es exclusivamente administrativa:

1. Personal autorizado solicita desde un pedido entregado, con motivo y cantidades.
2. Otro permiso autoriza o rechaza.
3. Almacén registra recepción, condición y nodo.
4. Inventario reintegra únicamente unidades recibidas aptas para venta.
5. Finanzas procesa el reembolso y genera o vincula la nota de crédito.
6. El expediente se completa solo cuando ambas referencias financieras existen.

Estados: `REQUESTED`, `AUTHORIZED`, `REJECTED`, `RECEIVED`, `COMPLETED`. Cada
transición conserva actor, fecha, detalle y correlación. Se admiten parciales
sin superar cantidades entregadas ni ya autorizadas. Solicitud desde Storefront
queda fuera de esta etapa y podrá ser una opción posterior por empresa o tienda.

## Errores y validación

- `400 invalid_request`: datos incompletos o fuera de formato.
- `403 forbidden`: alcance o permiso no autorizado.
- `404 not_found`: recurso inexistente dentro del alcance.
- `409 stale_version`: modificación concurrente.
- `409 invalid_transition`: estado o cantidad incompatible.
- `409 idempotency_conflict`: clave reutilizada con otro contenido.

Compilar no cierra un flujo. Cada corte requiere pruebas focalizadas, workflow
oficial y prueba funcional DEV con permisos reales. Finanzas e Inventario deben
validar además sus respectivos efectos.
