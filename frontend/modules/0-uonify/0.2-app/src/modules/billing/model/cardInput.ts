/** Máscaras locales: conservan la posición de edición por número de dígitos. */
export function formatCardField(value: string, position: number, kind: 'number' | 'expiry' | 'cvc') {
  const before = value.slice(0, position).replace(/\D/g, '').length;
  const digits = value.replace(/\D/g, '').slice(0, kind === 'number' ? 16 : kind === 'cvc' ? 3 : 4);
  const formatted = kind === 'number'
    ? (digits.match(/.{1,4}/g) ?? []).join(' ')
    : kind === 'expiry' && digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
  let caret = 0;
  let seen = 0;
  while (caret < formatted.length && seen < before) {
    if (/\d/.test(formatted[caret])) seen++;
    caret++;
  }
  return { value: formatted, caret };
}
