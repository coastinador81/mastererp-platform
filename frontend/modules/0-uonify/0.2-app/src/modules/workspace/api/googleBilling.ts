import { api } from '@/shared/api/client';

export interface GoogleAutomaticBillingSource {
  kind: 'google_app_optimize'; url: string; live: true; scope: 'project'; costBasis: 'gross_before_credits';
}
export interface GoogleObservedBillingSource { kind: 'observed_google_console'; url: string; live: false }
export interface GoogleBillingSync {
  status: 'needs_setup' | 'pending' | 'ready' | 'no_records' | 'error';
  projectId: string; billingAccountName: string;
  canSync: boolean; nextCheckAt: string | null; checkedAt: string | null;
  periodStart: string; periodEnd: string; consumptionEUR: string | null; currency: 'EUR' | null;
  source: GoogleAutomaticBillingSource | null; reason: string | null; message: string;
}
export interface GoogleBillingSyncResponse {
  accountEmail: string; projectId: string; billingAccountName: string; sync: GoogleBillingSync;
}
export interface GoogleBillingSnapshot {
  status: 'available' | 'stale' | 'unavailable';
  accountEmail: string;
  projectId: string | null;
  projectName: string | null;
  billingAccountName: string | null;
  currency: 'EUR' | null;
  creditEUR: string | null;
  consumptionEUR: string | null;
  netConsumptionEUR?: string | null;
  consumptionScope: 'billing_account' | 'project';
  periodStart: string | null;
  periodEnd: string | null;
  observedAt: string | null;
  recordedAt: string | null;
  checkedAt: string;
  creditExpiresAt: string | null;
  creditExpiresOn?: string | null;
  source: GoogleObservedBillingSource | GoogleAutomaticBillingSource | null;
  creditObservedAt?: string | null;
  creditSource?: GoogleObservedBillingSource | null;
  creditStale?: boolean;
  sync?: GoogleBillingSync | null;
  reason: string | null;
  message: string;
  billingVerified?: boolean;
  consoleLinks?: { credits: string; reports: string } | null;
}
export interface BillingCloudConnection {
  connection: { status: string; email?: string; projectId?: string | null; projectName?: string | null };
  accessAllowed: boolean;
}
export function getGoogleBilling(signal: AbortSignal): Promise<GoogleBillingSnapshot> {
  return api.get<GoogleBillingSnapshot>('/uony/google-billing', { signal });
}
export function syncGoogleBilling(prepare: boolean, signal: AbortSignal): Promise<GoogleBillingSyncResponse> {
  return api.post<GoogleBillingSyncResponse>('/uony/google-billing/sync', { prepare }, { signal });
}
export function getBillingCloudConnection(signal: AbortSignal): Promise<BillingCloudConnection> {
  return api.get<BillingCloudConnection>('/connections/google-cloud', { signal });
}
