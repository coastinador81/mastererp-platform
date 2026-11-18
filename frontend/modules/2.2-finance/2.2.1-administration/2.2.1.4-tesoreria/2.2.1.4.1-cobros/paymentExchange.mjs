export function paymentExchange(payment = {}) {
  return {
    rate: String(payment.exchangeRate || ''),
    date: String(payment.exchangeRateEffectiveDate || ''),
    source: String(payment.exchangeRateSource || ''),
  };
}

export const withFinancialTrace=row=>row.order_status==='CANCELLED'&&row.payment?.status==='VALIDATED'?{...row,financial_status:'REFUND_REQUIRED'}:row;
