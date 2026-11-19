export function formatVes(value) {
  return `${new Intl.NumberFormat('es-VE', {minimumFractionDigits:2, maximumFractionDigits:2}).format(value)} Bs`;
}
