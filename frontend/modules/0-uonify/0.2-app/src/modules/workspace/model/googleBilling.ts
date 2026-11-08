import type { GoogleAutomaticBillingSource, GoogleBillingSnapshot, GoogleBillingSync } from '../api/googleBilling';

export const GOOGLE_REPORT_DOCUMENTATION = 'https://docs.cloud.google.com/app-optimize/optimization-data';

export function googleMoney(value: string | null, currency: string | null): string | null {
  if (currency !== 'EUR' || value === null || !/^-?\d+(\.\d{1,2})?$/.test(value)) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(amount) : null;
}
export function googleBillingDate(value: string | null): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat('es-ES', { year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(new Date(value));
}
function dateOnly(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return date.toISOString().slice(0, 10) === value ? date : null;
}
export function googleBillingCalendarDate(value: string | null | undefined): string | null {
  const date = dateOnly(value ?? null);
  return date ? new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date) : null;
}
export function googleBillingPeriod(start: string | null, end: string | null): string | null {
  const from = dateOnly(start), to = dateOnly(end);
  if (!from || !to || from > to) return null;
  if (from.getUTCFullYear() === to.getUTCFullYear() && from.getUTCMonth() === to.getUTCMonth()) {
    const month = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(to);
    return `${from.getUTCDate()}–${to.getUTCDate()} de ${month}`;
  }
  const formatter = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${formatter.format(from)} – ${formatter.format(to)}`;
}
export function verifiedGoogleSnapshot(data: GoogleBillingSnapshot | undefined): GoogleBillingSnapshot | null {
  if (!data || !['available', 'stale'].includes(data.status) || data.currency !== 'EUR'
    || !googleBillingDate(data.observedAt) || !googleBillingDate(data.recordedAt)) return null;
  const observed = data.source?.kind === 'observed_google_console' && data.source.live === false;
  const automatic = verifiedAutomaticSource(data.source) && data.consumptionScope === 'project'
    && googleMoney(data.consumptionEUR, data.currency) !== null && googleReportPeriod(data.periodStart, data.periodEnd) !== null;
  return observed || automatic ? data : null;
}

export function verifiedAutomaticSource(source: GoogleBillingSnapshot['source']): source is GoogleAutomaticBillingSource {
  return source?.kind === 'google_app_optimize' && source.live === true && source.scope === 'project'
    && source.costBasis === 'gross_before_credits' && source.url === GOOGLE_REPORT_DOCUMENTATION;
}
export function verifiedGoogleSync(data: GoogleBillingSnapshot | undefined): GoogleBillingSync | null {
  const sync = data?.sync;
  return sync && sync.projectId === data.projectId && sync.billingAccountName === data.billingAccountName
    && ['needs_setup', 'pending', 'ready', 'no_records', 'error'].includes(sync.status) ? sync : null;
}
export function googleReportPeriod(start: string | null, end: string | null): string | null {
  if (!googleBillingDate(start) || !googleBillingDate(end) || Date.parse(start!) > Date.parse(end!)) return null;
  const calendar = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
  const period = googleBillingPeriod(calendar.format(new Date(start!)), calendar.format(new Date(end!)));
  return period ? `${period} · hora de Google` : null;
}
export function verifiedGoogleCredit(data: GoogleBillingSnapshot | null): { amount: string; observedAt: string; stale: boolean } | null {
  if (!data) return null;
  const automatic = verifiedAutomaticSource(data.source);
  const observedAt = automatic ? data.creditObservedAt ?? null : data.observedAt;
  const source = automatic ? data.creditSource : data.source;
  const amount = googleMoney(data.creditEUR, data.currency);
  if (!amount || !observedAt || !googleBillingDate(observedAt) || source?.kind !== 'observed_google_console' || source.live !== false) return null;
  return { amount, observedAt, stale: automatic ? data.creditStale === true : data.status === 'stale' };
}

/** La acción usa exclusivamente la cuenta de facturación comprobada por el servidor. */
export function verifiedGoogleBillingLinks(data: GoogleBillingSnapshot | undefined): GoogleBillingSnapshot['consoleLinks'] {
  if (!data?.consoleLinks || typeof data.consoleLinks.credits !== 'string' || typeof data.consoleLinks.reports !== 'string'
    || !data.billingAccountName || !/^billingAccounts\/[A-Za-z0-9-]+$/.test(data.billingAccountName)) return null;
  const root = `/billing/${data.billingAccountName.split('/')[1]}`;
  for (const [kind, value] of Object.entries(data.consoleLinks)) {
    if (!['credits', 'reports'].includes(kind)) return null;
    try {
      const url = new URL(value);
      if (url.origin !== 'https://console.cloud.google.com' || url.pathname !== `${root}/${kind}`
        || url.hash || url.username || url.password || [...url.searchParams.keys()].some(key => !['authuser', 'project'].includes(key))
        || url.searchParams.get('authuser') !== data.accountEmail || url.searchParams.get('project') !== data.projectId) return null;
    } catch { return null; }
  }
  return data.consoleLinks;
}
