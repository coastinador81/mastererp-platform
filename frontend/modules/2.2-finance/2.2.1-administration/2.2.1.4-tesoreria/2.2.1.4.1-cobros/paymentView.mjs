export const money=(value,currency)=>new Intl.NumberFormat('es-VE',{style:'currency',currency}).format(Number(value));
export const date=value=>new Intl.DateTimeFormat('es-VE',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
export const method=value=>({mobile:'Pago móvil',mobile_payment:'Pago móvil',transfer:'Transferencia',bank_transfer:'Transferencia'}[value]||value);
export const withFinancialTrace=row=>row.order_status==='CANCELLED'&&row.payment?.status==='VALIDATED'&&!row.refund?{...row,financial_status:'REFUND_REQUIRED'}:row;
export const status=row=>({REFUND_REQUIRED:'Reembolso pendiente',REFUNDED:'Reembolsado',PAYMENT_VALIDATED:'Validado',PAYMENT_REJECTED:'Rechazado',PAYMENT_PENDING_REVIEW:'En espera de Finanzas'}[row.financial_status]||({PENDING_VERIFICATION:'En espera de Finanzas',VALIDATED:'Validado',REJECTED:'Rechazado'}[row.payment?.status]||row.payment?.status));
