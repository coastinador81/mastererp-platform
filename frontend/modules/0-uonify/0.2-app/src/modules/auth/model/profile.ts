import { normalizePlan } from './plans';
import type { Profile, ProfileValues } from './types';

/** Franjas que confirman la mayoría de edad (Uonify es solo para mayores de 18). */
export const ADULT_AGE_RANGES: ReadonlySet<string> = new Set(['18-24', '25-34', '35-44', '45-54', '55+']);

export const isAdultAgeRange = (value: unknown): boolean => typeof value === 'string' && ADULT_AGE_RANGES.has(value);

export const EMAIL_MAX_LENGTH = 160;

/** Comprobación mínima del correo (la real la hace el navegador con type="email"). */
export function isEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= EMAIL_MAX_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export function emptyProfileValues(): ProfileValues {
  return {
    firstName: '',
    lastName: '',
    email: '',
    ageRange: '',
    role: '',
    companySize: '',
    company: '',
    primaryGoal: '',
    source: '',
    plan: 'free',
    billingInterval: 'monthly',
  };
}

/** Valores iniciales del alta a partir del perfil guardado (prototipo: showProfile). */
export function valuesFromProfile(profile: Partial<Profile> | null, sessionEmail: string): ProfileValues {
  const saved = profile ?? {};
  return {
    firstName: text(saved.firstName),
    lastName: text(saved.lastName),
    email: sessionEmail || text(saved.email),
    ageRange: text(saved.ageRange),
    role: text(saved.role),
    companySize: text(saved.companySize),
    company: text(saved.company),
    primaryGoal: text(saved.primaryGoal),
    source: text(saved.source),
    plan: normalizePlan(saved.desiredPlan) ?? 'free',
    billingInterval: saved.billingInterval ?? 'monthly',
  };
}

/** Perfil que se envía al backend (prototipo: submit de #uon-profile-form). */
export function profileFromValues(values: ProfileValues): Profile {
  const firstName = values.firstName.trim();
  const lastName = values.lastName.trim();
  return {
    firstName,
    lastName,
    name: `${firstName} ${lastName}`,
    email: values.email.trim(),
    ageRange: values.ageRange,
    role: values.role,
    companySize: values.companySize,
    company: values.company.trim(),
    primaryGoal: values.primaryGoal,
    source: values.source,
    desiredPlan: values.plan,
    billingInterval: values.billingInterval ?? 'monthly',
  };
}

export type ProfileCheck = { ok: true; profile: Profile } | { ok: false; reason: 'invalid' | 'underage' };

/**
 * Valida un perfil completo (lo usan el formulario y la simulación del backend).
 * Obligatorios: nombre, apellidos, correo, franja adulta, actividad, tamaño,
 * objetivo y un plan conocido.
 */
export function checkProfile(input: unknown): ProfileCheck {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'invalid' };
  const raw = input as Record<string, unknown>;
  const desiredPlan = normalizePlan(raw.desiredPlan);
  const firstName = text(raw.firstName).trim();
  const lastName = text(raw.lastName).trim();
  const email = text(raw.email).trim();
  if (!firstName || !lastName || !email.includes('@') || !text(raw.role) || !text(raw.companySize) || !text(raw.primaryGoal) || !desiredPlan) {
    return { ok: false, reason: 'invalid' };
  }
  if (!isAdultAgeRange(raw.ageRange)) return { ok: false, reason: raw.ageRange === 'under18' ? 'underage' : 'invalid' };
  return {
    ok: true,
    profile: {
      firstName,
      lastName,
      name: `${firstName} ${lastName}`,
      email,
      ageRange: text(raw.ageRange),
      role: text(raw.role),
      companySize: text(raw.companySize),
      company: text(raw.company).trim(),
      primaryGoal: text(raw.primaryGoal),
      source: text(raw.source),
      desiredPlan,
      billingInterval: raw.billingInterval === 'annual' ? 'annual' : 'monthly',
    },
  };
}

/**
 * Perfil de la sesión: como el prototipo, basta con que traiga nombre (firstName
 * o name). Los campos que falten quedan vacíos.
 */
export function parseSessionProfile(raw: unknown): Profile | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (typeof data.firstName !== 'string' && typeof data.name !== 'string') return null;
  const [nameFirst = '', ...nameRest] = text(data.name).trim().split(/\s+/);
  const firstName = typeof data.firstName === 'string' ? data.firstName : nameFirst;
  const lastName = typeof data.lastName === 'string' ? data.lastName : nameRest.join(' ');
  return {
    firstName,
    lastName,
    name: text(data.name) || `${firstName} ${lastName}`.trim(),
    email: text(data.email),
    ageRange: text(data.ageRange),
    role: text(data.role),
    companySize: text(data.companySize),
    company: text(data.company),
    primaryGoal: text(data.primaryGoal),
    source: text(data.source),
    desiredPlan: normalizePlan(data.desiredPlan) ?? 'free',
    billingInterval: data.billingInterval === 'annual' ? 'annual' : 'monthly',
  };
}
