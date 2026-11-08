import { useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { currentAccountEmail } from '@/modules/auth';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useOwnedRequest } from '@/shared/hooks';
import { hasProductEdits, notifyProductChanges } from '@/shared/pim';
import { Icon } from '@/shared/ui';
import { driveApi } from '../api/driveApi';
import { productIntakeKey, productIntakesApi, type ProductIntake } from '../api/productIntakes';
import { DriveConnectionSettings } from './DriveConnectionSettings';
import { DriveFolderPicker } from './DriveFolderPicker';
import { ProductDriveAnalysis } from './ProductDriveAnalysis';
import '../styles/material-analysis.css';

interface Props {
  account: string; threadId: string; id: string; revision: number; disabled?: boolean;
  isCurrent: () => boolean; onReview: (sku: string, analysisId: string) => boolean;
}
type Attempt = { action: 'folder' | 'product'; value: string; revision: number; requestId: string };
const driveIssue = (value: unknown) => value instanceof ApiError && value.status === 409
  && ['not_connected', 'reauthorize', 'account_mismatch'].includes(String((value.data as { error?: unknown } | null)?.error));
/** Identifica materiales en el hilo antes de crear una ficha; no analiza al abrir. */
export function IntakeDriveAnalysis(props: Props) {
  return <OwnedIntakeDriveAnalysis key={`${props.account}:${props.threadId}:${props.id}`} {...props} />;
}
function OwnedIntakeDriveAnalysis({ account, threadId, id, revision, disabled = false, isCurrent, onReview }: Props) {
  const owner = useOwnedRequest(account, currentAccountEmail);
  const client = useQueryClient();
  const fieldId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState<string | null>(null);
  const [connectionRequired, setConnectionRequired] = useState(false);
  const inFlight = useRef(false);
  const attempt = useRef<Attempt | null>(null);
  const current = () => owner.current() && isCurrent();
  const validate = (value: ProductIntake) => {
    if (!value || value.id !== id || value.threadId !== threadId || !Number.isSafeInteger(value.revision) || value.revision < revision
      || !['selecting', 'identified', 'linked'].includes(value.status)
      || (value.status === 'identified' && (!value.folder || typeof value.folder.id !== 'string'))
      || (value.status === 'linked' && (!value.product || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(value.product.sku)
        || !Number.isSafeInteger(value.product.revision) || value.product.revision < 1))) throw new Error('No se ha podido recuperar la preparación de este producto.');
    return value;
  };
  const read = (signal?: AbortSignal) => owner.read(async inner => {
    const response = validate(await productIntakesApi.get(id, threadId, inner));
    if (!isCurrent()) throw new DOMException('La conversación ha cambiado.', 'AbortError');
    return response;
  }, signal);
  const connection = useQuery({ queryKey: ['google-drive', account], queryFn: ({ signal }) => owner.read(() => driveApi.state(), signal), retry: false, staleTime: 0 });
  const latest = useQuery({ queryKey: productIntakeKey(account, threadId, id), queryFn: ({ signal }) => read(signal), retry: false, staleTime: 0, enabled: current() });
  const intake = latest.data;
  const blocked = disabled || busy || latest.isFetching || !current();
  const connectionError = driveIssue(latest.error) || connectionRequired;
  const cache = (value: ProductIntake) => client.setQueryData(productIntakeKey(account, threadId, id), value);
  const submit = async (action: Attempt['action'], input: string) => {
    if (blocked || inFlight.current || !intake || !current()) return;
    if (hasProductEdits()) { setError('Guarda los cambios de la ficha antes de preparar otro producto.'); return; }
    const value = input.trim();
    if (!value) return;
    const task = owner.begin(); if (!task) return;
    const check = () => { task.check(); if (!isCurrent()) throw new DOMException('La conversación ha cambiado.', 'AbortError'); };
    inFlight.current = true; setBusy(true); setError('');
    try {
      const fresh = validate(await productIntakesApi.get(id, threadId, task.signal)); check();
      if (fresh.status === 'linked') { cache(fresh); attempt.current = null; return; }
      if (fresh.revision !== intake.revision) {
        cache(fresh); attempt.current = null; setError('La preparación ha cambiado. Revisa los datos antes de continuar.'); return;
      }
      if (!attempt.current || attempt.current.action !== action || attempt.current.value !== value || attempt.current.revision !== fresh.revision) {
        attempt.current = { action, value, revision: fresh.revision, requestId: crypto.randomUUID() };
      }
      const data = { threadId, revision: fresh.revision, requestId: attempt.current.requestId };
      const response = validate(await (action === 'folder'
        ? productIntakesApi.folder(id, { ...data, folderId: value }, task.signal)
        : productIntakesApi.product(id, { ...data, name: value }, task.signal))); check();
      cache(response); attempt.current = null;
      if (action === 'folder') setName(null);
      if (response.productChanges?.length) notifyProductChanges(response.productChanges);
    } catch (reason) { if (task.valid() && isCurrent()) {
      setError(errorMessage(reason));
      if (driveIssue(reason)) { setConnectionRequired(true); void connection.refetch(); }
    } }
    finally { if (task.valid() && isCurrent()) { setBusy(false); inFlight.current = false; } task.finish(); }
  };
  if (intake?.status === 'linked' && intake.product && !latest.isError) return <ProductDriveAnalysis
    account={account} sku={intake.product.sku} revision={intake.product.revision} initialFolderId={intake.folder?.id}
    chat={{ threadId, intakeId: id, isCurrent: current }}
    disabled={disabled || latest.isFetching || !current()} onReview={analysisId => current() && onReview(intake.product!.sku, analysisId)} />;
  return <section className="drive-analysis" aria-label="Preparación del producto desde sus materiales" aria-busy={busy}>
    <header><Icon name="uony" size={21} /><div><strong>Materiales del producto</strong><small>Leer, contrastar y completar contigo</small></div></header>
    {connection.isPending ? <p role="status">Comprobando Drive…</p> : connection.isError ? <p role="alert">No se ha podido comprobar Drive. <button type="button" onClick={() => void connection.refetch()}>Reintentar conexión</button></p> : connection.data?.connection.status !== 'connected' || connectionError ? <DriveConnectionSettings account={account} requireAuthorization={connectionError} onConnected={() => {
      if (!current()) return;
      setConnectionRequired(false); setError(''); void latest.refetch();
    }} /> : !connection.data.accessAllowed ? <p>Necesitas una prueba o suscripción vigente para preparar el producto.</p> : latest.isPending ? <p role="status">Recuperando la preparación de tu producto…</p> : latest.isError ? <p role="alert">{errorMessage(latest.error)} <button type="button" disabled={busy} onClick={() => void latest.refetch()}>Reintentar</button></p> : intake?.status === 'identified' ? <div className="drive-analysis-picker">
      <p>Carpeta elegida: {intake.folder?.name}. Confirma cómo se llama el producto para preparar su ficha. Todavía no hemos analizado los archivos.</p>
      <form onSubmit={event => { event.preventDefault(); void submit('product', name ?? intake.suggestedName ?? ''); }}>
        <label htmlFor={fieldId}>Nombre del producto</label>
        <input id={fieldId} value={name ?? intake.suggestedName ?? ''} maxLength={500} required disabled={blocked} onChange={event => setName(event.target.value)} />
        <div className="drive-analysis-actions"><button type="submit" disabled={blocked || !(name ?? intake.suggestedName ?? '').trim()}><Icon name="uony" size={17} />Confirmar producto con Uony</button></div>
      </form>
    </div> : <DriveFolderPicker account={account} disabled={blocked} identifyOnly onSelect={folderId => void submit('folder', folderId)} />}
    {busy && <p role="status">{intake?.status === 'identified' ? 'Preparando la ficha de tu producto…' : 'Identificando tu carpeta…'}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
