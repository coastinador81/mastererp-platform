import { googleBillingCalendarDate, googleBillingDate, googleBillingPeriod, googleMoney, verifiedGoogleSnapshot } from '../model/googleBilling';
import type { GoogleBillingSnapshot } from '../api/googleBilling';

export const billingSnapshot: GoogleBillingSnapshot = { status: 'available', accountEmail: 'billing@example.test',
  projectId: 'project-a', projectName: 'Uonify', billingAccountName: 'billingAccounts/ABC-DEF', currency: 'EUR',
  creditEUR: '230.74', consumptionEUR: '1.98', netConsumptionEUR: '0.00', consumptionScope: 'billing_account',
  periodStart: '2026-10-01', periodEnd: '2026-10-15', observedAt: '2026-10-15T09:20:30Z',
  recordedAt: '2026-10-15T09:21:40Z', checkedAt: '2026-10-16T10:00:00Z', creditExpiresAt: null,
  source: { kind: 'observed_google_console', url: 'https://console.cloud.google.com/billing', live: false },
  reason: null, message: 'Datos registrados de Google.' };

it('el dinero se conserva en euros sin convertir monedas, estimar ni sustituir desconocidos por cero', () => {
  expect(googleMoney('230.74', 'EUR')).toBe('230,74 €');
  expect(googleMoney('0.00', 'EUR')).toBe('0,00 €');
  expect(googleMoney(null, 'EUR')).toBeNull();
  expect(googleMoney('12.00', 'USD')).toBeNull();
  expect(googleMoney('1.234', 'EUR')).toBeNull();
});
it('muestra el periodo comprobado y rechaza periodos imposibles o invertidos', () => {
  expect(googleBillingPeriod('2026-10-01', '2026-10-15')).toBe('1–15 de octubre de 2026');
  expect(googleBillingPeriod('2026-10-15', '2026-10-01')).toBeNull();
  expect(googleBillingPeriod('2026-02-30', '2026-03-01')).toBeNull();
  expect(googleBillingPeriod(null, null)).toBeNull();
});
it('solo admite comprobaciones con origen y fechas observada/registrada reales', () => {
  expect(verifiedGoogleSnapshot(billingSnapshot)).toBe(billingSnapshot);
  expect(verifiedGoogleSnapshot({ ...billingSnapshot, source: null })).toBeNull();
  expect(verifiedGoogleSnapshot({ ...billingSnapshot, observedAt: null })).toBeNull();
  expect(verifiedGoogleSnapshot({ ...billingSnapshot, recordedAt: null })).toBeNull();
  expect(verifiedGoogleSnapshot({ ...billingSnapshot, status: 'unavailable' })).toBeNull();
  expect(googleBillingDate('fecha inválida')).toBeNull();
});
it('la caducidad indicada por día conserva el calendario sin añadir una hora desconocida', () => {
  expect(googleBillingCalendarDate('2027-01-05')).toBe('5 de enero de 2027');
  expect(googleBillingCalendarDate('2027-02-30')).toBeNull();
  expect(googleBillingCalendarDate(null)).toBeNull();
});
