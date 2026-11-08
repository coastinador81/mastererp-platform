import type { AdminRole } from './types';

/**
 * Roles del equipo y lo que puede hacer cada uno (propuesta del panel, sección 4).
 * El backend vuelve a comprobarlo en cada acción: aquí solo se ocultan o se apagan
 * los controles que el rol no puede usar.
 */
export const ROLE_LABELS: Record<AdminRole, string> = {
  superadmin: 'Superadmin',
  operaciones: 'Operaciones',
  soporte: 'Soporte',
  finanzas: 'Finanzas',
  lectura: 'Solo lectura',
};

export type AdminSection =
  | 'resumen'
  | 'clientes'
  | 'planes'
  | 'proveedores'
  | 'soporte'
  | 'articulos'
  | 'facturacion'
  | 'auditoria';

export type AdminAction =
  | 'customers.suspend'
  | 'customers.aiBlock'
  | 'customers.adjust'
  | 'customers.approve'
  | 'customers.note'
  | 'pricing.edit'
  | 'providers.edit'
  | 'support.reply'
  | 'articles.edit'
  | 'finance.retry'
  | 'audit.all';

const ALL: AdminRole[] = ['superadmin', 'operaciones', 'soporte', 'finanzas', 'lectura'];

const SECTION_ROLES: Record<AdminSection, AdminRole[]> = {
  resumen: ALL,
  clientes: ALL,
  planes: ['superadmin', 'finanzas', 'lectura'],
  proveedores: ['superadmin', 'operaciones', 'lectura'],
  soporte: ['superadmin', 'soporte', 'operaciones'],
  articulos: ['superadmin', 'soporte'],
  facturacion: ['superadmin', 'finanzas', 'lectura'],
  auditoria: ['superadmin', 'operaciones', 'soporte', 'finanzas'],
};

const ACTION_ROLES: Record<AdminAction, AdminRole[]> = {
  'customers.suspend': ['superadmin', 'operaciones', 'soporte', 'finanzas'],
  'customers.aiBlock': ['superadmin', 'operaciones', 'soporte'],
  'customers.adjust': ['superadmin', 'soporte', 'finanzas'],
  'customers.approve': ['superadmin', 'finanzas'],
  'customers.note': ['superadmin', 'operaciones', 'soporte', 'finanzas'],
  'pricing.edit': ['superadmin'],
  'providers.edit': ['superadmin', 'operaciones'],
  'support.reply': ['superadmin', 'soporte', 'operaciones'],
  'articles.edit': ['superadmin', 'soporte'],
  'finance.retry': ['superadmin', 'finanzas'],
  'audit.all': ['superadmin'],
};

export function canView(role: AdminRole | undefined, section: AdminSection): boolean {
  return !!role && SECTION_ROLES[section].includes(role);
}

export function can(role: AdminRole | undefined, action: AdminAction): boolean {
  return !!role && ACTION_ROLES[action].includes(role);
}

/**
 * Tope de un ajuste de cuenta sin segunda persona, en céntimos (100 = 1 €):
 * Soporte hasta 10 € por caso; Finanzas y Superadmin hasta 100 €.
 */
export const ADJUSTMENT_LIMITS: Partial<Record<AdminRole, number>> = {
  soporte: 1_000,
  finanzas: 10_000,
  superadmin: 10_000,
};

/** Por encima de 100 € el ajuste queda pendiente hasta que lo apruebe otra persona. */
export const SECOND_APPROVAL_OVER = 10_000;

export type AdjustmentCheck =
  | { ok: true; needsApproval: boolean }
  | { ok: false; message: string };

/** Si el rol puede hacer un ajuste de `tokens` (con signo) y si pide segunda persona. */
export function checkAdjustment(role: AdminRole | undefined, tokens: number): AdjustmentCheck {
  if (!role || !can(role, 'customers.adjust')) return { ok: false, message: 'Tu rol no permite ajustar saldos.' };
  const amount = Math.abs(tokens);
  if (role === 'soporte' && amount > (ADJUSTMENT_LIMITS.soporte ?? 0)) {
    return { ok: false, message: 'Soporte puede ajustar hasta 10 € por caso. Pide a Finanzas el resto.' };
  }
  return { ok: true, needsApproval: amount > SECOND_APPROVAL_OVER };
}
