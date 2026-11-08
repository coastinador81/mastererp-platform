import type { AdminInvoice, CreditNote, Withdrawal } from '../../model/types';
import { daysAgo } from './time';

/**
 * Facturación simulada (modelo de suscripción, sin tokens): suscripción mensual
 * (9,90 € + IVA) o anual (118,80 € + IVA) y videollamadas de soporte. El consumo de IA
 * lo paga el cliente desde su cuenta de Google y no se factura aquí. IVA del 21 %.
 * Los cobros reales viven en Stripe.
 */
const VAT = 0.21;

function invoice(
  id: number,
  customerId: string,
  customerName: string,
  days: number,
  kind: AdminInvoice['kind'],
  concept: string,
  base: number,
  status: AdminInvoice['status'] = 'paid',
): AdminInvoice {
  const tax = Math.round(base * VAT * 100) / 100;
  return {
    id: `inv_${id}`,
    number: `UON-2026-${String(id).padStart(6, '0')}`,
    customerId,
    customerName,
    issuedAt: daysAgo(days, 9 + (id % 8), (id * 7) % 60),
    kind,
    concept,
    baseEur: base,
    taxEur: tax,
    totalEur: Math.round((base + tax) * 100) / 100,
    status,
  };
}

const ANNUAL = 118.8;
const MONTHLY = 9.9;

export function seedInvoices(): AdminInvoice[] {
  return [
    invoice(131, 'acc_8TR5HC', 'Atelier Oliva', 3, 'suscripcion', 'Suscripción anual', ANNUAL),
    invoice(130, 'acc_4KD8RZ', 'Ferretería Albar', 6, 'suscripcion', 'Suscripción anual', ANNUAL, 'partially_refunded'),
    invoice(129, 'acc_3HX9TB', 'Casa Norte Hogar', 7, 'suscripcion', 'Suscripción mensual', MONTHLY),
    invoice(128, 'acc_3HX9TB', 'Casa Norte Hogar', 9, 'videollamada', 'Videollamada de soporte con Google Meet', 45),
    invoice(127, 'acc_9PL2WD', 'Bruma Cosmética', 12, 'suscripcion', 'Suscripción anual', ANNUAL),
    invoice(126, 'acc_BRISA0', 'Taller Brisa', 16, 'suscripcion', 'Suscripción anual', ANNUAL),
    invoice(125, 'acc_2VB7YL', 'Pixel Mascotas', 19, 'suscripcion', 'Renovación mensual', MONTHLY, 'failed'),
    invoice(124, 'acc_3HX9TB', 'Casa Norte Hogar', 26, 'suscripcion', 'Suscripción mensual', MONTHLY),
    invoice(123, 'acc_7Q2M4K', 'Lumen Juguetes', 41, 'suscripcion', 'Suscripción anual', ANNUAL),
    invoice(122, 'acc_1ZW6PF', 'Mar de Lino', 34, 'suscripcion', 'Suscripción anual', ANNUAL),
    invoice(121, 'acc_6MN1QS', 'Senda Outdoor', 63, 'suscripcion', 'Suscripción anual', ANNUAL),
    invoice(120, 'acc_9PL2WD', 'Bruma Cosmética', 88, 'suscripcion', 'Suscripción anual', ANNUAL),
    invoice(119, 'acc_5GH3NE', 'Kiro Electrónica', 120, 'suscripcion', 'Suscripción anual', ANNUAL),
  ];
}

export function seedWithdrawals(): Withdrawal[] {
  return [
    {
      id: 'wd_3',
      customerId: 'acc_8TR5HC',
      customerName: 'Atelier Oliva',
      requestedAt: daysAgo(0, 9, 12),
      invoiceNumber: 'UON-2026-000131',
      paidEur: 143.75,
      tokensSpent: 0,
      refundEur: 143.75,
      status: 'pending',
    },
    {
      id: 'wd_2',
      customerId: 'acc_BRISA0',
      customerName: 'Taller Brisa',
      requestedAt: daysAgo(4, 13, 40),
      invoiceNumber: 'UON-2026-000126',
      paidEur: 143.75,
      tokensSpent: 0,
      refundEur: 143.75,
      status: 'failed',
      error: 'Stripe rechazó la devolución: la tarjeta original ya no está activa.',
    },
    {
      id: 'wd_1',
      customerId: 'acc_4KD8RZ',
      customerName: 'Ferretería Albar',
      requestedAt: daysAgo(5, 10, 5),
      invoiceNumber: 'UON-2026-000130',
      paidEur: 143.75,
      tokensSpent: 0,
      refundEur: 134.5,
      status: 'refunded',
      creditNoteNumber: 'NC-2026-00004',
    },
  ];
}

export function seedCreditNotes(): CreditNote[] {
  return [
    {
      id: 'cn_4',
      number: 'NC-2026-00004',
      customerName: 'Ferretería Albar',
      issuedAt: daysAgo(5, 10, 6),
      invoiceNumber: 'UON-2026-000130',
      correctiveInvoiceNumber: 'R-2026-00004',
      amountEur: 134.5,
      reason: 'Desistimiento en 14 días: se descuenta el servicio de los días ya usados.',
    },
    {
      id: 'cn_3',
      number: 'NC-2026-00003',
      customerName: 'Casa Norte Hogar',
      issuedAt: daysAgo(15, 17, 30),
      invoiceNumber: 'UON-2026-000117',
      correctiveInvoiceNumber: 'R-2026-00003',
      amountEur: 54.45,
      reason: 'Videollamada cancelada por Uonify: se devuelve el importe completo.',
    },
  ];
}
