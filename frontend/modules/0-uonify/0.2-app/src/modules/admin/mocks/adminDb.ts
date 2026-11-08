import { collection, record } from '@/shared/mocks/db';
import { fail } from '@/shared/mocks/utils';
import { ledgerBalance } from '../model/finance';
import { formatMoney } from '../model/format';
import type { AuditEntry, AuditTarget, CustomerDetail, LedgerEntry, TeamMember } from '../model/types';
import { seedCustomers, seedLedger, type CustomerRecord } from './fixtures/customers';
import { seedCreditNotes, seedInvoices, seedWithdrawals } from './fixtures/finance';
import { seedAudit, seedProviders, TEAM } from './fixtures/operations';

/**
 * «Base de datos» del panel simulado (sessionStorage, prefijo uonify-mock:admin-*).
 * Sesión del panel separada de la de los clientes.
 */

export interface ChallengeRecord {
  id: string;
  email: string;
  code: string;
  expiresAt: string;
  resendAt: string;
  attempts: number;
  stage: 'email' | 'mfa' | 'used';
  mfaCode?: string;
  recoveryCode?: string;
}

export const MAX_ATTEMPTS = 5;
export const CODE_MINUTES = 10;
export const RESEND_SECONDS = 30;
export const SESSION_HOURS = 8;

export const db = {
  session: record<{ email: string | null; expiresAt: string | null }>('admin-session', () => ({ email: null, expiresAt: null })),
  challenges: collection<ChallengeRecord>('admin-challenges'),
  customers: collection<CustomerRecord>('admin-customers', seedCustomers),
  ledger: collection<LedgerEntry>('admin-ledger', seedLedger),
  providers: collection('admin-providers', seedProviders),
  audit: collection<AuditEntry>('admin-audit', seedAudit),
  invoices: collection('admin-invoices', seedInvoices),
  withdrawals: collection('admin-withdrawals', seedWithdrawals),
  creditNotes: collection('admin-credit-notes', seedCreditNotes),
};

/** Vuelve a la semilla (pruebas). */
export function resetAdminDb(): void {
  db.session.set({ email: null, expiresAt: null });
  db.challenges.reset();
  db.customers.reset();
  db.ledger.reset();
  db.providers.reset();
  db.audit.reset();
  db.invoices.reset();
  db.withdrawals.reset();
  db.creditNotes.reset();
}

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

/** Código de 6 cifras aleatorio (solo simulación). */
export function sixDigits(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function findMember(email: string): TeamMember | undefined {
  return TEAM.find(member => member.email === email);
}

/** Miembro de la sesión o null si no hay sesión válida. */
export function currentMember(): TeamMember | null {
  const { email, expiresAt } = db.session.get();
  if (!email || !expiresAt || new Date(expiresAt).getTime() < Date.now()) return null;
  return findMember(email) ?? null;
}

export function unauthenticated() {
  return fail(401, 'Tu sesión del panel ha caducado. Vuelve a entrar.', 'unauthenticated');
}

export function forbidden(message = 'Tu rol no permite hacer esto.') {
  return fail(403, message, 'forbidden');
}

export function logAudit(actor: TeamMember, action: string, target: AuditTarget, extra: { reason?: string; detail?: string } = {}): AuditEntry {
  const entry: AuditEntry = {
    id: newId('aud'),
    at: new Date().toISOString(),
    actor: { email: actor.email, name: actor.name },
    action,
    target,
    ...(extra.reason ? { reason: extra.reason } : {}),
    ...(extra.detail ? { detail: extra.detail } : {}),
  };
  db.audit.upsert(entry);
  return entry;
}

export function customerTarget(customer: CustomerRecord): AuditTarget {
  return { type: 'cliente', id: customer.id, label: customer.company };
}

export function ledgerOf(customerId: string): LedgerEntry[] {
  return db.ledger
    .all()
    .filter(entry => entry.customerId === customerId)
    .sort((a, b) => b.at.localeCompare(a.at));
}

export function balanceOf(customerId: string): number {
  return ledgerBalance(ledgerOf(customerId));
}

export function customerDetail(customer: CustomerRecord): CustomerDetail {
  const ledger = ledgerOf(customer.id);
  return { ...customer, ledger, balanceTokens: ledgerBalance(ledger) };
}

export function adjustmentDetail(entry: LedgerEntry): string {
  return formatMoney(entry.tokens, true);
}
