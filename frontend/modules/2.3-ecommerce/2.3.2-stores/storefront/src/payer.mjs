export function cleanPayer(method, payer = {}) {
  const phone = String(payer.phone || '').replace(/\D/g, '');
  const holder = String(payer.holder || '').trim();
  return {
    bankCode: String(payer.bankCode || '').trim(),
    document: String(payer.document || '').replace(/\s/g, '').toUpperCase(),
    phone: method === 'mobile' || phone ? phone : undefined,
    holder: method === 'transfer' && holder ? holder : undefined,
  };
}

export function payerError(method, payer) {
  if (method === 'cash') return '';
  if (!/^\d{4}$/.test(payer.bankCode)) return 'Indica el código de 4 dígitos de tu banco.';
  if (!/^[VEJGP]-?\d{5,12}$/.test(payer.document)) return 'Indica tu cédula o RIF, por ejemplo V12345678.';
  if (method === 'mobile' && !/^0\d{10}$/.test(payer.phone || '')) return 'Indica el teléfono desde el que pagas, por ejemplo 04121234567.';
  if (payer.holder && (payer.holder.length < 2 || payer.holder.length > 120)) return 'Revisa el nombre del titular.';
  return '';
}
