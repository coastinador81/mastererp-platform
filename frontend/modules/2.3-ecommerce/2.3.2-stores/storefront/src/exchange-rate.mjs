export const BCV_RATE_URL = 'https://bcv.today/api/v1/rate.json';

export function parseExchangeRate(payload) {
  const rate = Number(payload?.USD);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return {
    base: 'USD', quote: 'VES', rate, source: 'bcv.today',
    effectiveDate: String(payload?.effective_date || payload?.date || ''),
    updatedAt: String(payload?.updated_at || ''),
  };
}

export async function loadCurrentExchangeRate(fetcher = fetch) {
  const response = await fetcher(BCV_RATE_URL, {headers:{Accept:'application/json'}});
  if (!response.ok) return null;
  return parseExchangeRate(await response.json());
}

export function formatVes(value) {
  return `${new Intl.NumberFormat('es-VE', {minimumFractionDigits:2, maximumFractionDigits:2}).format(value)} Bs`;
}
