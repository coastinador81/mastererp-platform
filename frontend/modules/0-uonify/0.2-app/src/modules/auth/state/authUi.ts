import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { ChatGPTChoice } from '../model/onboarding';
import { emptyProfileValues } from '../model/profile';
import type { OAuthProvider, ProfileValues } from '../model/types';

/**
 * Estado de interfaz del acceso: qué diálogo está abierto, la capa de transición
 * y los formularios. Los flujos (flows/) lo cambian; <AuthDialogs/> lo pinta.
 * Solo hay un diálogo abierto a la vez, como en el prototipo.
 */
export type AuthDialogName = 'signin' | 'connect' | 'profile';
export type TransitionContext = 'access' | 'workspace';
/** Vistas del diálogo de acceso: las tres formas de entrar, el correo y el código. */
export type SignInView = 'providers' | 'email' | 'code';

export interface TransitionView {
  open: boolean;
  visible: boolean;
  ready: boolean;
  leaving: boolean;
  error: boolean;
  context: TransitionContext;
  kicker: string;
  title: string;
  copy: string;
  /** Paso de los tres indicadores (3 = todos completos). */
  step: number;
  /** Cambia con cada mensaje para repetir su animación de entrada. */
  messageKey: number;
  retry: boolean;
  cancel: boolean;
}

export interface SignInState {
  prompt: string;
  status: string;
  providerDisabled: boolean;
  view: SignInView;
  email: string;
  code: string;
  /** Enviando el código o comprobándolo. */
  busy: boolean;
  /** Error del correo o del código (role="alert"). */
  error: string;
  /** Cuándo se puede pedir otro código (ms). */
  resendAt: number;
  /** Cuándo caduca el código (ms). */
  expiresAt: number;
  /** Código del modo demostración (no se envía ningún correo). */
  previewCode: string;
  /** El código actual ya no sirve: hay que pedir otro. */
  codeDead: boolean;
}

/** Casillas del paso «Condiciones» (sin marcar por defecto). */
export interface TermsChecks {
  terms: boolean;
  privacy: boolean;
  'ai-third-party': boolean;
}

export interface ProfileState {
  step: number;
  values: ProfileValues;
  emailLocked: boolean;
  saving: boolean;
  status: string;
  terms: TermsChecks;
  chatgptChoice: ChatGPTChoice;
  /** Casilla del permiso del plan de ChatGPT. */
  chatgptConsent: boolean;
}

export interface AuthUiState {
  dialog: AuthDialogName | null;
  /** Velo difuminado detrás de todos los pasos (#uon-onboarding-surface). */
  surface: { active: boolean; leaving: boolean };
  /** El espacio aparece con su animación (html.uon-workspace-revealing). */
  revealing: boolean;
  signIn: SignInState;
  /** Modo demostración de ChatGPT o Google: la cuenta se elige sin salir de Uonify. */
  connect: { email: string; submitting: boolean; provider: OAuthProvider };
  profile: ProfileState;
  transition: TransitionView;
  /** Petición de foco (selector CSS o elemento) que <AuthDialogs/> aplica tras pintar. */
  focus: { target: string | HTMLElement; seq: number } | null;
}

const closedTransition = (): TransitionView => ({
  open: false,
  visible: false,
  ready: false,
  leaving: false,
  error: false,
  context: 'access',
  kicker: 'ACCESO A UONIFY',
  title: 'Preparando tu entorno',
  copy: 'Un momento. Estamos preparando tu espacio de trabajo.',
  step: 0,
  messageKey: 0,
  retry: false,
  cancel: false,
});

export const emptyTerms = (): TermsChecks => ({ terms: false, privacy: false, 'ai-third-party': false });

export const initialSignIn = (): SignInState => ({
  prompt: '',
  status: '',
  providerDisabled: false,
  view: 'providers',
  email: '',
  code: '',
  busy: false,
  error: '',
  resendAt: 0,
  expiresAt: 0,
  previewCode: '',
  codeDead: false,
});

const initialState = (): AuthUiState => ({
  dialog: null,
  surface: { active: false, leaving: false },
  revealing: false,
  signIn: initialSignIn(),
  connect: { email: '', submitting: false, provider: 'chatgpt' },
  profile: {
    step: 0,
    values: emptyProfileValues(),
    emailLocked: false,
    saving: false,
    status: '',
    terms: emptyTerms(),
    chatgptChoice: '',
    chatgptConsent: false,
  },
  transition: closedTransition(),
  focus: null,
});

export const authUi = createStore<AuthUiState>(initialState);

export function useAuthUi<T>(selector: (state: AuthUiState) => T): T {
  return useStore(authUi, selector);
}

export const getUi = (): AuthUiState => authUi.getState();

export function patchUi(patch: Partial<AuthUiState>): void {
  authUi.setState(patch);
}

export function patchTransition(patch: Partial<TransitionView>): void {
  authUi.setState(state => ({ transition: { ...state.transition, ...patch } }));
}

export function resetTransition(): void {
  authUi.setState({ transition: closedTransition() });
}

export function patchSignIn(patch: Partial<SignInState>): void {
  authUi.setState(state => ({ signIn: { ...state.signIn, ...patch } }));
}

export function patchConnect(patch: Partial<AuthUiState['connect']>): void {
  authUi.setState(state => ({ connect: { ...state.connect, ...patch } }));
}

export function patchProfile(patch: Partial<ProfileState>): void {
  authUi.setState(state => ({ profile: { ...state.profile, ...patch } }));
}

export function setProfileValue<K extends keyof ProfileValues>(key: K, value: ProfileValues[K]): void {
  authUi.setState(state => ({ profile: { ...state.profile, values: { ...state.profile.values, [key]: value } } }));
}

export function setTermsCheck(key: keyof TermsChecks, checked: boolean): void {
  authUi.setState(state => ({ profile: { ...state.profile, status: '', terms: { ...state.profile.terms, [key]: checked } } }));
}

export function setSurface(active: boolean): void {
  authUi.setState({ surface: { active, leaving: false } });
}

export function requestFocus(target: string | HTMLElement): void {
  authUi.setState(state => ({ focus: { target, seq: (state.focus?.seq ?? 0) + 1 } }));
}

/** Algún paso del acceso está a la vista (diálogo o transición). */
export const flowActive = (state: AuthUiState): boolean => state.dialog !== null || state.transition.open;

/** Solo pruebas: vuelve al estado inicial. */
export function resetAuthUi(): void {
  authUi.setState(initialState(), true);
}
