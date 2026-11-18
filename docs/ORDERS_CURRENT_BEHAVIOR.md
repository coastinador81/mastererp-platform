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
Todo pedido nuevo completa el snapshot del cliente, dentro del mismo tenant y
empresa, con nombre, correo y teléfono disponibles al momento de crearlo. Si un
dato no existe, la ficha lo indica explícitamente sin consultar ni mezclar otro
cliente o empresa.

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
historial consolida eventos persistidos por Pedidos, Finanzas, Preparación,
Rutas y Devoluciones con actor, fecha y referencias. El navegador no fabrica
eventos.

En la ficha, el contenido operativo aparece en el orden Productos, Historial,
Devoluciones e Intentos de entrega. Los tres últimos usan el mismo componente
de acordeón, cerrado inicialmente, con cabecera, relleno y estados vacíos
consistentes para evitar una página innecesariamente extensa.

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

La interfaz administrativa implementa los pasos 1 a 4. Tras la recepción
muestra «Pendiente de Finanzas» y no permite escribir identificadores libres.
El paso 5 depende del contrato financiero real de factura/nota de crédito; el
endpoint de coordinación permanece protegido por `administration.returns.settle`.

Estados: `REQUESTED`, `AUTHORIZED`, `REJECTED`, `RECEIVED`, `COMPLETED`. Cada
transición conserva actor, fecha, detalle y correlación. Se admiten parciales
sin superar cantidades entregadas ni ya autorizadas. Solicitud desde Storefront
queda fuera de esta etapa y podrá ser una opción posterior por empresa o tienda.

La ficha calcula la cantidad todavía retornable por línea descontando todos los
expedientes no rechazados. Oculta «Nueva devolución» cuando no queda ninguna
unidad disponible y, en devoluciones parciales, limita cada campo al remanente.
El backend conserva la misma regla como autoridad y responde
`invalid_transition` ante una carrera o un cliente desactualizado.

Pedidos, Rutas, Mi ruta y Repartidores usan la notificación flotante compartida.
Los mensajes permanecen visibles hasta que el usuario los cierre, no dependen
del scroll y traducen códigos técnicos conocidos a instrucciones legibles.

### Cierre funcional del punto 8

El alcance de Pedidos quedó validado funcionalmente en DEV el 18 de noviembre
de 2026: solicitud, autorización, recepción, condición, reintegro apto a
Inventario, expediente, historial y bloqueo de cantidades ya comprometidas.
La prueba real terminó correctamente en `RECEIVED` y mostró «Pendiente de
Finanzas». Esto cierra el punto 8 dentro de Pedidos.

`COMPLETED` no se simula desde Ecommerce. Finanzas debe crear o vincular el
egreso y la nota de crédito reales del mismo `tenant_id`, empresa, cliente,
pedido y devolución. Esa conciliación es una dependencia financiera separada,
no un pendiente de la recepción gestionada por Pedidos.

## Punto 9: cancelaciones por etapa

Estado auditado al iniciar el punto 9:

| Etapa solicitada | Estado actual | Resultado vigente |
| --- | --- | --- |
| Pago pendiente | Pedido `PENDING` | Cancelación coordinada disponible. |
| Pago rechazado | Pedido `PENDING` con pago `REJECTED` | Usa el mismo contrato; falta prueba específica. |
| Confirmado | `CONFIRMED` | Disponible antes de preparación; coordina reserva y venta. |
| Preparación | `PREPARING` | El dominio la enumera, pero PostgreSQL la rechaza. |
| Listo | `READY` | No existe cancelación coordinada. |
| En ruta | `OUT_FOR_DELIVERY` | No existe cancelación coordinada con parada, ruta y conductor. |

El punto 9 no está cerrado. La matriz debe definir y probar por etapa: permiso,
motivo, versión, idempotencia, efectos en reserva/Inventario, preparación,
venta/Finanzas, parada/ruta, disponibilidad del repartidor, historial y
reintento. Ninguna etapa puede resolverse mediante escrituras directas o
dejando efectos parciales.

Política aprobada e implementada en el candidato local `066`:

- `PENDING`, incluido pago pendiente o rechazado: cancelar, liberar reserva y
  no crear efectos financieros nuevos.
- `CONFIRMED`: cancelar antes de preparación, liberar reserva y coordinar la
  anulación de la venta sin exigir al operador permisos internos de Finanzas.
- `PREPARING`: cancelar preparación y pedido en la misma transacción, liberar
  la reserva todavía no consumida y conservar el avance en auditoría.
- `READY`: sólo cancelar con reversión explícita de las unidades preparadas al
  nodo original y movimiento de Inventario trazable.
- `OUT_FOR_DELIVERY`: no cancelar administrativamente mientras la mercancía
  siga en ruta. Debe cerrarse la parada como no entregada y registrarse la
  devolución física antes de reintegrar existencias o cancelar definitivamente.

La UI local sólo ofrece `CANCELLED` hasta `READY`. PostgreSQL conserva la
autoridad y vuelve a comprobar estado, versión y efectos coordinados. El punto 9
seguirá abierto hasta aplicar el candidato mediante workflow y ejecutar la
matriz funcional autenticada en DEV.

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
