import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { OnboardingSubscription } from '@/modules/billing';
import { DriveOnboarding } from '@/modules/drive';
import { Topbar } from '@/modules/workspace';
import { errorMessage } from '@/shared/api/client';
import { Icon, InformationDisclosure } from '@/shared/ui';
import { USE_MOCKS } from '@/shared/api/config';
import { useActivationSetup } from '../hooks/useActivationSetup';
import { useSession } from '../hooks/useSession';
import { ACTIVATION_STEPS, type ActivationStep, type ActivationStepProgress } from '../model/activation';
import { STEP_INDEX } from '../model/options';
import { readKey, STORAGE_KEYS, writeKey } from '../model/storage';
import { useActivationRequest, closeConversationActivation } from '../state/activation';
import { currentAccountEmail } from '../state/session';
import { getUi } from '../state/authUi';
import { completeIntegratedOnboarding } from '../flows/integratedProfile';
import { showProfile } from '../flows/profile';
import { ActivationProfile } from './ActivationProfile';
import { ActivationCloud } from './ActivationCloud';
import { ActivationFrame } from './ActivationFrame';
import { ActivationProgress } from './ActivationProgress';
import { ActivationAccountMenu } from './ActivationAccountMenu';
import { ActivationComplete } from './ActivationComplete';
import '../styles/setup.css';
import '../styles/activation.css';

/** Solo prepara la cuenta: ningún módulo o agente general se monta antes del acceso. */
export function ConversationActivationGate({ children }: { children: ReactNode }) {
  const { status, user, accountDeletionPending } = useSession();
  if (USE_MOCKS || accountDeletionPending || status !== 'onboarding' || !user) return children;
  return <ActivationScreen key={user.email} account={user.email} />;
}

export function ConversationActivationAccess({ account, onFinished }: { account: string; onFinished?: () => Promise<void> }) {
  return <ActivationScreen key={account} account={account} initial={false} onFinished={onFinished} />;
}

function ActivationScreen({ account, initial = true, onFinished }: { account: string; initial?: boolean; onFinished?: () => Promise<void> }) {
  useEffect(() => { if (initial) showProfile(); }, [account, initial]);
  return <div className="activation-screen">
    <Topbar preparing inert={false} accountMenu={<ActivationAccountMenu />} />
    <main className="activation-conversation" aria-label="Conversación de bienvenida con Uony">
      <ActivationJourney account={account} initial={initial} withComposer onFinished={onFinished} />
    </main>
  </div>;
}

/** Recuperación de una conexión dentro de la conversación ya abierta. */
export function ConversationActivationPanel() {
  const requested = useActivationRequest(state => state.account);
  const { user, status } = useSession();
  if (USE_MOCKS || status !== 'ready' || !user || requested !== user.email) return null;
  return <ActivationJourney key={user.email} account={user.email} />;
}

export function useConversationActivationOpen() {
  const { user } = useSession();
  return useActivationRequest(state => !!user && state.account === user.email);
}

function ActivationJourney({ account, initial = false, withComposer = false, onFinished }: { account: string; initial?: boolean; withComposer?: boolean; onFinished?: () => Promise<void> }) {
  const query = useActivationSetup(account);
  const cache = useQueryClient();
  const [review, setReview] = useState<ActivationStep | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const cloudPrepared = useCallback(() => setReview('cloud'), []);
  const [parts, setParts] = useState<Partial<Record<ActivationStep, ActivationStepProgress>>>({});
  const profileProgress = useCallback((progress: ActivationStepProgress) => setParts(value => ({ ...value, profile: progress })), []);
  const driveProgress = useCallback((progress: ActivationStepProgress) => setParts(value => ({ ...value, drive: progress })), []);
  const cloudProgress = useCallback((progress: ActivationStepProgress) => setParts(value => ({ ...value, cloud: progress })), []);
  const subscriptionProgress = useCallback((progress: ActivationStepProgress) => setParts(value => ({ ...value, subscription: progress })), []);
  const [message, setMessage] = useState('');
  const [finishing, setFinishing] = useState(false);
  const finishLocked = useRef(false);
  const seeded = useRef(false);
  const refresh = async () => { await query.refetch({ throwOnError: true }); };
  const intent = query.data?.firstIntent || readKey(STORAGE_KEYS.pendingPrompt) || '';
  useEffect(() => {
    if (!query.data || seeded.current || currentAccountEmail() !== account) return;
    seeded.current = true;
    if (!query.data.firstIntent && intent.trim()) void query.saveIntent(intent.trim()).catch(failure => setMessage(errorMessage(failure)));
  }, [query, account, intent]);
  const finish = async () => {
    if (currentAccountEmail() !== account || finishLocked.current) return;
    finishLocked.current = true; setFinishing(true); setMessage('');
    try {
      if (initial && query.data?.firstIntent) writeKey(STORAGE_KEYS.pendingPrompt, query.data.firstIntent);
      if (initial) await completeIntegratedOnboarding();
      else closeConversationActivation();
      if (currentAccountEmail() !== account) return;
      await cache.invalidateQueries({ queryKey: ['uony-options', account] });
      await cache.invalidateQueries({ queryKey: ['workspace-access', account] });
      if (currentAccountEmail() === account) await onFinished?.();
    } catch (failure) {
      if (currentAccountEmail() === account) {
        setMessage(errorMessage(failure));
        // El acceso o Google pueden haber cambiado mientras se leía el resumen.
        await query.refetch();
      }
    }
    finally { finishLocked.current = false; setFinishing(false); }
  };
  const state = query.data;
  // Una actualización del servidor no debe retirar el recibo que el cliente está leyendo.
  const step = paymentOpen ? 'subscription' : review ?? state?.step;
  const position = ACTIVATION_STEPS.findIndex(item => item.id === step);
  const previous = position > 0 ? ACTIVATION_STEPS[position - 1].id : null;
  const progress = <ActivationProgress step={step} current={step ? parts[step] : undefined} />;
  const content = <div className="activation-card-content">
    {withComposer && step === 'profile' && <InformationDisclosure label="Qué incluye Uonify y cuánto cuesta" className="activation-benefits"><p>Tu suscripción da acceso a Uonify: 9,90 €/mes + IVA o 118,80 €/año + IVA. Si eres elegible, los 14 días de prueba empiezan al activarla. El consumo de Google se gestiona por separado en tu cuenta.</p></InformationDisclosure>}
    {query.isPending ? <p role="status">Recuperando tu progreso…</p> : query.isError ? <p role="alert">No puedo recuperar tu preparación. Tus datos siguen guardados. <button onClick={() => void query.refetch()}>Reintentar</button></p> : state && <>
      {step === 'profile' && <ActivationProfile onProgress={profileProgress} onSaved={async () => { await refresh(); if (review && getUi().profile.step === STEP_INDEX.done) setReview(null); }} />}
      {step === 'drive' && <DriveOnboarding account={account} onProgress={driveProgress} onContinue={async () => { setReview(null); await refresh(); }} />}
      {step === 'cloud' && <ActivationCloud key={account} account={account} setup={state} onProgress={cloudProgress} onPrepared={cloudPrepared} onReady={async () => { await refresh(); setReview(null); }} />}
      {step === 'subscription' && <><p>IA de Google preparada · {state.drive.connected ? 'Drive conectado.' : 'Drive para más adelante.'}</p><OnboardingSubscription account={account} compact={withComposer} onProgress={subscriptionProgress} onPaymentOpen={setPaymentOpen} onContinue={async () => { await refresh(); setReview(null); }} onBack={() => setReview('cloud')} /></>}
      {step === 'complete' && <ActivationComplete state={state} intent={intent} busy={finishing} onContinue={() => void finish()} />}
      {previous && step !== 'subscription' && <button className="activation-back uon-onboard-back" type="button" onClick={() => setReview(previous)}>Volver al paso anterior</button>}
    </>}
    {message && <p className="activation-message" role="status">{message}</p>}
  </div>;
  return <div className="activation-journey">
    <section className={`activation-card${withComposer ? ` activation-card-restored uon-profile-dialog${step === 'profile' ? '' : ' uon-setup-dialog'}` : ' activation-card-compact'}`} aria-label="Preparar tu cuenta con Uony">
      {withComposer ? <ActivationFrame header={progress}>{content}</ActivationFrame> : <><header><Icon name="uony" /><strong>Te acompaño, paso a paso</strong>{!initial && <button type="button" aria-label="Cerrar preparación" onClick={closeConversationActivation}>×</button>}</header><div className="uon-onboard-main">{progress}{content}</div></>}
    </section>
  </div>;
}
