import { api } from '@/shared/api/client';
import type {
  AdjustmentCategory,
  AdjustmentResult,
  AdminInvoice,
  AdminMetrics,
  AdminSession,
  AiProvider,
  AuditEntry,
  AuditEventInput,
  CreditNote,
  CustomerDetail,
  CustomerSummary,
  EmailChallenge,
  InternalNote,
  MetricsRange,
  MfaChallenge,
  MfaMethod,
  ProviderId,
  ProviderPatch,
  SuspendReason,
  Withdrawal,
} from '../model/types';

/**
 * API de administración (/api/admin/*), la única que simula este módulo. Contrato
 * completo en README.md. La sesión del panel es una cookie propia, separada de la de
 * los clientes; todas las rutas salvo /admin/auth/* responden 401 sin ella.
 */

// ── Acceso del equipo ───────────────────────────────────────────────────────

export const adminAuthApi = {
  session: () => api.get<AdminSession>('/admin/auth/session'),
  /** Acceso simple local/desarrollo (correo + contraseña); el 2FA vuelve en producción. */
  password: (email: string, password: string) => api.post<AdminSession>('/admin/auth/password', { email, password }),
  startEmail: (email: string) => api.post<EmailChallenge>('/admin/auth/email/start', { email }),
  resendEmail: (challengeId: string) => api.post<EmailChallenge>('/admin/auth/email/resend', { challengeId }),
  verifyEmail: (challengeId: string, code: string) => api.post<MfaChallenge>('/admin/auth/email/verify', { challengeId, code }),
  verifyMfa: (mfaChallengeId: string, method: MfaMethod, code: string) =>
    api.post<AdminSession>('/admin/auth/mfa/verify', { mfaChallengeId, method, code }),
  logout: () => api.post<{ ok: true }>('/admin/auth/logout'),
};

// ── Resumen ─────────────────────────────────────────────────────────────────

export const fetchMetrics = (range: MetricsRange) => api.get<AdminMetrics>('/admin/metrics', { params: { range } });

// ── Clientes ────────────────────────────────────────────────────────────────

export const customersApi = {
  search: (q: string, status?: string) =>
    api.get<{ customers: CustomerSummary[] }>('/admin/customers', { params: { q: q || undefined, status: status || undefined } }).then(r => r.customers),
  get: (id: string) => api.get<{ customer: CustomerDetail }>(`/admin/customers/${encodeURIComponent(id)}`).then(r => r.customer),
  suspend: (id: string, category: SuspendReason, reason: string) =>
    api.post<{ customer: CustomerDetail }>(`/admin/customers/${encodeURIComponent(id)}/suspend`, { category, reason }).then(r => r.customer),
  reactivate: (id: string, reason: string) =>
    api.post<{ customer: CustomerDetail }>(`/admin/customers/${encodeURIComponent(id)}/reactivate`, { reason }).then(r => r.customer),
  setAiBlocked: (id: string, blocked: boolean, reason: string) =>
    api.post<{ customer: CustomerDetail }>(`/admin/customers/${encodeURIComponent(id)}/ai-block`, { blocked, reason }).then(r => r.customer),
  adjustBalance: (id: string, input: { tokens: number; category: AdjustmentCategory; reason: string }) =>
    api.post<AdjustmentResult>(`/admin/customers/${encodeURIComponent(id)}/balance-adjustments`, input),
  approveAdjustment: (id: string, entryId: string) =>
    api.post<AdjustmentResult>(`/admin/customers/${encodeURIComponent(id)}/balance-adjustments/${encodeURIComponent(entryId)}/approve`),
  addNote: (id: string, text: string) =>
    api.post<{ note: InternalNote }>(`/admin/customers/${encodeURIComponent(id)}/notes`, { text }).then(r => r.note),
};

// ── Proveedores de IA ───────────────────────────────────────────────────────

export const providersApi = {
  list: () => api.get<{ providers: AiProvider[] }>('/admin/providers').then(r => r.providers),
  update: (id: ProviderId, patch: ProviderPatch) =>
    api.patch<{ provider: AiProvider }>(`/admin/providers/${id}`, patch).then(r => r.provider),
};

// ── Auditoría ───────────────────────────────────────────────────────────────

export const auditApi = {
  list: (filters: { q?: string; action?: string; actor?: string }) =>
    api.get<{ entries: AuditEntry[] }>('/admin/audit', { params: { q: filters.q || undefined, action: filters.action || undefined, actor: filters.actor || undefined } }).then(r => r.entries),
  /**
   * Anota una acción hecha con los endpoints de billing o help (precios, artículos,
   * tickets). El backend real la registra él mismo al recibir la llamada con la
   * sesión del panel; esta llamada solo cubre la simulación.
   */
  record: (event: AuditEventInput) => api.post<{ entry: AuditEntry }>('/admin/audit/events', event).then(r => r.entry),
};

// ── Facturación ─────────────────────────────────────────────────────────────

export const financeApi = {
  invoices: (q: string, status?: string) =>
    api.get<{ invoices: AdminInvoice[] }>('/admin/finance/invoices', { params: { q: q || undefined, status: status || undefined } }).then(r => r.invoices),
  withdrawals: () => api.get<{ withdrawals: Withdrawal[] }>('/admin/finance/withdrawals').then(r => r.withdrawals),
  retryWithdrawal: (id: string, reason: string) =>
    api.post<{ withdrawal: Withdrawal }>(`/admin/finance/withdrawals/${encodeURIComponent(id)}/retry`, { reason }).then(r => r.withdrawal),
  creditNotes: () => api.get<{ creditNotes: CreditNote[] }>('/admin/finance/credit-notes').then(r => r.creditNotes),
};

// ── Soporte: borrador de respuesta con Uony ────────────────────────────────

export const draftReplyWithUony = (input: { ticketId: string; subject: string; lastMessage: string; customerName: string }) =>
  api.post<{ draft: string }>('/admin/support/reply-draft', input).then(r => r.draft);
