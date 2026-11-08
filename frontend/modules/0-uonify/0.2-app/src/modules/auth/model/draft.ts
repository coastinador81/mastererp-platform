import type { ChatGPTChoice } from './onboarding';
import { normalizePlan } from './plans';
import { readKey, removeKey, STORAGE_KEYS, writeKey } from './storage';
import type { ProfileValues } from './types';

/**
 * Borrador del alta en sessionStorage: permite retomarla en el paso pendiente
 * tras cerrar el diálogo, recargar o volver del permiso de ChatGPT. Es de una
 * cuenta (si cambia la cuenta, se ignora) y se borra al terminar o al salir.
 */
export interface OnboardingDraft {
  email: string;
  step: number;
  values: ProfileValues;
  chatgptChoice: ChatGPTChoice;
}

const TEXT_KEYS = ['firstName', 'lastName', 'email', 'ageRange', 'role', 'companySize', 'company', 'primaryGoal', 'source'] as const;

function parseValues(raw: unknown): ProfileValues | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const values = {} as ProfileValues;
  for (const key of TEXT_KEYS) values[key] = typeof data[key] === 'string' ? data[key] : '';
  values.billingInterval = data.billingInterval === 'annual' ? 'annual' : 'monthly';
  values.plan = normalizePlan(data.plan) ?? 'free';
  return values;
}

const sameAccount = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** El borrador de esta cuenta, o null. */
export function readDraft(email: string): OnboardingDraft | null {
  try {
    const data = JSON.parse(readKey(STORAGE_KEYS.onboarding) || 'null') as Record<string, unknown> | null;
    if (!data || typeof data.email !== 'string' || !email || !sameAccount(data.email, email)) return null;
    const values = parseValues(data.values);
    if (!values) return null;
    const choice = data.chatgptChoice === 'connect' || data.chatgptChoice === 'skip' ? data.chatgptChoice : '';
    return { email: data.email, step: typeof data.step === 'number' ? data.step : 0, values, chatgptChoice: choice };
  } catch {
    return null;
  }
}

export function writeDraft(draft: OnboardingDraft): void {
  if (!draft.email) return;
  writeKey(STORAGE_KEYS.onboarding, JSON.stringify(draft));
}

export function clearDraft(): void {
  removeKey(STORAGE_KEYS.onboarding);
}
