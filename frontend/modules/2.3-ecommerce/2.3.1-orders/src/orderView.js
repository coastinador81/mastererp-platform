export const STATUS = {
  PENDING: { label: 'Pendiente' },
  CONFIRMED: { label: 'Confirmado' },
  PREPARING: { label: 'En preparación' },
  READY: { label: 'Listo' },
  OUT_FOR_DELIVERY: { label: 'En ruta' },
  DELIVERED: { label: 'Entregado' },
  CANCELLED: { label: 'Cancelado' },
};

export const NEXT = {
  PENDING: ['CONFIRMED', 'CANCELLED'], CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'], READY: ['OUT_FOR_DELIVERY'], OUT_FOR_DELIVERY: ['DELIVERED'],
};
export const FLOW = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'];
export const statusLabel = value => STATUS[value]?.label || 'Pendiente';
export const paymentMethodLabel=(value,payment)=>value==='custom'?(payment?.name||'Otro método'):({mobile_payment:'Pago móvil',mobile:'Pago móvil',bank_transfer:'Transferencia',transfer:'Transferencia',cash:'Efectivo',pos:'Punto de venta',card:'Tarjeta'}[value]||'Por confirmar');
export const paymentStatusLabel=value=>({PENDING_VERIFICATION:'Pendiente de validación',VALIDATED:'Validado',REJECTED:'Rechazado',PENDING_COLLECTION:'Pendiente de cobro'}[value]||'Pendiente');
export const money = (value, currency = 'USD') => new Intl.NumberFormat('es-VE', { style: 'currency', currency }).format(Number(value || 0));
export const dateTime = value => value ? new Intl.DateTimeFormat('es-VE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Sin fecha';
