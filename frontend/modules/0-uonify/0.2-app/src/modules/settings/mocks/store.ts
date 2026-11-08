import { collection, record } from '@/shared/mocks/db';
import type { StoredBrandProfile } from '../model/brandGpsrProfile';
import type {
  Account,
  ActiveSession,
  Connections,
  CookiePreferences,
  DataExport,
  SignInMethod,
  TeamMember,
} from '../model/types';

/**
 * «Base de datos» simulada de Configuración (sessionStorage, vía @/shared/mocks/db).
 * Solo la usan los handlers de mocks/. Las fechas de la semilla son relativas al
 * momento de crearla, para que «hace 3 h» o «caduca en 365 días» tengan sentido.
 */
const DAY = 86_400_000;
const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

// ── Identidad de la sesión simulada ──────────────────────────────────────────
interface Identity {
  name: string;
  email: string;
}

const FALLBACK_IDENTITY: Identity = { name: 'Ana García', email: 'ana@makeitpossible.es' };

function readMockStore(name: string): unknown {
  try {
    const raw = sessionStorage.getItem(`uonify-mock:${name}`);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Cuenta con la sesión abierta en la simulación del acceso (módulo auth). El
 * backend real la sabe por la cookie; aquí se lee de lo que guarda su simulación
 * y, si no hay, se usa una cuenta de ejemplo.
 */
export function sessionIdentity(): Identity {
  const session = readMockStore('auth-session') as { email?: unknown } | undefined;
  const email = typeof session?.email === 'string' && session.email ? session.email : '';
  if (!email) return FALLBACK_IDENTITY;
  const profiles = readMockStore('auth-profiles');
  const stored = Array.isArray(profiles) ? profiles.find(item => item && typeof item === 'object' && (item as { id?: unknown }).id === email.toLowerCase()) : undefined;
  const profile = (stored as { profile?: { name?: unknown; firstName?: unknown; lastName?: unknown } } | undefined)?.profile;
  const name = typeof profile?.name === 'string' && profile.name.trim()
    ? profile.name.trim()
    : [profile?.firstName, profile?.lastName].filter(part => typeof part === 'string' && part).join(' ');
  return { name: name || email.split('@')[0], email };
}

// ── Dispositivo actual (para la sesión «Esta sesión») ────────────────────────
export function currentDevice(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): Pick<ActiveSession, 'browser' | 'os' | 'device'> {
  const ua = userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'tu dispositivo';
  const device = /iPad|Tablet/.test(ua) ? 'tablet' : /Mobi|iPhone|Android/.test(ua) ? 'mobile' : 'desktop';
  return { browser, os, device };
}

// ── Registros ────────────────────────────────────────────────────────────────
/** record() con reset() (vuelve a la semilla), para las pruebas. */
function seeded<T>(name: string, seed: () => T) {
  const item = record<T>(name, seed);
  return Object.assign(item, { reset: () => item.set(seed()) });
}

export const accountRecord = seeded<Account>('settings-account', () => {
  const identity = sessionIdentity();
  return {
    id: 'acc_7F3K2Q9M',
    name: identity.name,
    email: identity.email,
    language: 'es-ES',
    timeZone: 'Europe/Madrid',
    avatarUrl: null,
    createdAt: iso(-12 * DAY),
  };
});

export interface PendingEmail {
  email: string;
  sentAt: number;
}
export const pendingEmailRecord = seeded<PendingEmail | null>('settings-pending-email', () => null);

export interface MfaState {
  totp: { enabled: boolean; secret: string | null; addedAt: string | null };
  sms: { enabled: boolean; phone: string | null; addedAt: string | null };
  recovery: { codes: string[]; used: number; generatedAt: string | null };
  pendingTotp: { setupId: string; secret: string } | null;
  pendingSms: { setupId: string; phone: string } | null;
  /** Instantes de los SMS enviados (límites de envío). */
  smsSentAt: number[];
}

export const mfaRecord = seeded<MfaState>('settings-mfa', () => ({
  totp: { enabled: false, secret: null, addedAt: null },
  sms: { enabled: false, phone: null, addedAt: null },
  recovery: { codes: [], used: 0, generatedAt: null },
  pendingTotp: null,
  pendingSms: null,
  smsSentAt: [],
}));

export const sessionsStore = collection<ActiveSession>('settings-sessions', () => [
  { id: 'ses-current', ...currentDevice(), location: 'Madrid, España', signInMethod: 'chatgpt', createdAt: iso(-2 * HOUR), lastActiveAt: iso(0), current: true },
  { id: 'ses-iphone', browser: 'Safari', os: 'iOS', device: 'mobile', location: 'Barcelona, España', signInMethod: 'chatgpt', createdAt: iso(-6 * DAY), lastActiveAt: iso(-3 * HOUR), current: false },
  { id: 'ses-windows', browser: 'Edge', os: 'Windows', device: 'desktop', location: 'Valencia, España', signInMethod: 'email', createdAt: iso(-9 * DAY), lastActiveAt: iso(-4 * DAY), current: false },
]);

export const signInMethodsRecord = seeded<SignInMethod[]>('settings-sign-in-methods', () => {
  const { email } = sessionIdentity();
  return [
    { id: 'chatgpt', linked: true, email, linkedAt: iso(-12 * DAY) },
    { id: 'google', linked: false, email: null, linkedAt: null },
    { id: 'email', linked: true, email, linkedAt: iso(-12 * DAY) },
  ];
});

export const connectionsRecord = seeded<Connections>('settings-connections', () => ({
  chatgpt: { status: 'connected', email: sessionIdentity().email, plan: 'Plus', connectedAt: iso(-12 * DAY) },
  amazon: { status: 'disconnected', marketplace: 'Amazon.es', sellerName: null, sellerId: null, authorizedAt: null, expiresAt: null, dataDeletionBy: null },
  shopify: { status: 'coming_soon' },
}));

export interface TeamState {
  planId: string;
  youId: string;
}
/** Plan del espacio para las plazas. El backend lo sabe por la suscripción; la simulación empieza en Gratis. */
export const teamRecord = seeded<TeamState>('settings-team', () => ({ planId: 'free', youId: 'mem-owner' }));

export const membersStore = collection<TeamMember>('settings-team-members', () => [
  { id: 'mem-owner', name: '', email: '', role: 'owner', status: 'active', invitedAt: null, joinedAt: iso(-12 * DAY), lastActiveAt: iso(0) },
]);

export const brandsStore = collection<StoredBrandProfile>('settings-brands', () => [{
  id: 'brand-bmb', revision: 1, createdAt: Date.now(), updatedAt: Date.now(),
  brand: 'Basic Mini Bricks',
  manufacturer: { name: 'Basic Mini Bricks, S.L.', postalAddress: { street: 'Calle Mayor 10', postalCode: '28013', city: 'Madrid', country: 'ES' }, email: 'calidad@basicminibricks.example', pointOfContact: '' },
  euResponsible: null,
  autoApply: true,
}]);

export interface PrivacyState {
  cookies: CookiePreferences;
  deletion: { status: 'none' | 'scheduled'; scheduledFor: string | null };
  acceptedAt: string;
}
export const privacyRecord = seeded<PrivacyState>('settings-privacy', () => ({
  cookies: { analytics: false, marketing: false, updatedAt: null },
  deletion: { status: 'none', scheduledFor: null },
  acceptedAt: iso(-12 * DAY),
}));

export const exportsStore = collection<DataExport>('settings-exports', () => []);

/** Solo pruebas: vuelve a la semilla (sessionStorage y caché en memoria). */
export function resetSettingsMocks(): void {
  [accountRecord, pendingEmailRecord, mfaRecord, signInMethodsRecord, connectionsRecord, teamRecord, privacyRecord].forEach(item => item.reset());
  [sessionsStore, membersStore, brandsStore, exportsStore].forEach(store => store.reset());
}
