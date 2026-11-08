import type { BadgeTone } from '@/shared/ui';
import type {
  AdjustmentCategory,
  AiJob,
  AmazonConnection,
  ArticlePlan,
  ArticleStatus,
  CustomerStatus,
  InvoiceKind,
  InvoiceStatus,
  LedgerType,
  SuspendReason,
  TicketStatus,
  WithdrawalStatus,
} from './types';

/** Textos y tonos de estado del panel. El color solo afirma un estado. */
export interface StatusLabel {
  label: string;
  tone: BadgeTone;
}

export const CUSTOMER_STATUS: Record<CustomerStatus, StatusLabel> = {
  active: { label: 'Activa', tone: 'green' },
  suspended: { label: 'Suspendida', tone: 'red' },
  pending_deletion: { label: 'Pendiente de borrado', tone: 'amber' },
};

export const SUSPEND_REASONS: Record<SuspendReason, string> = {
  impago: 'Impago',
  abuso: 'Abuso o uso fraudulento',
  peticion_cliente: 'Petición del cliente',
  otro: 'Otro motivo',
};

export const ADJUSTMENT_CATEGORIES: Record<AdjustmentCategory, string> = {
  cortesia: 'Cortesía',
  compensacion: 'Compensación por un fallo',
  correccion: 'Corrección de un error',
};

export const LEDGER_TYPES: Record<LedgerType, string> = {
  recarga: 'Recarga',
  consumo: 'Consumo',
  filtrado: 'Bloqueado por filtro',
  ajuste: 'Ajuste manual',
  reembolso: 'Reembolso',
  correccion: 'Corrección',
};

export const AMAZON_STATUS: Record<AmazonConnection['status'], StatusLabel> = {
  active: { label: 'Activa', tone: 'green' },
  expiring: { label: 'Caduca pronto', tone: 'amber' },
  revoked: { label: 'Revocada', tone: 'red' },
  error: { label: 'Con error', tone: 'red' },
};

export const JOB_STATUS: Record<AiJob['status'], StatusLabel> = {
  done: { label: 'Hecho', tone: 'green' },
  failed: { label: 'Fallido', tone: 'red' },
  filtered: { label: 'Bloqueado por filtro', tone: 'amber' },
  running: { label: 'En curso', tone: 'blue' },
};

export const INVOICE_KIND: Record<InvoiceKind, string> = {
  suscripcion: 'Suscripción',
  recarga: 'Recarga',
  videollamada: 'Videollamada de soporte',
  apoyo: 'Apoya a Uonify',
};

export const INVOICE_STATUS: Record<InvoiceStatus, StatusLabel> = {
  paid: { label: 'Pagada', tone: 'green' },
  refunded: { label: 'Devuelta', tone: 'neutral' },
  partially_refunded: { label: 'Devuelta en parte', tone: 'amber' },
  failed: { label: 'Cobro fallido', tone: 'red' },
};

export const WITHDRAWAL_STATUS: Record<WithdrawalStatus, StatusLabel> = {
  pending: { label: 'En curso', tone: 'blue' },
  refunded: { label: 'Devuelto', tone: 'green' },
  failed: { label: 'Devolución fallida', tone: 'red' },
};

export const TICKET_STATUS: Record<TicketStatus, StatusLabel> = {
  open: { label: 'Abierto', tone: 'blue' },
  answered: { label: 'Respondido', tone: 'green' },
  closed: { label: 'Cerrado', tone: 'neutral' },
};

/** Origen y tema de un ticket (mismos valores que help). */
export const TICKET_SOURCES: Record<string, string> = {
  uony: 'Desde Uony de soporte',
  form: 'Formulario de ayuda',
  email: 'Correo a hola@uonify.com',
  videocall: 'Videollamada',
};

export const TICKET_CATEGORIES: Record<string, string> = {
  account: 'Cuenta y acceso',
  billing: 'Suscripción y facturación',
  amazon: 'Conexión con Amazon',
  catalog: 'Catálogo y fichas',
  ai: 'Uony y contenido con IA',
  privacy: 'Privacidad y datos',
  other: 'Otro tema',
};

export const ARTICLE_PLANS: Record<ArticlePlan, string> = {
  all: 'Todos los planes',
  paid: 'Solo planes de pago',
  free: 'Solo plan Gratis',
};

export const ARTICLE_STATUS: Record<ArticleStatus, StatusLabel> = {
  draft: { label: 'Borrador', tone: 'neutral' },
  published: { label: 'Publicado', tone: 'green' },
};

/** Acciones del registro de auditoría. */
export const AUDIT_ACTIONS: Record<string, string> = {
  'admin.signin': 'Entró en el panel',
  'admin.signout': 'Salió del panel',
  'customer.suspend': 'Suspendió una cuenta',
  'customer.reactivate': 'Reactivó una cuenta',
  'customer.ai_block': 'Cortó la IA de una cuenta',
  'customer.ai_unblock': 'Devolvió la IA a una cuenta',
  'customer.balance_adjust': 'Registró un ajuste de cuenta',
  'customer.balance_request': 'Pidió un ajuste de cuenta',
  'customer.balance_approve': 'Aprobó un ajuste de cuenta',
  'customer.note': 'Añadió una nota interna',
  'provider.update': 'Cambió un proveedor de IA',
  'plan.update': 'Cambió un plan',
  'billing_config.update': 'Cambió la configuración de facturación',
  'help_config.update': 'Cambió la videollamada de soporte',
  'article.create': 'Creó un artículo de ayuda',
  'article.update': 'Editó un artículo de ayuda',
  'article.publish': 'Publicó un artículo de ayuda',
  'article.unpublish': 'Retiró un artículo de ayuda',
  'article.delete': 'Eliminó un artículo de ayuda',
  'ticket.reply': 'Respondió un ticket',
  'ticket.status': 'Cambió el estado de un ticket',
  'withdrawal.retry': 'Reintentó una devolución',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTIONS[action] ?? action;
}
