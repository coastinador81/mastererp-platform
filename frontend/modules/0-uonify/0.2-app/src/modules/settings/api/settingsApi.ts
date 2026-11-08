import { api } from '@/shared/api/client';
import type {
  Account,
  AccountPatch,
  ActiveSession,
  ConnectResponse,
  Connections,
  CookiePreferences,
  DataExport,
  EmailChangeStart,
  InvitableRole,
  MfaActivation,
  MfaStatus,
  PrivacyOverview,
  SignInMethod,
  SignInMethodId,
  SmsSetup,
  Team,
  TeamMember,
  TotpSetup,
} from '../model/types';
import type { BrandGpsrProfile, StoredBrandProfile } from '../model/brandGpsrProfile';
import { ENDPOINTS } from './endpoints';

/** Llamadas tipadas de Configuración (contrato en model/types.ts y mocks/handlers.ts). */

// Cuenta
export const getAccount = (signal?: AbortSignal) => api.get<Account>(ENDPOINTS.account, { signal });
export const patchAccount = (patch: AccountPatch) => api.patch<Account>(ENDPOINTS.account, patch);
export function uploadAvatar(file: File) {
  const body = new FormData();
  body.append('file', file);
  return api.post<{ avatarUrl: string }>(ENDPOINTS.accountAvatar, body);
}
export const deleteAvatar = () => api.delete<{ avatarUrl: null }>(ENDPOINTS.accountAvatar);
export const startEmailChange = (email: string) => api.post<EmailChangeStart>(ENDPOINTS.accountEmailStart, { email });
export const confirmEmailChange = (code: string) => api.post<Account>(ENDPOINTS.accountEmailConfirm, { code });

// Seguridad
export const getMfa = (signal?: AbortSignal) => api.get<MfaStatus>(ENDPOINTS.mfa, { signal });
export const startTotp = () => api.post<TotpSetup>(ENDPOINTS.totpSetup);
export const verifyTotp = (setupId: string, code: string) => api.post<MfaActivation>(ENDPOINTS.totpVerify, { setupId, code });
export const disableTotp = () => api.delete<MfaStatus>(ENDPOINTS.totp);
export const startSms = (phone: string) => api.post<SmsSetup>(ENDPOINTS.smsStart, { phone });
export const verifySms = (setupId: string, code: string) => api.post<MfaActivation>(ENDPOINTS.smsVerify, { setupId, code });
export const disableSms = () => api.delete<MfaStatus>(ENDPOINTS.sms);
export const regenerateRecoveryCodes = () => api.post<MfaActivation>(ENDPOINTS.recoveryCodes);
export const getSessions = (signal?: AbortSignal) => api.get<{ sessions: ActiveSession[] }>(ENDPOINTS.sessions, { signal }).then(r => r.sessions);
export const endSession = (id: string) => api.delete<{ ok: true }>(ENDPOINTS.session(id));
export const endAllSessions = () => api.delete<{ ok: true; ended: number }>(ENDPOINTS.sessions);
export const getSignInMethods = (signal?: AbortSignal) => api.get<{ methods: SignInMethod[] }>(ENDPOINTS.signInMethods, { signal }).then(r => r.methods);
export const linkSignInMethod = (id: SignInMethodId) => api.post<{ authUrl?: string; methods?: SignInMethod[] }>(ENDPOINTS.signInMethod(id));
export const unlinkSignInMethod = (id: SignInMethodId) => api.delete<{ methods: SignInMethod[] }>(ENDPOINTS.signInMethod(id));

// Conexiones
export const getConnections = (signal?: AbortSignal) => api.get<Connections>(ENDPOINTS.connections, { signal });
export const connectProvider = (provider: 'chatgpt' | 'amazon') => api.post<ConnectResponse>(ENDPOINTS.connect(provider), { returnTo: '/espacio/configuracion/conexiones' });
export const disconnectProvider = (provider: 'chatgpt' | 'amazon') => api.delete<Connections>(ENDPOINTS.disconnect(provider));
export const renewAmazon = () => api.post<ConnectResponse>(ENDPOINTS.amazonRenew, { returnTo: '/espacio/configuracion/conexiones' });

// Usuarios
export const getTeam = (signal?: AbortSignal) => api.get<Team>(ENDPOINTS.team, { signal });
export const inviteMember = (email: string, role: InvitableRole) => api.post<TeamMember>(ENDPOINTS.invitations, { email, role });
export const resendInvitation = (id: string) => api.post<{ ok: true }>(ENDPOINTS.invitationResend(id));
export const changeRole = (id: string, role: InvitableRole) => api.patch<TeamMember>(ENDPOINTS.member(id), { role });
export const removeMember = (id: string) => api.delete<{ ok: true }>(ENDPOINTS.member(id));

// GPSR por marca (perfil BrandGpsrProfile; /api/brands — el {brand} del path es el NOMBRE de la marca).
export const getBrands = (signal?: AbortSignal) => api.get<{ brands: StoredBrandProfile[] }>(ENDPOINTS.brands, { signal }).then(r => r.brands);
export const getBrand = (brand: string, signal?: AbortSignal) => api.get<{ brand: StoredBrandProfile }>(ENDPOINTS.brand(brand), { signal }).then(r => r.brand);
export const putBrand = (brand: string, body: BrandGpsrProfile & { revision?: number }) => api.put<{ brand: StoredBrandProfile }>(ENDPOINTS.brand(brand), body).then(r => r.brand);
export const deleteBrand = (brand: string) => api.delete<{ ok: true }>(ENDPOINTS.brand(brand));

// Privacidad
export const getPrivacy = (signal?: AbortSignal) => api.get<PrivacyOverview>(ENDPOINTS.privacy, { signal });
export const requestExport = () => api.post<DataExport>(ENDPOINTS.privacyExport);
export const downloadExport = (id: string) => api.get<Blob>(ENDPOINTS.privacyExportDownload(id), { responseType: 'blob' });
export const saveCookies = (prefs: Pick<CookiePreferences, 'analytics' | 'marketing'>) => api.put<CookiePreferences>(ENDPOINTS.privacyCookies, prefs);
export const scheduleDeletion = (confirm: string) => api.post<PrivacyOverview['deletion']>(ENDPOINTS.privacyDeletion, { confirm });
export const cancelDeletion = () => api.delete<PrivacyOverview['deletion']>(ENDPOINTS.privacyDeletion);

// Uso (solo lectura: /ai/usage es de workspace y /billing/* de billing)
export const getAiUsage = (signal?: AbortSignal) => api.get<unknown>(ENDPOINTS.aiUsage, { signal });
export const getBalance = (signal?: AbortSignal) => api.get<unknown>(ENDPOINTS.billingBalance, { signal });
export const getMovements = (signal?: AbortSignal) => api.get<unknown>(ENDPOINTS.billingMovements, { signal, params: { limit: 10 } });
