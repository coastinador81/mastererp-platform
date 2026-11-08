import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { currentAccountEmail } from '@/modules/auth';
import { ApiError, errorMessage } from '@/shared/api/client';
import { hasProductEdits } from '@/shared/pim';
import { useOwnedRequest } from '@/shared/hooks';
import { Icon } from '@/shared/ui';
import { driveApi } from '../api/driveApi';
import { focusedAssignmentForMaterials, type ChatMaterialScope } from '../api/assignmentMaterials';
import { materialsKey, productMaterialsApi, type MaterialAnalysisControl, type MaterialAnalysisJob,
  type MaterialAnalysisStart, type ProductMaterials } from '../api/productMaterials';
import { MATERIAL_START_CONSENT_SHA256, MATERIAL_START_CONSENT_TEXT, MATERIAL_START_CONSENT_VERSION } from '../model/materialAnalysisConsent';
import { MATERIAL_CONTROL_CONSENT, materialControlConsentText } from '../model/materialControlConsent';
import { DriveConnectionSettings } from './DriveConnectionSettings';
import { DriveFolderPicker } from './DriveFolderPicker';
import { MaterialAnalysisResults } from './MaterialAnalysisResults';
import '../styles/material-analysis.css';

interface Props { account: string; sku: string; revision: number; disabled?: boolean; initialFolderId?: string;
  chat?: ChatMaterialScope; onReview: (analysisId: string) => boolean }
const hasContinuation = (job?: MaterialAnalysisJob | null) => !!job?.canResume && ['paused', 'error'].includes(job.status) && job.pauseReason !== 'source_changed';
type ControlAction = 'pause' | 'resume' | 'reconcile' | 'upgradeReaders' | 'repairEvidence';
/** El mismo análisis persistido se consulta desde el chat y desde la ficha manual. */
export function ProductDriveAnalysis(props: Props) {
  return <OwnedProductDriveAnalysis key={`${props.account}:${props.chat?.threadId ?? ''}:${props.chat?.intakeId ?? ''}:${props.sku}`} {...props} />;
}
function OwnedProductDriveAnalysis({ account, sku, revision, disabled = false, initialFolderId, chat, onReview }: Props) {
  const owner = useOwnedRequest(account, currentAccountEmail);
  const client = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [controlling, setControlling] = useState<ControlAction | null>(null);
  const [error, setError] = useState('');
  const [choose, setChoose] = useState(false);
  const attempt = useRef<(MaterialAnalysisStart & { assignmentId: string | null }) | null>(null);
  const controlAttempt = useRef<{ action: ControlAction; id: string; data: MaterialAnalysisControl; recheck: boolean } | null>(null);
  const inFlight = useRef(false);
  const latest = useQuery({ queryKey: materialsKey(account, sku), queryFn: ({ signal }) => owner.read(inner => productMaterialsApi.latest(sku, inner), signal), retry: false, staleTime: 0 });
  const state = useQuery({ queryKey: ['google-drive', account], queryFn: () => driveApi.state(), retry: false, staleTime: 0 });
  const id = latest.data?.job?.id;
  const detail = useQuery({ queryKey: [...materialsKey(account, sku), id], queryFn: ({ signal }) => owner.read(inner => productMaterialsApi.job(sku, id!, inner), signal), enabled: !!id, retry: false,
    refetchInterval: query => !query.state.error && ['queued', 'running'].includes(query.state.data?.job.status ?? latest.data?.job?.status ?? '') ? 1800 : false,
  });
  useEffect(() => {
    const refresh = () => { void client.invalidateQueries({ queryKey: materialsKey(account, sku) }); };
    window.addEventListener('uonify:product-materials-changed', refresh);
    return () => window.removeEventListener('uonify:product-materials-changed', refresh);
  }, [account, sku, client]);
  const job = detail.data?.job ?? latest.data?.job;
  const running = !!job && ['queued', 'running'].includes(job.status);
  const continuation = hasContinuation(job);
  const blocked = disabled || starting || !!controlling || running || !!chat && !chat.isCurrent();
  const cache = (response: ProductMaterials) => {
    client.setQueryData<ProductMaterials>(materialsKey(account, sku), response);
    if (response.job) client.setQueryData([...materialsKey(account, sku), response.job.id], response);
  };
  const control = async (action: ControlAction, recheck = false) => {
    if (!job || disabled || starting || controlling || inFlight.current || !owner.current()) return;
    if (action !== 'pause' && hasProductEdits()) { setError(action === 'reconcile' ? 'Guarda los cambios de la ficha antes de contrastar sus materiales.' : 'Guarda los cambios de la ficha antes de reanudar el análisis.'); return; }
    const task = owner.begin(); if (!task) return;
    inFlight.current = true; setControlling(action); setError('');
    try {
      const fresh = await productMaterialsApi.latest(sku, task.signal); task.check();
      if (fresh.job?.id !== job.id) { cache(fresh); controlAttempt.current = null; setError('El análisis ha cambiado. Revisa su estado antes de continuar.'); return; }
      const active = ['queued', 'running'].includes(fresh.job.status);
      if ((action !== 'pause' && active) || (action === 'pause' && !active) || (action === 'reconcile' && !recheck && fresh.job.facts?.version === 1)) { cache(fresh); controlAttempt.current = null; return; }
      if (action === 'upgradeReaders' && !fresh.job.readerUpgradeAvailable) { cache(fresh); controlAttempt.current = null; return; }
      if (action === 'repairEvidence' && !fresh.job.repairAvailable) { cache(fresh); controlAttempt.current = null; return; }
      if (action === 'resume' && !fresh.job.canResume) { cache(fresh); setError('Este análisis ya no tiene una continuación disponible. Revisa su estado actualizado.'); return; }
      if (action === 'resume' && fresh.job.pauseReason === 'consumption_unknown' && job.pauseReason !== 'consumption_unknown') {
        cache(fresh); controlAttempt.current = null; setError('La última llamada pudo consumir recursos. Revisa el aviso antes de reintentar la parte pendiente.'); return;
      }
      const currentRevision = fresh.product?.revision ?? revision;
      const acknowledge = action === 'resume' && fresh.job.pauseReason === 'consumption_unknown';
      if (!controlAttempt.current || controlAttempt.current.action !== action || controlAttempt.current.id !== job.id || controlAttempt.current.recheck !== recheck || controlAttempt.current.data.revision !== currentRevision || !!controlAttempt.current.data.acknowledgeUnknownConsumption !== acknowledge) {
        controlAttempt.current = { action, id: job.id, recheck, data: { requestId: crypto.randomUUID(), revision: currentRevision, ...(acknowledge ? { acknowledgeUnknownConsumption: true } : {}) } };
      }
      if (action === 'upgradeReaders' || action === 'repairEvidence') {
        const copy = MATERIAL_CONTROL_CONSENT[action];
        try {
          const advertised = await productMaterialsApi.controlConsent(sku, job.id, action, task.signal); task.check();
          if (advertised.version !== copy.version || advertised.text !== materialControlConsentText(action) || advertised.sha256 !== copy.sha256) {
            setError('Las condiciones de esta acción han cambiado. Actualiza la página y revísalas antes de continuar.');
            return;
          }
        } catch (reason) {
          task.check();
          if (!(reason instanceof ApiError && reason.status === 404 &&
                (reason.data as { detail?: unknown } | null)?.detail === 'Not Found')) throw reason;
          setError('El servicio de análisis se está actualizando. Recarga la página para revisar las condiciones antes de continuar.');
          return;
        }
        const requestData = controlAttempt.current.data;
        controlAttempt.current.data = { ...requestData, consentVersion: copy.version,
          consentText: materialControlConsentText(action), consentSha256: copy.sha256 };
      }
      const response = await productMaterialsApi[action](sku, job.id, controlAttempt.current.data, task.signal); task.check();
      cache({ ...fresh, ...response }); controlAttempt.current = null; setChoose(false);
    } catch (reason) { if (task.valid()) { setError(errorMessage(reason)); void state.refetch(); } }
    finally { if (task.valid()) { setControlling(null); inFlight.current = false; } task.finish(); }
  };
  const start = async (folderId: string) => {
    if (blocked || continuation || inFlight.current || !owner.current() || chat && !chat.isCurrent()) return;
    if (hasProductEdits()) { setError('Guarda los cambios de la ficha antes de analizar sus materiales.'); return; }
    const task = owner.begin(); if (!task) return;
    inFlight.current = true; setStarting(true); setError('');
    try {
      const fresh = await productMaterialsApi.latest(sku, task.signal); task.check();
      if (fresh.job && (['queued', 'running'].includes(fresh.job.status) || hasContinuation(fresh.job))) {
        cache(fresh); attempt.current = null; setChoose(false); return;
      }
      if (fresh.job?.id !== job?.id) {
        cache(fresh); attempt.current = null; setChoose(false);
        setError('El análisis ha cambiado. Revisa su estado antes de iniciar otro.'); return;
      }
      let serverConsentVersion: string;
      let serverConsentSha256: string;
      try {
        const advertised = await productMaterialsApi.startConsent(sku, task.signal);
        serverConsentVersion = advertised.version;
        serverConsentSha256 = advertised.sha256;
        task.check();
        if (advertised.text !== MATERIAL_START_CONSENT_TEXT ||
            advertised.sha256 !== MATERIAL_START_CONSENT_SHA256) {
          attempt.current = null;
          setError('Las condiciones del análisis han cambiado. Actualiza la página y revísalas antes de continuar.');
          return;
        }
      } catch (reason) {
        task.check();
        if (!(reason instanceof ApiError && reason.status === 404 &&
              (reason.data as { detail?: unknown } | null)?.detail === 'Not Found')) throw reason;
        setError('El servicio de análisis se está actualizando. Recarga la página para revisar las condiciones antes de continuar.');
        return;
      }
      if (serverConsentVersion !== MATERIAL_START_CONSENT_VERSION) {
        attempt.current = null;
        setError('Las condiciones del análisis han cambiado. Actualiza la página y revísalas antes de continuar.');
        return;
      }
      const currentRevision = fresh.product?.revision ?? revision;
      const reanalysisOf = fresh.job && (choose || (fresh.job.status === 'error' && !fresh.job.canResume)) ? fresh.job.id : undefined;
      if (!attempt.current || attempt.current.folderId !== folderId || attempt.current.revision !== currentRevision ||
          attempt.current.reanalysisOf !== reanalysisOf) {
        const assignmentId = chat
          ? await focusedAssignmentForMaterials(chat, sku, currentRevision, folderId, task.signal) : null;
        task.check();
        if (chat && !chat.isCurrent()) throw new DOMException('La conversación ha cambiado.', 'AbortError');
        attempt.current = { folderId, revision: currentRevision, requestId: crypto.randomUUID(),
          consentVersion: serverConsentVersion, consentText: MATERIAL_START_CONSENT_TEXT,
          consentSha256: serverConsentSha256, assignmentId, ...(reanalysisOf ? { reanalysisOf } : {}) };
      } else attempt.current = { ...attempt.current, consentVersion: serverConsentVersion,
        consentText: MATERIAL_START_CONSENT_TEXT, consentSha256: serverConsentSha256 };
      const { assignmentId, ...request } = attempt.current;
      let response: { job: MaterialAnalysisJob; product?: ProductMaterials['product'] };
      if (assignmentId) {
        const contextual = await productMaterialsApi.startForAssignment(assignmentId, sku, request, task.signal);
        if (contextual.assignmentId !== assignmentId
          || contextual.assignmentWorkScope !== 'started_for_assignment')
          throw new Error('No hemos podido confirmar el vínculo de este análisis con tu encargo.');
        response = contextual;
      } else response = await productMaterialsApi.start(sku, request, task.signal);
      task.check();
      client.setQueryData<ProductMaterials>(materialsKey(account, sku), { ...fresh, ...response });
      client.setQueryData([...materialsKey(account, sku), response.job.id], response);
      if (chat) void client.invalidateQueries({ queryKey: ['uony-assignment-return', account, chat.threadId] });
      attempt.current = null; setChoose(false);
    } catch (reason) { if (task.valid()) { setError(errorMessage(reason)); void state.refetch(); } }
    finally { if (task.valid()) { setStarting(false); inFlight.current = false; } task.finish(); }
  };
  return <section className="drive-analysis" aria-label="Materiales del producto en Drive" aria-busy={starting || !!controlling}>
    <header><Icon name="uony" size={21} /><div><strong>Materiales del producto</strong><small>Leer, contrastar y completar contigo</small></div></header>
    {latest.isPending ? <p role="status">Recuperando el análisis de esta ficha…</p> : latest.isError ? <p role="alert">{errorMessage(latest.error)} <button onClick={() => void latest.refetch()}>Reintentar</button></p> : <>
      {job && <MaterialAnalysisResults job={job} disabled={blocked} onReconcile={() => void control('reconcile')} onRecheck={() => void control('reconcile', true)} reconcileDisabled={blocked || state.data?.connection.status !== 'connected' || !state.data?.accessAllowed} onReview={() => {
        if (!owner.current()) return;
        setError(onReview(job.id) ? '' : 'Espera a que Uony termine o guarda los cambios de la ficha antes de revisar.');
      }} />}
      {job && <div className="drive-analysis-actions">
        {!running && job.repairAvailable && <div className="drive-analysis-upgrade">
          <p>{MATERIAL_CONTROL_CONSENT.repairEvidence.paragraph}</p>
          <button type="button" className="drive-analysis-review" disabled={blocked || state.data?.connection.status !== 'connected' || !state.data?.accessAllowed || ['source_changed', 'consumption_unknown'].includes(job.pauseReason ?? '')} onClick={() => void control('repairEvidence')}><Icon name="uony" size={17} />{controlling === 'repairEvidence' ? 'Preparando la comprobación…' : MATERIAL_CONTROL_CONSENT.repairEvidence.action}</button>
        </div>}
        {!running && job.readerUpgradeAvailable && <div className="drive-analysis-upgrade">
          <p>{MATERIAL_CONTROL_CONSENT.upgradeReaders.paragraph}</p>
          <button type="button" className="drive-analysis-review" disabled={blocked || state.data?.connection.status !== 'connected' || !state.data?.accessAllowed || ['source_changed', 'consumption_unknown'].includes(job.pauseReason ?? '')} onClick={() => void control('upgradeReaders')}><Icon name="uony" size={17} />{controlling === 'upgradeReaders' ? 'Preparando la lectura…' : MATERIAL_CONTROL_CONSENT.upgradeReaders.action}</button>
        </div>}
        {running && <button type="button" disabled={disabled || starting || !!controlling || job.pauseRequested} onClick={() => void control('pause')}>{job.pauseRequested ? 'Pausa solicitada' : controlling === 'pause' ? 'Pausando…' : 'Pausar análisis'}</button>}
        {!running && job.canResume && <button type="button" className="drive-analysis-review" disabled={blocked || state.data?.connection.status !== 'connected' || !state.data?.accessAllowed} onClick={() => void control('resume')}><Icon name="uony" size={17} />{controlling === 'resume' ? 'Reanudando…' : job.pauseReason === 'consumption_unknown' ? 'Reintentar parte pendiente' : 'Reanudar análisis con Uony'}</button>}
      </div>}
      {detail.isError && <p role="alert">No se ha podido actualizar el estado. <button onClick={() => void detail.refetch()}>Reintentar consulta</button></p>}
      {state.isPending ? <p role="status">Comprobando Drive…</p> : state.isError || !state.data?.connection ? <p role="alert">No se ha podido comprobar Drive. <button onClick={() => void state.refetch()}>Reintentar conexión</button></p> : state.data.connection.status !== 'connected' ? <DriveConnectionSettings account={account} /> : !state.data.accessAllowed ? <p>Necesitas una prueba o suscripción vigente para analizar los materiales.</p> : <>
        {(!job || choose || (job.status === 'error' && !job.canResume)) && !running && !continuation && <DriveFolderPicker account={account} disabled={blocked} initialFolderId={job?.status === 'error' ? job.folderId : !job ? initialFolderId : undefined} onSelect={folderId => void start(folderId)} />}
        {job && !running && !continuation && !choose && (job.status !== 'error' || job.canResume) && <button type="button" disabled={blocked} onClick={() => setChoose(true)}>Analizar otra carpeta o una versión nueva</button>}
        {choose && !continuation && <button type="button" disabled={blocked} onClick={() => setChoose(false)}>Conservar este análisis</button>}
      </>}
    </>}
    {starting && <p role="status">Preparando la lectura de tu carpeta…</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
