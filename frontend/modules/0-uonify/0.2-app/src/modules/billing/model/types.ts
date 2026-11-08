import type { BillingInterval, PlanId } from './plans';

/**
 * Tipos del contrato de /api/billing/* (lo que devuelven los handlers de MSW y
 * después el backend). Importes en euros sin impuestos salvo `total`.
 */

/** GET/PUT /billing/config. Todo editable desde admin. */
export interface BillingConfig {
  currency: 'EUR';
  /** Precio de tarifa de un token de Uonify en euros (0,01 € = 1 céntimo). */
  tokenPrice: number;
  /** Recarga mínima (decisión del dueño: 20 €, sin packs ni descuentos). */
  minRecharge: number;
  /** Máximo por recarga, para frenar errores al teclear. */
  maxRecharge: number;
  /** «Apoya a Uonify»: importe mensual sin impuestos. */
  supportAmount: number;
  /** IVA que se aplica si el backend no indica otro (21 % en España). */
  vatRate: number;
  /** Versión de las Condiciones que se aceptan al pagar. */
  termsVersion: string;
}

/** Base, IVA y total de un cobro o una devolución. */
export interface Amounts {
  base: number;
  vatRate: number;
  vat: number;
  total: number;
}

export interface PaymentMethod {
  id: string;
  brand: 'visa' | 'mastercard' | 'amex';
  last4: string;
  expMonth: number;
  expYear: number;
}

/** «Apoya a Uonify» (plan Mecenas): quien apoya es «partner voluntario». */
export interface SupportState {
  active: boolean;
  amount: number;
  since: string | null;
  renewalPaymentMethod?: PaymentMethod;
}

/** GET /billing/subscription. En Gratis no hay cobro ni fechas. */
export interface Subscription {
  planId: PlanId;
  /** Ausente en datos antiguos: anual, salvo periodos de un mes. */
  interval?: BillingInterval;
  scheduledInterval?: BillingInterval | null;
  /** Fecha del cobro del periodo (ISO). */
  startedAt: string | null;
  /** Fin del periodo pagado, según su modalidad. */
  renewsAt: string | null;
  /** Meses de servicio del periodo actual (1 en mensual). */
  months: number | null;
  amountPaid: Amounts | null;
  invoiceId: string | null;
  /** Último día para desistir (14 días naturales desde el cobro). */
  withdrawalUntil: string | null;
  /** Cambio a un plan inferior (o a Gratis) programado para la renovación. */
  scheduledPlanId: PlanId | null;
  support: SupportState;
  /** Referencia autorizada solo para esta suscripción, no tarjeta reutilizable. */
  renewalPaymentMethod?: PaymentMethod;
}

export type DocumentKind = 'invoice' | 'credit_note' | 'corrective';
export type DocumentStatus = 'paid' | 'rectified' | 'issued' | 'refunded';

/** Factura, nota de crédito o factura rectificativa (GET /billing/invoices). */
export interface BillingDocument {
  id: string;
  number: string;
  kind: DocumentKind;
  concept: string;
  issuedAt: string;
  base: number;
  vatRate: number;
  vat: number;
  total: number;
  status: DocumentStatus;
  /** Número de la factura que corrige (notas de crédito y rectificativas). */
  rectifies?: string;
}

export type TokenAccount = 'included' | 'recharged';
export type MovementKind = 'recharge' | 'spend' | 'included' | 'expiry' | 'adjustment';

/** Apunte del libro de tokens (GET /billing/movements), de solo añadir. */
export interface Movement {
  id: string;
  at: string;
  kind: MovementKind;
  /** Con signo: positivo entra, negativo sale. */
  tokens: number;
  account: TokenAccount;
  concept: string;
  feature?: string;
  invoiceId?: string;
}

/**
 * GET /billing/balance. `amount` y `currency` son el contrato que ya lee
 * pim-video («Saldo disponible»): el saldo total en euros.
 */
export interface BillingBalance {
  amount: number;
  currency: 'EUR';
  tokens: number;
  tokenPrice: number;
  included: { tokens: number; renewsAt: string | null };
  recharged: { tokens: number };
}

/** GET /billing/checkout/preview?planId=: lo que se cobrará hoy. */
export interface CheckoutQuote {
  interval: BillingInterval;
  planId: PlanId;
  planName: string;
  monthlyPrice: number;
  paidMonths: number;
  months: number;
  /** Importe del periodo sin impuestos. */
  base: number;
  /** Parte no usada del plan actual al subir de plan. */
  credit: number;
  creditPlanName: string | null;
  amounts: Amounts;
  startsAt: string;
  endsAt: string;
  withdrawalUntil: string;
  /** Importe de la siguiente renovación sin impuestos. */
  renewalBase: number;
}

export interface PaymentDetails {
  paymentMethod: string;
  newCard?: PaymentMethod;
  savePaymentMethod?: boolean;
}

export interface CheckoutRequest extends PaymentDetails {
  interval?: BillingInterval;
  planId: PlanId;
  /** Tarjeta guardada o «new» (formulario de Stripe). */
  paymentMethod: string;
  acceptedTerms: boolean;
  acceptedWithdrawal: boolean;
  termsVersion: string;
}

export interface CheckoutResult {
  subscription: Subscription;
  invoice: BillingDocument;
  paymentMethod: PaymentMethod;
}

export type WithdrawalBlock = 'no_plan' | 'expired';

/** GET /billing/withdrawal: vista previa de la devolución. */
export interface WithdrawalPreview {
  eligible: boolean;
  reason: WithdrawalBlock | null;
  planId: PlanId;
  planName: string;
  deadline: string | null;
  paidAt: string | null;
  paid: Amounts | null;
  invoiceNumber: string | null;
  /** Tokens del plan gastados desde el cobro. */
  tokensSpent: number;
  tokenPrice: number;
  /** Valor de esos tokens a precio de tarifa (sin impuestos). */
  spentValue: number;
  refund: Amounts;
}

export interface WithdrawalResult {
  refund: Amounts;
  creditNote: BillingDocument;
  correctiveInvoice: BillingDocument;
  subscription: Subscription;
  paymentMethod: PaymentMethod | null;
}

export interface RechargeResult {
  paymentMethod: PaymentMethod;
  movement: Movement;
  invoice: BillingDocument;
  balance: BillingBalance;
}

export interface SupportResult {
  subscription: Subscription;
  invoice: BillingDocument;
}
