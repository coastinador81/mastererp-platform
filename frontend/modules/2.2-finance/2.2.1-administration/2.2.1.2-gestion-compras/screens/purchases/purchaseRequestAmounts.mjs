export function parsePurchaseDecimal(value, precision) {
  if (!/^\d{1,18}(?:\.\d+)?$/.test(value)) return null;
  const [integer, fraction = ''] = value.split('.');
  if (fraction.length > precision) return null;
  return BigInt(integer + fraction.padEnd(precision, '0'));
}

export function purchaseLineTotal(line, digits) {
  const quantity = parsePurchaseDecimal(line.cantidad, 6);
  const price = parsePurchaseDecimal(line.precio_unitario, 6);
  if (quantity === null || quantity === 0n || price === null) return {amount: null, precisionError: false};
  const scaled = quantity * price;
  const divisor = 10n ** BigInt(12 - digits);
  if (scaled % divisor !== 0n) return {amount: null, precisionError: true};
  return {amount: scaled / divisor, precisionError: false};
}

export function purchaseMoney(amount, digits, currency) {
  if (amount === null) return 'Pendiente';
  const divisor = 10n ** BigInt(digits);
  const integer = new Intl.NumberFormat('es-VE').format(amount / divisor);
  const fraction = digits ? ',' + String(amount % divisor).padStart(digits, '0') : '';
  return integer + fraction + ' ' + (currency === 'VES' ? 'Bs.' : currency);
}

export function purchaseEquivalent(total, rate, digits, baseDigits) {
  const factor = parsePurchaseDecimal(rate, 12);
  if (total === null || factor === null || factor === 0n) return null;
  const divisor = 10n ** BigInt(12 + digits - baseDigits);
  return (total * factor + divisor / 2n) / divisor;
}
