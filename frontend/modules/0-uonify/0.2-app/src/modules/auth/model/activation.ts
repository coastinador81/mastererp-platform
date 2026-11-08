export type ActivationStep = 'profile' | 'drive' | 'cloud' | 'subscription' | 'complete';
export interface ActivationStepProgress { id: string; label: string; index: number; total: number }
export interface FirstIntentDelivery {
  requestId: string; threadId: string; text: string; model: string; effort: 'low' | 'medium' | 'high';
  status: 'pending' | 'sending' | 'complete' | 'unknown' | 'blocked'; message: string;
}
export interface SetupOperation {
  id: string;
  status: 'preparing' | 'action_required' | 'ready' | 'unknown';
  step: string;
  projectId: string | null;
  projectName: string | null;
  message: string;
  canResume: boolean;
  modelTest: 'not_started' | 'pending' | 'passed' | 'failed' | 'unknown';
  mode: 'create' | 'existing';
  billingAccountName: string | null;
  modelTestConsent: boolean;
  retryOf?: string | null;
  revisionOf?: string | null;
  additionalModelCostAccepted?: boolean;
  canRetryModel?: boolean;
  canDiagnose?: boolean;
  accessCheck?: { status: 'waiting' | 'blocked' | 'eligible' | 'unresolved'; checkedAt: string; nextCheckAt: string | null; message: string } | null;
  errorDetails?: { category: 'authorization' | 'billing' | 'api' | 'permissions' | 'quota' | 'model' | 'policy' | 'connection' | 'unknown'; message: string } | null;
  recovery?: { kind: 'billing' | 'api' | 'permissions' | 'model' | 'authorization' | 'retry_model' | 'diagnostics'; message: string; label: string; url: string | null } | null;
}
export interface ActivationState {
  step: ActivationStep;
  drive: { connected: boolean; deferred: boolean };
  cloud: { connected: boolean; ready: boolean; projectId: string | null; projectName: string | null; operation: SetupOperation | null };
  setupReady: boolean;
  aiReady: boolean;
  activation?: { basis: 'trial' | 'paid'; endsAt: string } | null;
  firstIntent: string;
  firstIntentDelivery?: FirstIntentDelivery | null;
}
export const ACTIVATION_STEPS: { id: ActivationStep; label: string }[] = [
  { id: 'profile', label: 'Tu cuenta' }, { id: 'drive', label: 'Tus archivos' },
  { id: 'cloud', label: 'Tu IA' }, { id: 'subscription', label: 'Activación' },
];
