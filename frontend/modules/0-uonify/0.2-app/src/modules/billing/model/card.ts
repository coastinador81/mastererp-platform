import type { PaymentMethod } from './types';

/** Validación de 16 dígitos en la maqueta; producción debe tokenizar con Stripe Elements. */
export function cardNumberValid(value: string): boolean {
  const digits = value.replace(/\s/g, '');
  // En el adaptador de demostración cualquier combinación sirve: no se exige Luhn.
  return /^\d{16}$/.test(digits);
}

export function cardExpiry(value: string, now = new Date()): { expMonth: number; expYear: number } | null {
  const match = value.match(/^\s*(\d{2})\s*\/\s*(\d{2})\s*$/);
  if (!match) return null;
  const expMonth = Number(match[1]);
  const expYear = 2000 + Number(match[2]);
  if (expMonth < 1 || expMonth > 12 || expYear < now.getFullYear() || (expYear === now.getFullYear() && expMonth < now.getMonth() + 1)) return null;
  return { expMonth, expYear };
}

/** Solo metadatos: nunca número completo ni CVC en la API o el almacenamiento. */
export function parsePaymentCard(value: unknown): PaymentMethod | null {
  if (!value || typeof value !== 'object') return null;
  const card = value as Partial<PaymentMethod>;
  if (typeof card.id !== 'string' || !card.id.startsWith('pm_') || !['visa', 'mastercard', 'amex'].includes(card.brand ?? '') || !/^\d{4}$/.test(card.last4 ?? '') || !Number.isInteger(card.expMonth) || !Number.isInteger(card.expYear)) return null;
  if (!cardExpiry(`${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`)) return null;
  return { id: card.id, brand: card.brand!, last4: card.last4!, expMonth: card.expMonth!, expYear: card.expYear! };
}
