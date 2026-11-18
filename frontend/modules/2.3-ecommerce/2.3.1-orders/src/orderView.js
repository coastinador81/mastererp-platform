export const STATUS = {
  PENDING: { label: 'Pendiente' },
  CONFIRMED: { label: 'Confirmado' },
  PREPARING: { label: 'En preparación' },
  READY: { label: 'Listo' },
  OUT_FOR_DELIVERY: { label: 'En ruta' },
  DELIVERED: { label: 'Entregado' },
  CANCELLED: { label: 'Cancelado' },
};

// Manual order actions; Preparación and Rutas own the later stages.
export const NEXT = { PENDING: ['CONFIRMED', 'CANCELLED'], CONFIRMED: ['CANCELLED'], PREPARING: ['CANCELLED'], READY: ['CANCELLED'] };
export const HANDOFF = {
  CONFIRMED: { title: 'Siguiente paso: iniciar la preparación', note: 'La preparación se inicia desde el módulo Preparación.', route: 'preparation', label: 'Ir a preparación', detail: true },
  PREPARING: { title: 'Pedido en preparación', note: 'Marca los productos y completa la preparación para dejarlo listo.', route: 'preparation', label: 'Continuar en preparación', detail: true },
  READY: { title: 'Listo para despacho', note: 'Asígnalo a una ruta para enviarlo al cliente.', route: 'routes', label: 'Ir a rutas' },
  OUT_FOR_DELIVERY: { title: 'Pedido en camino', note: 'La entrega se registra desde la ruta asignada.', route: 'routes', label: 'Ver rutas' },
};
export const FLOW = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'];
export const statusLabel = value => STATUS[value]?.label || 'Pendiente';
export const paymentMethodLabel=(value,payment)=>value==='custom'?(payment?.name||'Otro método'):({mobile_payment:'Pago móvil',mobile:'Pago móvil',bank_transfer:'Transferencia',transfer:'Transferencia',cash:'Efectivo',pos:'Punto de venta',card:'Tarjeta'}[value]||'Por confirmar');
export const paymentStatusLabel=value=>({PENDING_VERIFICATION:'En espera de validación de Finanzas',VALIDATED:'Pago validado por Finanzas',REJECTED:'Pago rechazado por Finanzas',PENDING_COLLECTION:'Pendiente de cobro',REFUNDED:'Reembolsado por Finanzas'}[value]||'Pendiente');
export const money = (value, currency = 'USD') => new Intl.NumberFormat('es-VE', { style: 'currency', currency }).format(Number(value || 0));
export const dateTime = value => value ? new Intl.DateTimeFormat('es-VE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Sin fecha';
export function returnableItems(order,records=[]){
  const reserved=new Map();
  records.filter(record=>record.status!=='REJECTED').forEach(record=>(record.items||[]).forEach(item=>reserved.set(item.order_item_id,(reserved.get(item.order_item_id)||0)+Number(item.requested_quantity||0))));
  return (order.items||[]).map(item=>({...item,returnable_quantity:Math.max(0,Number(item.quantity||0)-(reserved.get(item.id)||0))})).filter(item=>item.returnable_quantity>0);
}
const EVENT_LABELS={STOREFRONT_CHECKOUT:'Pedido realizado en la tienda',PAYMENT_VALIDATED:'Pago validado',ORDER_REFUNDED:'Reembolso y nota de crédito registrados',PREPARATION_STARTED:'Preparación iniciada',PREPARATION_COMPLETED:'Preparación completada',ORDER_CREATED:'Pedido creado',ORDER_CONFIRMED:'Pedido confirmado',MANUAL_OPERATION:'Pedido cancelado manualmente','Manual operation':'Pedido cancelado manualmente',ROUTE_STARTED:'Ruta iniciada',DELIVERY_FAILED:'Entrega no realizada',DELIVERY_COMPLETED:'Entrega completada',DELIVERY_ADDRESS_CORRECTED:'Dirección de entrega corregida',RETURN_REQUESTED:'Devolución solicitada',RETURN_AUTHORIZED:'Devolución autorizada',RETURN_REJECTED:'Devolución rechazada',RETURN_RECEIVED:'Devolución recibida e inventario registrado',RETURN_COMPLETED:'Reembolso y nota de crédito registrados'};
export const eventReasonLabel=value=>EVENT_LABELS[value]||String(value||'Actualización del pedido').replaceAll('_',' ').toLocaleLowerCase('es-VE').replace(/^./,letter=>letter.toLocaleUpperCase('es-VE'));
export function operationalHistory(history=[],attempts=[],returns=[]){
  const events=history.filter(event=>!['DELIVERY_FAILED','DELIVERY_COMPLETED'].includes(event.reason)).map(event=>event.reason==='ROUTE_STARTED'&&/^[0-9a-f-]{36}$/i.test(event.detail||'')?{...event,route_id:event.detail,detail:''}:event);
  const deliveries=attempts.map((attempt,index)=>({id:`route-${attempt.route_id}-${index}`,status:attempt.status,reason:attempt.status==='DELIVERED'?'DELIVERY_COMPLETED':'DELIVERY_FAILED',detail:attempt.evidence?.reason||'',actor_name:attempt.driver_name,created_at:attempt.evidence?.recorded_at||attempt.updated_at,route_id:attempt.route_id,source:'routes'}));
  const returnEvents=returns.flatMap(record=>(record.history||[]).map(event=>({id:`return-${record.id}-${event.id}`,status:event.status,reason:`RETURN_${event.status}`,detail:event.detail,actor_name:event.actor_name,created_at:event.created_at,source:'returns'})));
  return [...events,...deliveries,...returnEvents].sort((left,right)=>new Date(left.created_at).getTime()-new Date(right.created_at).getTime());
}
