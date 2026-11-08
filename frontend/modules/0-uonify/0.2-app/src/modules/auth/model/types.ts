/**
 * Tipos del acceso a Uonify. La sesión es una cookie del backend; el navegador
 * nunca ve tokens de OpenAI ni de Google.
 */

/** Planes de Uonify (decisión del dueño: Gratis, Básico, Pro, Max y Personalizado). */
export type PlanId = 'free' | 'basic' | 'pro' | 'max' | 'custom';

export type AgeRange = 'under18' | '18-24' | '25-34' | '35-44' | '45-54' | '55+';

/** Formas de entrar (decisión del dueño: sin contraseña, sin Microsoft ni Apple por ahora). */
export type AuthProvider = 'chatgpt' | 'google' | 'email';

/** Proveedores con acceso OAuth (el correo va con código). */
export type OAuthProvider = Exclude<AuthProvider, 'email'>;

/** Perfil que se guarda al terminar el alta (POST /api/profile). */
export interface Profile {
  billingInterval?: 'monthly' | 'annual';
  firstName: string;
  lastName: string;
  /** «Nombre Apellidos» (lo envía el prototipo para el backend). */
  name: string;
  email: string;
  ageRange: string;
  role: string;
  companySize: string;
  company: string;
  primaryGoal: string;
  source: string;
  /** Plan elegido en el alta: el cobro lo hace billing (startCheckout). */
  desiredPlan: PlanId;
}

/** Valores del formulario de alta, tal como los edita la persona. */
export interface ProfileValues {
  billingInterval?: 'monthly' | 'annual';
  firstName: string;
  lastName: string;
  email: string;
  ageRange: string;
  role: string;
  companySize: string;
  company: string;
  primaryGoal: string;
  source: string;
  plan: PlanId;
}

/** Documentos que se aceptan con versión y fecha (paso «Condiciones» y permiso de ChatGPT). */
export type ConsentId = 'terms' | 'privacy' | 'ai-third-party' | 'chatgpt-plan';

export interface ConsentRecord {
  id: ConsentId;
  version: string;
  /** ISO 8601. */
  acceptedAt: string;
}

/**
 * Permiso para que Uony use el plan de ChatGPT del cliente (segundo consentimiento,
 * aparte del inicio de sesión). Cerrar sesión no lo desconecta.
 */
export interface ChatGPTPlanStatus {
  status: 'connected' | 'not_connected';
  /** Cuenta de ChatGPT conectada. */
  email?: string;
  connectedAt?: string;
}

export type SessionStatus = 'loading' | 'signed-out' | 'onboarding' | 'ready';

export interface AuthUser {
  email: string;
  /** Con qué entró (null si el backend no lo dice). */
  provider: AuthProvider | null;
}

/** Respuesta de GET /api/auth/session (contrato del backend). */
export interface SessionPayload {
  accountDeletionPending?: boolean;
  onboardingStage?: 'identity' | 'profile';
  onboarding?: { step: 'terms' | 'you' | 'work' | 'pending' };
  authenticated: boolean;
  email?: string;
  account?: { email?: string; provider?: string };
  /** Datos que da el proveedor de identidad (para rellenar el alta). */
  identity?: { provider?: string; email?: string; name?: string };
  profile?: Partial<Profile> | null;
  profileComplete?: boolean;
  ageConfirmedAdult?: boolean;
  consents?: unknown;
  chatgptPlan?: unknown;
}

/** Sesión normalizada con la que trabaja el frontend. */
export interface AuthSession {
  accountDeletionPending?: boolean;
  onboardingStage?: 'identity' | 'profile';
  onboarding?: { step: 'terms' | 'you' | 'work' | 'pending' };
  authenticated: boolean;
  email: string;
  provider: AuthProvider | null;
  /** Nombre que da el proveedor de identidad ('' si no lo da). */
  identityName: string;
  profile: Profile | null;
  /** Alta completa: perfil, mayoría de edad y condiciones aceptadas, según el backend. */
  profileReady: boolean;
  consents: ConsentRecord[];
  chatgptPlan: ChatGPTPlanStatus;
}

/**
 * GET /api/auth/config. `preview`: el backend simula los accesos sin salir de
 * Uonify (desarrollo y revisión); `redirect`: acceso real en OpenAI o Google.
 */
export interface AuthConfig {
  provider: OAuthProvider;
  onboardingStage?: 'identity' | 'profile';
  onboarding?: { step: 'terms' | 'you' | 'work' | 'pending' };
  ready?: boolean;
  mode: 'preview' | 'redirect';
  /** Accesos disponibles (por defecto, los tres). */
  providers?: AuthProvider[];
}

/** POST /api/auth/{chatgpt|google}/start. `loginHint` solo en modo `preview`. */
export interface StartRequest {
  returnTo: string;
  loginHint?: string;
}

/** Respuesta de start: URL del proveedor (redirect) o la sesión ya creada (preview). */
export interface StartResponse {
  authUrl?: string;
  authorizationUrl?: string;
  session?: SessionPayload;
}

/** Respuesta de POST /api/auth/email/start. */
export interface EmailStartResponse {
  email: string;
  expiresInSeconds: number;
  resendInSeconds: number;
  attemptsLeft: number;
  /** Solo en modo demostración: el código, porque no se envía ningún correo. */
  previewCode?: string;
}

/** Respuesta de POST /api/auth/email/verify. */
export interface EmailVerifyResponse {
  session: SessionPayload;
}

/** Respuesta de POST /api/profile. */
export interface ProfileSaveResponse {
  profileComplete: boolean;
  ageConfirmedAdult: boolean;
  profile?: Profile;
}

/** Respuesta de POST /api/auth/chatgpt/plan: conectado (preview) o la URL del permiso en OpenAI. */
export interface PlanConnectResponse {
  plan?: ChatGPTPlanStatus;
  /** Todas las aceptaciones, con la del permiso («chatgpt-plan»). */
  consents?: unknown;
  authUrl?: string;
}
