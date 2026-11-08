import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCloudWindow } from '@/modules/cloud';
import { api, ApiError, errorMessage } from '@/shared/api/client';
import { useOwnedRequest } from '@/shared/hooks';
import { InformationDisclosure } from '@/shared/ui';
import { currentAccountEmail } from '../state/session';
import type { ActivationState, SetupOperation, ActivationStepProgress } from '../model/activation';
import { useCompactActivation } from '../hooks/useCompactActivation';
import { ActivationRecovery } from './ActivationRecovery';
import { ActivationCloudFeedback } from './ActivationCloudFeedback';
import { ActivationCloudInformation } from './ActivationCloudInformation';
import '../styles/activation-cloud.css';

interface ConnectionState { connection: { status: string }; available: boolean }
interface Project { id: string; name: string }
interface BillingAccount { name: string; displayName: string; open: boolean }

export function ActivationCloud({ account, setup, onReady, onPrepared, onProgress }: { account: string; setup: ActivationState; onReady: () => Promise<unknown>; onPrepared?: () => void; onProgress?: (progress: ActivationStepProgress) => void }) {
  const owner = useOwnedRequest(account, currentAccountEmail);
  const state = useQuery({ queryKey: ['google-cloud', account], retry: false, staleTime: 0,
    queryFn: ({ signal }) => owner.read(inner => api.get<ConnectionState>('/connections/google-cloud', { signal: inner }), signal) });
  const [mode, setMode] = useState<'' | 'create' | 'existing'>(setup.cloud.operation?.mode ?? '');
  const [projectId, setProjectId] = useState(setup.cloud.operation?.projectId ?? '');
  const [billingAccountName, setBillingAccountName] = useState(setup.cloud.operation?.billingAccountName ?? '');
  const [consent, setConsent] = useState(setup.cloud.operation?.modelTestConsent ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [operation, setOperation] = useState<SetupOperation | null>(setup.cloud.operation);
  const [approvalSent, setApprovalSent] = useState(!!setup.cloud.operation);
  const compact = useCompactActivation();
  const [part, setPart] = useState(setup.cloud.operation ? 1 : 0);
  const [recoveryPage, setRecoveryPage] = useState({ id: '', consent: false });
  const [billingRevision, setBillingRevision] = useState(false);
  const [resultVersion, setResultVersion] = useState(0);
  const [repeated, setRepeated] = useState(!!setup.cloud.operation?.retryOf);
  const [checkingCommand, setCheckingCommand] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const section = useRef<HTMLElement>(null);
  const requestId = useRef(setup.cloud.operation?.id ?? crypto.randomUUID());
  const recoveryCommand = useRef<Record<string, unknown> | null>(null);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const locked = useRef(false);
  const connected = state.data?.connection.status === 'connected';
  const projects = useQuery({ queryKey: ['setup-projects', account], enabled: connected && mode === 'existing' && !operation, retry: false,
    queryFn: ({ signal }) => owner.read(inner => api.get<{ projects: Project[] }>('/connections/google-cloud/projects', { signal: inner }), signal) });
  const billing = useQuery({ queryKey: ['setup-billing-accounts', account], enabled: connected && mode !== '' && (!operation?.recovery || operation.recovery.kind === 'billing'), retry: false,
    queryFn: ({ signal }) => owner.read(inner => api.get<{ accounts: BillingAccount[] }>('/connections/google-cloud/billing-accounts', { signal: inner }), signal) });
  const popup = useCloudWindow(async kind => {
    await state.refetch({ throwOnError: true });
    if (kind === 'billing' && (!operation?.recovery || operation.recovery.kind === 'billing')) await billing.refetch({ throwOnError: true });
    await onReady();
  });
  const active = operation?.status === 'preparing';
  const waitingAccess = operation?.accessCheck?.status === 'waiting';
  const progress = useQuery({ queryKey: ['setup-operation', account, operation?.id], enabled: !!operation && (active || waitingAccess), retry: false,
    refetchInterval: active || waitingAccess ? () => Math.max(2000, (Date.parse(operation?.accessCheck?.nextCheckAt || '') || 0) - Date.now()) : false,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => owner.read(async inner => {
      let result = await api.get<{ operation: SetupOperation | null }>('/connections/google-cloud/setup', { signal: inner });
      const access = result.operation?.accessCheck;
      if (result.operation?.canDiagnose && access?.status === 'waiting' && (!access.nextCheckAt || Date.parse(access.nextCheckAt) <= Date.now())) {
        // Solo relecturas gratuitas. Nunca convertir un rechazo anterior en otra generación.
        result = await api.post<{ operation: SetupOperation }>(`/connections/google-cloud/setup/${result.operation.id}/diagnostics`, {}, { signal: inner });
      }
      // Reanudar el mismo comando autorizado concilia primero; no crea otro intento ni repite una prueba desconocida.
      const current = result.operation?.status === 'preparing' && result.operation.canResume && !['pending', 'unknown', 'failed'].includes(result.operation.modelTest)
        ? await api.post<{ operation: SetupOperation }>('/connections/google-cloud/setup', { requestId: result.operation.id }, { signal: inner }) : result;
      if (!inner.aborted && currentAccountEmail() === account) {
        if (current.operation?.status === 'ready' && current.operation.modelTest === 'passed') onPrepared?.();
        setOperation(current.operation);
        if (current.operation && current.operation.status !== 'preparing') setResultVersion(value => value + 1);
      }
      return current;
    }, signal) });
  const runCommand = async (body: Record<string, unknown>) => {
    if (locked.current || active) return;
    const task = owner.begin(); if (!task) return;
    locked.current = true;
    // Una respuesta perdida conserva también el cuerpo autorizado, no solo su UUID.
    recoveryCommand.current = body; setRecoveryPending(true);
    setCheckingCommand(!!body.retryOf || operation?.modelTest === 'pending');
    setBusy(true); setApprovalSent(true); setError('');
    try {
      const result = await api.post<{ operation: SetupOperation }>('/connections/google-cloud/setup', body, { signal: task.signal }); task.check();
      requestId.current = result.operation.id;
      recoveryCommand.current = null; setRecoveryPending(false);
      setOperation(result.operation); setMode(result.operation.mode ?? mode);
      setBillingRevision(false);
      setRepeated(!!body.retryOf || !!result.operation.retryOf);
      setResultVersion(value => value + 1);
      setProjectId(result.operation.projectId ?? projectId); setBillingAccountName(result.operation.billingAccountName ?? billingAccountName);
      if (result.operation.status === 'ready' && result.operation.modelTest === 'passed') onPrepared?.();
    } catch (failure) {
      if (task.valid()) {
        setError(errorMessage(failure));
        if (failure instanceof ApiError && (failure.data as { error?: unknown } | null)?.error === 'setup_diagnostics_required') {
          recoveryCommand.current = null; setRecoveryPending(false); setRecoveryPage({ id: '', consent: false });
          try {
            const latest = await api.get<{ operation: SetupOperation | null }>('/connections/google-cloud/setup', { signal: task.signal }); task.check();
            setOperation(latest.operation);
          } catch { /* Conservamos el rechazo; otra consulta no autoriza reenviar la prueba. */ }
        }
      }
    }
    finally { locked.current = false; if (task.valid()) setBusy(false); task.finish(); }
  };
  const billingChange = !!operation?.billingAccountName && !!billingAccountName && billingAccountName !== operation.billingAccountName;
  const prepare = () => {
    if (busy || active || operation?.status === 'unknown' || operation?.modelTest === 'unknown') return;
    if (operation?.modelTest === 'failed' && !(billingChange && operation.projectId && consent)) return;
    if (billingChange && operation?.projectId && !recoveryCommand.current) {
      recoveryCommand.current = { requestId: crypto.randomUUID(), revisionOf: operation.id, mode: 'existing', projectId: operation.projectId,
        billingAccountName, configurationApproved: true, modelTestConsent: consent };
      setRecoveryPending(true);
    }
    const body = recoveryCommand.current ?? (operation ? {
      requestId: requestId.current, modelTestConsent: consent,
      ...(billingAccountName && billingAccountName !== operation.billingAccountName ? { billingAccountName, configurationApproved: true } : {}),
    } : { requestId: requestId.current, mode, ...(mode === 'existing' ? { projectId } : {}),
      ...(billingAccountName ? { billingAccountName } : {}), configurationApproved: true, modelTestConsent: consent });
    void runCommand(body);
  };
  const retryModel = () => {
    if (!operation?.canRetryModel || busy || active) return;
    if (!recoveryCommand.current) {
      recoveryCommand.current = { requestId: crypto.randomUUID(), retryOf: operation.id, acceptAdditionalModelCost: true, modelTestConsent: true };
      setRecoveryPending(true);
    }
    void runCommand(recoveryCommand.current);
  };
  const diagnose = async () => {
    if (!operation?.canDiagnose || locked.current || busy) return;
    const task = owner.begin(); if (!task) return;
    locked.current = true; setBusy(true); setDiagnosing(true); setError('');
    try {
      const result = await api.post<{ operation: SetupOperation }>(`/connections/google-cloud/setup/${operation.id}/diagnostics`, {}, { signal: task.signal }); task.check();
      setOperation(result.operation); setResultVersion(value => value + 1);
      setRecoveryPage({ id: '', consent: false });
    } catch (failure) { if (task.valid()) setError(errorMessage(failure)); }
    finally { locked.current = false; if (task.valid()) { setBusy(false); setDiagnosing(false); } task.finish(); }
  };
  const disabled = busy || active || !!popup.pending;
  const checking = (busy && checkingCommand) || operation?.modelTest === 'pending';
  const accounts = billing.data?.accounts.filter(item => item.open) ?? [];
  const selectionMissing = mode === 'existing' ? !projectId : !billingAccountName;
  const failedBilling = operation?.modelTest === 'failed' && operation.recovery?.kind === 'billing';
  const hasConfiguration = !!mode && !active && (!operation?.recovery || (operation.recovery.kind === 'billing' && (!failedBilling || billingRevision)));
  const recoveryConsent = recoveryPage.id === operation?.id && recoveryPage.consent;
  const ready = setup.aiReady || (operation?.status === 'ready' && operation.modelTest === 'passed');
  const progressIndex = ready ? 6 : !connected ? 1 : active || operation?.recovery ? 5 : !mode || (compact && part === 0) ? 2 : compact && part === 1 ? 3 : 4;
  const progressLabel = ready ? 'IA preparada' : !connected ? 'Conectar Google' : operation?.recovery ? recoveryConsent ? 'Autorizar una nueva comprobación' : 'Revisar la conexión' : active ? 'Comprobar la IA' : progressIndex === 2 ? 'Tu proyecto' : progressIndex === 3 ? 'Facturación de Google' : 'Autorizar la preparación';
  useEffect(() => { onProgress?.({ id: `cloud-${progressIndex}`, label: progressLabel, index: progressIndex, total: 6 }); }, [onProgress, progressIndex, progressLabel]);
  const configurationText = billingChange ? 'Conservaremos el mismo proyecto y el historial. Al autorizar, Uony lo vinculará a la nueva cuenta de facturación elegida.' : 'Al continuar, Uony preparará el proyecto y los permisos necesarios con la cuenta de facturación elegida.';
  const resourceSummary = `${mode === 'create' ? 'Proyecto nuevo: Uonify' : `Proyecto: ${projects.data?.projects.find(item => item.id === projectId)?.name || operation?.projectName || projectId}`}. ${billingAccountName ? `Facturación: ${accounts.find(item => item.name === billingAccountName)?.displayName || 'la cuenta elegida'}.` : 'Conservaremos la facturación del proyecto.'}`;
  const changePart = (value: number) => {
    setPart(value);
    requestAnimationFrame(() => section.current?.querySelector<HTMLElement>('[data-cloud-part]:not([hidden]) input,[data-cloud-part]:not([hidden]) select')?.focus());
  };
  if (ready) return <section className="activation-cloud cld-connect" aria-label="IA de Google preparada"><div className="cld-project-card"><h2>Tu IA está preparada</h2><p>Tu cuenta está conectada al proyecto {operation?.projectName || setup.cloud.projectName || 'de Google'}. Hemos comprobado su facturación y los permisos, y probado una respuesta de la IA.</p><p>Al activar la suscripción, Uony podrá utilizar ese proyecto para conversar contigo y ayudarte a trabajar en tus productos. El consumo de Google seguirá en tu propia cuenta.</p><button className="uon-profile-submit" onClick={() => void onReady().catch(failure => setError(errorMessage(failure)))}>Continuar</button>{error && <p className="cld-feedback" role="alert">{error}</p>}</div></section>;
  return <section ref={section} className="activation-cloud cld-connect" aria-label="Preparar la IA de Google" aria-busy={busy || active}>
    <h2>Prepara tu IA con Uony</h2>
    <ActivationCloudInformation account={account} connected={connected} />
    {!connected && operation?.recovery?.kind === 'authorization' && <p>{operation.recovery.message}</p>}
    {state.isPending ? <p role="status">Comprobando tu conexión con Google…</p> : state.isError ? <p role="alert">No podemos consultar Google. <button onClick={() => void state.refetch()}>Reintentar</button></p> : !connected ? <button className="uon-profile-submit" disabled={disabled || !state.data?.available} onClick={() => void popup.open('authorization')}>{operation?.recovery?.kind === 'authorization' ? operation.recovery.label : 'Conectar mi cuenta de Google'}</button> : <>
      <div className="cld-project-card">
      <div hidden={compact && (recoveryConsent || (billingRevision && part === 2)) && !busy && !error}>
        <ActivationCloudFeedback operation={operation} busy={busy} checking={checking} repeated={repeated} resultVersion={resultVersion} error={error} diagnosing={diagnosing} />
      </div>
      <div data-cloud-part="project" hidden={compact && hasConfiguration && part !== 0}>
      {!mode && !operation && <fieldset className="activation-choice"><legend>¿Quieres un proyecto nuevo para Uonify?</legend>
        <p>Es el espacio de tu cuenta de Google donde se gestionará la IA y su consumo.</p>
        <div className="cld-actions"><button type="button" onClick={() => setMode('create')}>Sí, crear un proyecto Uonify</button>
        <button type="button" onClick={() => setMode('existing')}>No, elegir uno que ya tengo</button></div>
      </fieldset>}
      {mode === 'existing' && !operation?.recovery && <label className="cld-project-label">Tu proyecto de Google
        <select value={projectId} disabled={disabled || recoveryPending || !!operation} onChange={event => setProjectId(event.target.value)}><option value="">Elige tu proyecto</option>{projects.data?.projects.map(project => <option key={project.id} value={project.id}>{project.name} · {project.id}</option>)}</select>
      </label>}
      {projects.isError && <p role="alert">No hemos podido consultar tus proyectos. <button onClick={() => void projects.refetch()}>Reintentar</button></p>}
      {hasConfiguration && <>
        {!operation && !approvalSent && <button type="button" className="uon-onboard-back" disabled={disabled} onClick={() => { setMode(''); setProjectId(''); setBillingAccountName(''); setConsent(false); setError(''); }}>Cambiar elección</button>}
        {mode === 'create' && !operation && <p>Crearemos un proyecto con el nombre Uonify en tu cuenta.</p>}
        {compact && <div className="cld-actions"><button type="button" className="uon-profile-submit" disabled={disabled || (mode === 'existing' && !projectId)} onClick={() => changePart(1)}>Continuar a la facturación</button></div>}
      </>}
      </div>
      {hasConfiguration && <div data-cloud-part="billing" hidden={compact && part !== 1}>
        {billing.isPending ? <p role="status">Buscando tus cuentas de facturación de Google…</p> : billing.isError ? <p role="alert">No podemos consultar la facturación. <button onClick={() => void billing.refetch()}>Reintentar</button></p> : accounts.length ? <label className="cld-project-label">Facturación de Google
          <select value={billingAccountName} disabled={disabled || recoveryPending} onChange={event => { setBillingAccountName(event.target.value); if (operation?.billingAccountName) setConsent(false); }}><option value="">{mode === 'existing' ? 'Conservar la facturación del proyecto' : 'Elige una cuenta'}</option>{accounts.map(item => <option key={item.name} value={item.name}>{item.displayName}</option>)}</select>
        </label> : <><p>No encontramos una cuenta de facturación disponible. Si tu proyecto ya tiene facturación, puedes prepararlo; para crear uno nuevo, completa el alta en Google.</p><button type="button" className="uon-onboard-back" disabled={disabled} onClick={() => void popup.open('billing', account)}>Preparar facturación en Google ↗</button></>}
        {accounts.length > 0 && <InformationDisclosure label="Gestionar mi facturación de Google"><p>Los datos de pago y los créditos se gestionan en la página oficial de Google.</p><button type="button" className="uon-onboard-back" disabled={disabled} onClick={() => void popup.open('billing', account)}>Abrir Google ↗</button></InformationDisclosure>}
        {compact && <><p>{billingChange ? 'Uony conservará el proyecto y usará la nueva facturación elegida.' : 'Uony preparará la IA del proyecto con esta facturación.'}</p><div className="cld-actions activation-cloud-part-actions">{!operation && <button type="button" className="uon-onboard-back" disabled={disabled || recoveryPending} onClick={() => changePart(0)}>Volver al proyecto</button>}<button type="button" className="uon-profile-submit" disabled={disabled || selectionMissing || (failedBilling && !billingChange)} onClick={() => changePart(2)}>Continuar a la autorización</button></div></>}
      </div>}
      {hasConfiguration && <div data-cloud-part="consent" hidden={compact && part !== 2}>
        {compact && <InformationDisclosure label="Proyecto y condiciones"><p>{resourceSummary}</p><p>{configurationText}</p><button type="button" className="uon-onboard-back" disabled={disabled || recoveryPending} onClick={() => changePart(1)}>Volver a proyecto y facturación</button></InformationDisclosure>}
        <label className="activation-consent"><input type="checkbox" checked={consent} disabled={disabled || recoveryPending} onChange={event => setConsent(event.target.checked)} />{compact ? 'Autorizo una prueba mínima de IA con Google. Puede consumir saldo o generar un coste.' : 'Autorizo una comprobación mínima de IA con Google, sin mis documentos ni herramientas. Puede consumir saldo o generar un coste según sus condiciones.'}</label>
        <p>{compact ? 'Sin documentos ni herramientas. No activa la suscripción.' : `${configurationText} Esto no activa tu suscripción de Uonify.`}</p>
        <div className="cld-actions"><button type="button" className="uon-profile-submit" disabled={disabled || !consent || selectionMissing || operation?.status === 'unknown' || operation?.modelTest === 'unknown' || (operation?.modelTest === 'failed' && !billingChange)} onClick={prepare}>{busy ? checking ? 'Comprobando…' : 'Preparando…' : recoveryPending ? 'Consultar la solicitud pendiente con Uony' : billingChange ? 'Autorizar cambio de facturación con Uony' : operation?.canResume ? 'Continuar preparación con Uony' : 'Preparar mi IA con Uony'}</button></div>
      </div>}
      {operation?.recovery && !billingRevision && <ActivationRecovery key={operation.id} operation={operation} busy={disabled} checking={diagnosing || checking} hideMessage pendingRequest={recoveryPending} compact={compact} consentStep={recoveryConsent} onConsentStep={consent => { setRecoveryPage({ id: operation.id, consent }); if (!consent) setResultVersion(value => value + 1); }}
        onOpen={() => { if (operation.recovery?.kind === 'authorization') void popup.open('authorization'); else if (operation.recovery?.url) void popup.open('billing', account, operation.recovery.url); }}
        onResume={prepare} onRetryModel={retryModel} onDiagnose={() => void diagnose()} />}
      {failedBilling && !billingRevision && !recoveryConsent && <InformationDisclosure label="Cambiar la facturación"><p>Puedes elegir otra cuenta de facturación para el mismo proyecto, con una nueva autorización.</p><button type="button" className="uon-onboard-back" disabled={disabled || recoveryPending} onClick={() => { setBillingRevision(true); setConsent(false); setPart(1); }}>Elegir otra cuenta de facturación</button></InformationDisclosure>}
      {progress.isError && <p role="alert">La consulta se ha interrumpido. Tu preparación sigue guardada. <button onClick={() => void progress.refetch()}>Consultar estado</button></p>}
      </div>
    </>}
    {popup.pending && <div className="cld-window" role="status"><strong>Seguimos aquí, en Uonify</strong><p>Completa el paso en la ventana de Google. Al volver comprobaremos el resultado.</p><div className="cld-actions"><button onClick={popup.focus}>Ver ventana de Google</button><button onClick={() => void popup.resume()}>He terminado, continuar</button></div></div>}
    {popup.message && !/^(Cuenta conectada\.|Hemos vuelto a consultar tu cuenta\.|Puedes volver a conectar Google\.)/.test(popup.message) && <p className="cld-feedback" role="alert">{popup.message}</p>}
  </section>;
}
