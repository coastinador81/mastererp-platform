/**
 * Tipos del panel de administración. Las formas de /admin/* son el contrato con el
 * backend (README.md del módulo); las de billing y help se normalizan en normalize.ts.
 */

// ── Equipo y acceso ──────────────────────────────────────────────────────────

export type AdminRole = 'superadmin' | 'operaciones' | 'soporte' | 'finanzas' | 'lectura';

export interface TeamMember {
  email: string;
  name: string;
  role: AdminRole;
}

export interface AdminSession {
  authenticated: boolean;
  member?: TeamMember;
  expiresAt?: string;
  /** Modo de acceso que dicta el backend: «password» (simple) o «mfa» (código + 2FA). */
  authMode?: 'password' | 'mfa';
  /** Alias: true cuando el acceso simple por contraseña está activo. */
  passwordLogin?: boolean;
}

/** Solo lo envía la simulación: texto de ayuda con el código de prueba. */
export interface PreviewHint {
  message: string;
}

export interface EmailChallenge {
  challengeId: string;
  maskedEmail: string;
  expiresAt: string;
  /** Segundos hasta poder pedir otro código. */
  resendAfter: number;
  preview?: PreviewHint;
}

export type MfaMethod = 'totp' | 'recovery';

export interface MfaChallenge {
  mfaChallengeId: string;
  methods: MfaMethod[];
  preview?: PreviewHint;
}

// ── Clientes ─────────────────────────────────────────────────────────────────

export type CustomerStatus = 'active' | 'suspended' | 'pending_deletion';
export type SuspendReason = 'impago' | 'abuso' | 'peticion_cliente' | 'otro';
export type AdjustmentCategory = 'cortesia' | 'compensacion' | 'correccion';

export interface CustomerSummary {
  id: string;
  company: string;
  ownerEmail: string;
  ownerName: string;
  planId: string;
  planName: string;
  status: CustomerStatus;
  aiBlocked: boolean;
  balanceTokens: number;
  stripeCustomerId: string;
  amazonSellerId: string | null;
  createdAt: string;
  lastActiveAt: string;
}

export interface CustomerMember {
  name: string;
  email: string;
  role: 'propietario' | 'administrador' | 'editor';
}

export interface AmazonConnection {
  sellerId: string;
  marketplace: string;
  status: 'active' | 'expiring' | 'revoked' | 'error';
  authorizedAt: string;
  expiresAt: string;
}

export interface AiJob {
  id: string;
  kind: 'video' | 'manual' | '3d' | 'support';
  label: string;
  provider: string;
  status: 'done' | 'failed' | 'filtered' | 'running';
  chargedTokens: number;
  at: string;
  error?: string;
}

export interface Acceptance {
  document: string;
  version: string;
  acceptedAt: string;
  where: string;
}

export interface InternalNote {
  id: string;
  author: string;
  text: string;
  at: string;
}

export type LedgerType = 'recarga' | 'consumo' | 'filtrado' | 'ajuste' | 'reembolso' | 'correccion';

export interface LedgerEntry {
  id: string;
  customerId: string;
  at: string;
  type: LedgerType;
  /** Con signo: positivo suma saldo y negativo lo resta. */
  tokens: number;
  description: string;
  status: 'posted' | 'pending';
  category?: AdjustmentCategory;
  reason?: string;
  author?: string;
  approver?: string;
}

export interface CustomerDetail extends CustomerSummary {
  seatsUsed: number;
  seatsAllowed: number | null;
  chatgptConnected: boolean;
  suspendReason?: string;
  members: CustomerMember[];
  amazon: AmazonConnection | null;
  jobs: AiJob[];
  acceptances: Acceptance[];
  notes: InternalNote[];
  ledger: LedgerEntry[];
}

export interface AdjustmentResult {
  customer: CustomerDetail;
  entry: LedgerEntry;
}

// ── Proveedores de IA ────────────────────────────────────────────────────────

export type ProviderId = 'openai' | 'bedrock' | 'veo-gemini' | 'veo-vertex';

export interface ProviderModel {
  id: string;
  label: string;
  retiresAt?: string;
}

export interface AiProvider {
  id: ProviderId;
  name: string;
  usage: string;
  enabled: boolean;
  /** Tope de gasto mensual en dólares (los proveedores facturan en $). */
  monthlyCapUsd: number;
  spentUsd: number;
  successRate: number;
  latencyP50Seconds: number;
  /** Si hace de respaldo de otro proveedor y si ese respaldo está encendido. */
  fallback?: { enabled: boolean; label: string };
  models: ProviderModel[];
  pausedByCap: boolean;
}

export interface ProviderPatch {
  enabled?: boolean;
  monthlyCapUsd?: number;
  fallbackEnabled?: boolean;
  reason: string;
}

// ── Métricas ─────────────────────────────────────────────────────────────────

export type MetricsRange = '7d' | '30d' | '12m';

export interface MetricsKpis {
  signups: number;
  activeAccounts: number;
  /** Cuentas con suscripción vigente (mensual o anual). */
  paidAccounts: number;
  /** Cuentas dentro de la prueba de 14 días. */
  trialAccounts: number;
  /** Conversión de prueba a suscripción. */
  conversionRate: number;
  /** Bajas sobre suscritas en el periodo. */
  churnRate: number;
  mrrEur: number;
  /** Lo que cuesta operar a Uonify (soporte Uony, voz, infraestructura); no el consumo del cliente. */
  operationCostEur: number;
  videosGenerated: number;
  videosFailed: number;
  openTickets: number;
}

export interface AdminMetrics {
  range: MetricsRange;
  kpis: MetricsKpis;
  previous: Pick<MetricsKpis, 'signups' | 'activeAccounts' | 'paidAccounts' | 'mrrEur'>;
  byPlan: { planId: string; name: string; accounts: number }[];
}

// ── Auditoría ────────────────────────────────────────────────────────────────

export interface AuditTarget {
  type: 'cliente' | 'proveedor' | 'plan' | 'configuracion' | 'articulo' | 'ticket' | 'desistimiento' | 'sesion';
  id: string;
  label: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: { email: string; name: string };
  action: string;
  target: AuditTarget;
  reason?: string;
  detail?: string;
}

export interface AuditEventInput {
  action: string;
  target: AuditTarget;
  reason?: string;
  detail?: string;
}

// ── Facturación ──────────────────────────────────────────────────────────────

export type InvoiceKind = 'suscripcion' | 'recarga' | 'videollamada' | 'apoyo';
export type InvoiceStatus = 'paid' | 'refunded' | 'partially_refunded' | 'failed';

export interface AdminInvoice {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  issuedAt: string;
  kind: InvoiceKind;
  concept: string;
  baseEur: number;
  taxEur: number;
  totalEur: number;
  status: InvoiceStatus;
}

export type WithdrawalStatus = 'pending' | 'refunded' | 'failed';

export interface Withdrawal {
  id: string;
  customerId: string;
  customerName: string;
  requestedAt: string;
  invoiceNumber: string;
  paidEur: number;
  tokensSpent: number;
  refundEur: number;
  status: WithdrawalStatus;
  creditNoteNumber?: string;
  error?: string;
}

export interface CreditNote {
  id: string;
  number: string;
  customerName: string;
  issuedAt: string;
  invoiceNumber: string;
  correctiveInvoiceNumber: string;
  amountEur: number;
  reason: string;
}

// ── Datos de billing y help (normalizados) ───────────────────────────────────

export interface AdminPlan {
  id: string;
  name: string;
  monthlyPrice: number | null;
  monthsPerYear: number;
  seats: number | null;
  limits: string;
  description: string;
  /** Tokens de Uonify incluidos cada mes (null si el plan no lo indica). */
  includedTokens: number | null;
  popular: boolean;
  contactSales: boolean;
  /** Objeto original de billing, para devolverlo completo en el PUT. */
  raw: Record<string, unknown>;
}

export interface PlanDraft {
  monthlyPrice: number | null;
  monthsPerYear: number;
  seats: number | null;
  limits: string;
  description: string;
  includedTokens: number | null;
  popular: boolean;
}

/** Valor editable de una configuración con la clave que usa el otro módulo. */
export interface ConfigValue {
  key: string;
  value: number | null;
}

export interface BillingConfigView {
  minTopUp: ConfigValue;
  /** Máximo por recarga, si billing lo tiene. */
  maxTopUp: ConfigValue | null;
  patronAmount: ConfigValue;
  raw: Record<string, unknown>;
}

export interface HelpConfigView {
  videoCallPrice: number | null;
  videoCallMinutes: number | null;
  vatIncluded: boolean | null;
  raw: Record<string, unknown>;
}

export type TicketStatus = 'open' | 'answered' | 'closed';

export interface TicketMessage {
  id: string;
  author: 'customer' | 'team' | 'uony';
  authorName: string;
  body: string;
  at: string;
}

export interface TranscriptTurn {
  role: 'user' | 'uony';
  text: string;
}

export interface SupportTicket {
  id: string;
  /** Referencia legible (UON-1042); el id si help no la envía. */
  number: string;
  subject: string;
  status: TicketStatus;
  category: string;
  source: string;
  customerEmail: string;
  customerName: string;
  createdAt: string;
  updatedAt: string;
  lastMessage: string;
  /** Viene de una conversación con Uony de soporte que se pasó a una persona. */
  fromUony: boolean;
  messages: TicketMessage[];
  transcript: TranscriptTurn[];
}

export type ArticleStatus = 'draft' | 'published';
export type ArticlePlan = 'all' | 'paid' | 'free';

export interface HelpArticle {
  /** Identificador en la ruta (/help/articles/:id): el slug en help. */
  id: string;
  slug: string;
  title: string;
  summary: string;
  /** Markdown. Vacío en los listados (help solo lo envía en el detalle). */
  body: string;
  collection: string;
  status: ArticleStatus;
  plan: ArticlePlan;
  keywords: string[];
  /** Lo que Uony no debe asumir. No se publica. */
  assistantNotes: string[];
  updatedAt: string;
  helpful: number;
  notHelpful: number;
  raw: Record<string, unknown>;
}

export interface ArticleDraft {
  title: string;
  slug: string;
  summary: string;
  body: string;
  collection: string;
  status: ArticleStatus;
  plan: ArticlePlan;
  keywords: string[];
  assistantNotes: string[];
}
