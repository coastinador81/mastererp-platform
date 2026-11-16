export const BCV_RATE_URL = 'https://bcv.today/api/v1/rate.json';

export function parseBcvRate(payload) {
  const rate = Number(payload?.USD);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return {
    rate,
    effectiveDate: String(payload?.effective_date || payload?.date || ''),
  };
}

export function formatBcvRate(rate) {
  return new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(rate);
}

export function millisecondsUntilNextBcvRefresh(now = new Date()) {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const candidates = [day + 13 * 3600000 + 5 * 60000, day + 18 * 3600000 + 5 * 60000];
  const next = candidates.find(candidate => candidate > now.getTime())
    ?? day + 86400000 + 13 * 3600000 + 5 * 60000;
  return next - now.getTime();
}
