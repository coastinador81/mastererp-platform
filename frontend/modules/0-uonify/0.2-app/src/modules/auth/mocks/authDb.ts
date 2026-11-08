import { collection, record } from '@/shared/mocks/db';
import { missingConsents } from '../model/legal';
import { checkProfile, isAdultAgeRange } from '../model/profile';
import type { AuthProvider, ChatGPTPlanStatus, ConsentRecord, Profile, SessionPayload } from '../model/types';

/**
 * «Base de datos» simulada del acceso: la sesión (lo que en el backend sería la
 * cookie), los perfiles, las aceptaciones versionadas, el plan de ChatGPT
 * conectado y los códigos de correo, por cuenta. Sobrevive a una recarga
 * (sessionStorage).
 */
export interface MockSession {
  email: string | null;
  provider?: AuthProvider;
  /** Nombre que da el proveedor de identidad. */
  name?: string;
  startedAt?: string;
}

export interface StoredProfile {
  /** Correo en minúsculas (en todas las colecciones). */
  id: string;
  profile: Profile;
  savedAt: string;
}

export interface StoredConsents {
  id: string;
  consents: ConsentRecord[];
}

export interface StoredPlan {
  id: string;
  plan: ChatGPTPlanStatus;
}

export interface StoredCode {
  id: string;
  code: string;
  /** ms desde epoch. */
  expiresAt: number;
  attemptsLeft: number;
  lastSentAt: number;
  /** Envíos recientes (ms), para limitar cuántos códigos se piden. */
  sends: number[];
}

export const sessionRecord = record<MockSession>('auth-session', () => ({ email: null }));
export const profileStore = collection<StoredProfile>('auth-profiles');
export const consentStore = collection<StoredConsents>('auth-consents');
export const planStore = collection<StoredPlan>('auth-chatgpt-plan');
export const codeStore = collection<StoredCode>('auth-email-codes');

export const profileKey = (email: string): string => email.trim().toLowerCase();

export function consentsOf(email: string): ConsentRecord[] {
  return consentStore.get(profileKey(email))?.consents ?? [];
}

export function planOf(email: string): ChatGPTPlanStatus {
  return planStore.get(profileKey(email))?.plan ?? { status: 'not_connected' };
}

/** Guarda aceptaciones nuevas (la última de cada documento y versión manda). */
export function recordConsents(email: string, accepted: ConsentRecord[]): ConsentRecord[] {
  const kept = consentsOf(email).filter(old => !accepted.some(item => item.id === old.id && item.version === old.version));
  const consents = [...kept, ...accepted];
  consentStore.upsert({ id: profileKey(email), consents });
  return consents;
}

export function storePlan(email: string, plan: ChatGPTPlanStatus): ChatGPTPlanStatus {
  planStore.upsert({ id: profileKey(email), plan });
  return plan;
}

/** Respuesta de /api/auth/session para la sesión simulada. */
export function sessionPayload(email: string | null): SessionPayload {
  if (!email) return { authenticated: false };
  const current = sessionRecord.get();
  const provider = current.email && profileKey(current.email) === profileKey(email) ? current.provider ?? 'chatgpt' : 'chatgpt';
  const stored = profileStore.get(profileKey(email));
  const consents = consentsOf(email);
  // El alta está completa con el perfil válido y las condiciones vigentes aceptadas.
  const complete = !!stored && checkProfile(stored.profile).ok && missingConsents(consents).length === 0;
  return {
    authenticated: true,
    email,
    account: { email, provider },
    identity: { provider, email, ...(current.name ? { name: current.name } : {}) },
    profile: stored?.profile ?? null,
    profileComplete: complete,
    ageConfirmedAdult: complete && isAdultAgeRange(stored?.profile.ageRange),
    consents,
    chatgptPlan: planOf(email),
  };
}

export function signInAs(email: string, provider: AuthProvider = 'chatgpt', name?: string): SessionPayload {
  sessionRecord.set({ email, provider, ...(name ? { name } : {}), startedAt: new Date().toISOString() });
  return sessionPayload(email);
}

export function signOutMock(): void {
  sessionRecord.set({ email: null });
}

export function storeProfile(email: string, profile: Profile): Profile {
  // El correo de la cuenta manda: el campo del alta está bloqueado.
  const saved: Profile = { ...profile, email };
  profileStore.upsert({ id: profileKey(email), profile: saved, savedAt: new Date().toISOString() });
  return saved;
}

/** Solo pruebas. */
export function resetAuthDb(): void {
  sessionRecord.set({ email: null });
  profileStore.reset();
  consentStore.reset();
  planStore.reset();
  codeStore.reset();
}

/** Contexto de servidor para los handlers de facturación; no procede de la caché del cliente. */
export function mockBillingAccount() {
  const email = sessionRecord.get().email;
  return { email: email ? profileKey(email) : null, profile: email ? profileStore.get(profileKey(email))?.profile : undefined };
}
