export function paymentExchange(payment = {}) {
  return {
    rate: String(payment.exchangeRate || ''),
    date: String(payment.exchangeRateEffectiveDate || ''),
    source: String(payment.exchangeRateSource || ''),
  };
}
