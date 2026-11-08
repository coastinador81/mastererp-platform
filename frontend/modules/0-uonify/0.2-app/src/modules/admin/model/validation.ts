import type { ArticleDraft, PlanDraft } from './types';

/** Motivo obligatorio de toda acción del equipo (queda en la auditoría). */
export const REASON_MIN = 10;
export const REASON_MAX = 500;

export function reasonError(value: string): string | null {
  const text = value.trim();
  if (!text) return 'Escribe el motivo. Queda guardado en la auditoría.';
  if (text.length < REASON_MIN) return `Explica el motivo con al menos ${REASON_MIN} caracteres.`;
  if (text.length > REASON_MAX) return `El motivo no puede pasar de ${REASON_MAX} caracteres.`;
  return null;
}

/** Lee un número escrito a la española («1.250,5» o «1250.5»); null si no lo es. */
export function parseAmount(value: string): number | null {
  const raw = value.trim().replace(/\s|€|\$/g, '');
  if (!raw) return null;
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function parseInteger(value: string): number | null {
  const number = parseAmount(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

export type Errors<T> = Partial<Record<keyof T, string>>;

/** Validación del editor de un plan (precios en euros al mes con facturación anual). */
export function validatePlan(draft: PlanDraft, contactSales: boolean): Errors<PlanDraft> {
  const errors: Errors<PlanDraft> = {};
  if (!contactSales) {
    if (draft.monthlyPrice === null || draft.monthlyPrice < 0) errors.monthlyPrice = 'Escribe un precio de 0 € o más.';
    else if (draft.monthlyPrice > 100_000) errors.monthlyPrice = 'El precio parece demasiado alto. Revísalo.';
    else if (Math.round(draft.monthlyPrice * 100) !== draft.monthlyPrice * 100) errors.monthlyPrice = 'Usa como mucho dos decimales.';
  }
  if (!Number.isInteger(draft.monthsPerYear) || draft.monthsPerYear < 12 || draft.monthsPerYear > 24) {
    errors.monthsPerYear = 'Entre 12 y 24 meses por año pagado.';
  }
  if (draft.seats !== null && (!Number.isInteger(draft.seats) || draft.seats < 1 || draft.seats > 10_000)) {
    errors.seats = 'Escribe un número entero de usuarios, o déjalo vacío para «a medida».';
  }
  if (draft.includedTokens !== null && (!Number.isInteger(draft.includedTokens) || draft.includedTokens < 0)) {
    errors.includedTokens = 'Escribe un número entero de tokens, 0 o más.';
  }
  if (!draft.limits.trim()) errors.limits = 'Describe los límites del plan.';
  else if (draft.limits.length > 160) errors.limits = 'Hasta 160 caracteres.';
  if (draft.description.length > 240) errors.description = 'Hasta 240 caracteres.';
  return errors;
}

/** Cobro anual: 12 mensualidades por los meses de servicio que marque el plan. */
export function annualCharge(monthlyPrice: number): number {
  return Math.round(monthlyPrice * 12 * 100) / 100;
}

/** Precio mensual efectivo: 49 € × 12 / 13 meses = 45,23 €. */
export function effectiveMonthly(monthlyPrice: number, monthsPerYear: number): number {
  if (monthsPerYear <= 0) return monthlyPrice;
  return Math.round((monthlyPrice * 12 * 100) / monthsPerYear) / 100;
}

/** Importe entero en euros para la configuración (recarga mínima, apoyo, videollamada). */
export function euroSettingError(value: number | null, { min = 1, max = 10_000 } = {}): string | null {
  if (value === null) return 'Escribe un importe.';
  if (value < min) return `Como mínimo ${min} €.`;
  if (value > max) return `Como máximo ${max.toLocaleString('es-ES')} €.`;
  if (Math.round(value * 100) !== value * 100) return 'Usa como mucho dos decimales.';
  return null;
}

/** «Cómo conectar Amazon» → «como-conectar-amazon». */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

export function validateArticle(draft: ArticleDraft): Errors<ArticleDraft> {
  const errors: Errors<ArticleDraft> = {};
  if (!draft.title.trim()) errors.title = 'Escribe el título del artículo.';
  else if (draft.title.length > 120) errors.title = 'Hasta 120 caracteres.';
  if (!draft.slug.trim()) errors.slug = 'Escribe la dirección del artículo.';
  else if (draft.slug !== slugify(draft.slug)) errors.slug = 'Solo minúsculas, números y guiones.';
  if (!draft.collection.trim()) errors.collection = 'Elige o escribe una colección.';
  if (draft.summary.length > 200) errors.summary = 'Hasta 200 caracteres.';
  if (draft.status === 'published' && draft.body.trim().length < 40) errors.body = 'Para publicarlo, escribe al menos 40 caracteres.';
  return errors;
}

export function hasErrors<T>(errors: Errors<T>): boolean {
  return Object.values(errors).some(Boolean);
}
