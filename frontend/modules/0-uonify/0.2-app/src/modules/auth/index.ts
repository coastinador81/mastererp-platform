/**
 * Módulo de acceso de Uonify: «Continuar con ChatGPT», Google y el correo con
 * código; el alta en seis pasos con las pantallas y permisos que pide OpenAI; y la
 * bienvenida al espacio. «Mi cuenta» es ahora Configuración (módulo settings).
 * Contrato del backend y uso: README.md.
 */

// Contrato principal (ARCHITECTURE.md)
export { useSession, type SessionState } from './hooks/useSession';
export { openSignIn, type OpenSignInOptions } from './flows/entry';
export { signOut, openAccount } from './flows/account';
export { AccountDeletionControl } from './components/AccountDeletionControl';
export { openAccountDeletion } from './flows/accountDeletion';
export { AuthDialogs } from './components/AuthDialogs';
export { useAccountSummary, useAuthLinks } from './hooks/useAccountSummary';

// Integración con el espacio (prototipo: window.UonifyAuth)
export { requirePrompt, ensureWorkspaceReady, takePendingPrompt } from './flows/entry';

// Cuenta actual para datos guardados por cuenta en el navegador (pim-video, pim-imagenes)
export { currentAccountEmail } from './state/session';

// Configuración › Privacidad y legal y › Conexiones (settings)
export { useConsents, useChatGPTPlan, type AcceptedConsent } from './hooks/useConsents';
export { connectChatGPTPlan, disconnectChatGPTPlan, type PlanConnectResult } from './flows/chatgptPlan';
export { CONSENT_DOCUMENTS, CHATGPT_PLAN_TERMS, CHATGPT_BILLING_ROWS, type ConsentDocument } from './model/legal';

export type { AccountSummary, AuthLinks } from './model/session';
export type { AuthProvider, AuthUser, ChatGPTPlanStatus, ConsentId, ConsentRecord, PlanId, Profile, SessionStatus } from './model/types';

// Integración entre adaptadores MSW; sustituir por la sesión del servidor en producción.
export { mockBillingAccount } from './mocks/authDb';

export { useAccessTransition } from './hooks/useAccessTransition';
export { ConversationActivationGate, ConversationActivationPanel, ConversationActivationAccess, useConversationActivationOpen } from './components/ConversationActivation';
export { openConversationActivation } from './state/activation';
export type { FirstIntentDelivery } from './model/activation';
export { acknowledgePendingPrompt, readPendingPrompt } from './flows/entry';
