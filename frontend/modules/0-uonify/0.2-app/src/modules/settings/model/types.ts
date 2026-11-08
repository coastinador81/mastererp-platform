/**
 * Contrato del backend de Configuración (rutas en api/ y simulación en mocks/).
 * Fechas en ISO 8601. La sesión viaja en la cookie: el navegador nunca ve tokens
 * de ChatGPT, Google ni Amazon.
 */

// ── Cuenta (/account) ────────────────────────────────────────────────────────
export type LanguageCode = 'es-ES' | 'en';

export interface Account {
  id: string;
  name: string;
  email: string;
  language: LanguageCode;
  timeZone: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface AccountPatch {
  name?: string;
  language?: LanguageCode;
  timeZone?: string;
}

export interface EmailChangeStart {
  sentTo: string;
  /** Segundos hasta poder pedir otro código. */
  resendInSec: number;
  expiresInSec: number;
}

// ── Seguridad (/security) ────────────────────────────────────────────────────
export interface MfaStatus {
  /** Hay al menos un segundo paso activo (app o SMS). */
  enabled: boolean;
  totp: { enabled: boolean; addedAt: string | null };
  sms: { enabled: boolean; phoneMasked: string | null; addedAt: string | null };
  recoveryCodes: { remaining: number; total: number; generatedAt: string | null };
  /** El correo solo sirve para recuperar la cuenta, nunca como segundo paso. */
  recoveryEmail: string;
}

export interface TotpSetup {
  setupId: string;
  /** Clave en base32 para escribirla a mano. */
  secret: string;
  otpauthUrl: string;
  /** Imagen del QR (data:image/svg+xml o PNG) generada por el backend. */
  qrDataUrl: string;
}

export interface SmsSetup {
  setupId: string;
  phoneMasked: string;
  resendInSec: number;
}

/** Respuesta al activar un método: los códigos de recuperación solo llegan con el primero. */
export interface MfaActivation {
  status: MfaStatus;
  recoveryCodes?: string[];
}

export type SignInMethodId = 'chatgpt' | 'google' | 'email';

export interface SignInMethod {
  id: SignInMethodId;
  linked: boolean;
  email: string | null;
  linkedAt: string | null;
}

export interface ActiveSession {
  id: string;
  browser: string;
  os: string;
  device: 'desktop' | 'mobile' | 'tablet';
  location: string;
  signInMethod: SignInMethodId;
  createdAt: string;
  lastActiveAt: string;
  current: boolean;
}

// ── Conexiones (/connections) ────────────────────────────────────────────────
export type ChatGptStatus = 'connected' | 'disconnected' | 'expired';
export type AmazonStatus = 'connected' | 'disconnected' | 'expired' | 'revoked';

export interface ChatGptConnection {
  status: ChatGptStatus;
  email: string | null;
  /** «Plus», «Pro», «Business»… tal como lo informa OpenAI. */
  plan: string | null;
  connectedAt: string | null;
}

export interface AmazonConnection {
  status: AmazonStatus;
  marketplace: string;
  sellerName: string | null;
  sellerId: string | null;
  authorizedAt: string | null;
  /** La autorización de Selling Partner API caduca a los 365 días. */
  expiresAt: string | null;
  /** Tras desconectar: fecha límite del borrado de los datos de Amazon (30 días). */
  dataDeletionBy: string | null;
}

export interface Connections {
  chatgpt: ChatGptConnection;
  amazon: AmazonConnection;
  shopify: { status: 'coming_soon' };
}

/** Conectar con el proveedor real redirige; la simulación devuelve ya la conexión. */
export interface ConnectResponse {
  authUrl?: string;
  connections?: Connections;
}

// ── Usuarios (/team) ─────────────────────────────────────────────────────────
export type TeamRole = 'owner' | 'admin' | 'editor';
export type InvitableRole = Exclude<TeamRole, 'owner'>;

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  status: 'active' | 'invited';
  invitedAt: string | null;
  joinedAt: string | null;
  lastActiveAt: string | null;
}

export interface Team {
  planId: string;
  planName: string;
  /** Plazas incluidas (null = según acuerdo, plan Personalizado). */
  seats: { used: number; total: number | null };
  members: TeamMember[];
  /** Id del miembro con la sesión abierta. */
  youId: string;
}

// ── GPSR por marca (/brands) ─────────────────────────────────────────────────
export interface GpsrParty {
  name: string;
  address: string;
  /** Correo electrónico o web de contacto. */
  contact: string;
}

export interface BrandGpsr {
  id: string;
  brand: string;
  manufacturer: GpsrParty;
  euResponsible: GpsrParty;
  /** Rellenar con estos datos los productos nuevos de la marca. */
  autoApply: boolean;
  updatedAt: string;
}

export type BrandGpsrInput = Omit<BrandGpsr, 'id' | 'updatedAt'>;

// ── Privacidad (/privacy) ────────────────────────────────────────────────────
export interface DataExport {
  id: string;
  status: 'preparing' | 'ready' | 'expired';
  requestedAt: string;
  readyAt: string | null;
  expiresAt: string | null;
  sizeBytes: number | null;
}

export interface CookiePreferences {
  analytics: boolean;
  marketing: boolean;
  updatedAt: string | null;
}

export interface AcceptedDocument {
  id: string;
  title: string;
  version: string;
  acceptedAt: string;
  href: string;
}

export interface PrivacyOverview {
  exports: DataExport[];
  cookies: CookiePreferences;
  deletion: { status: 'none' | 'scheduled'; scheduledFor: string | null };
  documents: AcceptedDocument[];
}
