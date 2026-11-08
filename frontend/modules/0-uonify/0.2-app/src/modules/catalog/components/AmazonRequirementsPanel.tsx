import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { currentAccountEmail } from '@/modules/auth';
import { formResponse } from '@/modules/workspace';
import { errorMessage } from '@/shared/api/client';
import { askProductAssistant, hasProductEdits, usePimStore } from '@/shared/pim';
import { Icon, InformationDisclosure } from '@/shared/ui';
import type { CatalogProduct } from '../model/types';
import { useAmazonRequirements } from '../hooks/useAmazonRequirements';
import { readRequirementsDraft, requirementsDraftKey, writeRequirementsDraft, type RequirementsDraft } from '../hooks/amazonRequirementsDrafts';
import { AmazonRequirementFields } from './AmazonRequirementFields';
import { AmazonRequirementsSource } from './AmazonRequirementsSource';
import { AmazonReasoningStatus } from './AmazonReasoningStatus';
import '../styles/preparation.css';
import '../styles/amazonRequirements.css';

const subscribeIdentity = (listener: () => void) => {
  window.addEventListener('uonify:identity-changed', listener);
  return () => window.removeEventListener('uonify:identity-changed', listener);
};
export function AmazonRequirementsPanel({ product }: { product: CatalogProduct }) {
  const account = useSyncExternalStore(subscribeIdentity, currentAccountEmail, () => null);
  return account ? <OwnedRequirements key={`${account}:${product.sku}`} account={account} product={product} /> : null;
}

function OwnedRequirements({ account, product }: { account: string; product: CatalogProduct }) {
  const id = useId();
  const draftKey = requirementsDraftKey(account, product.sku);
  const [draft, setDraft] = useState<RequirementsDraft | null>(() => readRequirementsDraft(draftKey));
  const [attribute, setAttribute] = useState(draft?.attribute ?? '');
  const [notice, setNotice] = useState('');
  const [validation, setValidation] = useState('');
  const { query, saving, error, conflict, configure, save, prepare, clearError } = useAmazonRequirements(account, product.sku, attribute);
  usePimStore(product.sku);
  const data = query.data;
  const evaluation = data?.evaluation;
  const revision = Number(data?.product?.revision ?? product.revision);
  const fields = evaluation?.fields ?? [];
  const reasoning = evaluation?.state === 'reasoning' ? evaluation.reasoning ?? {
    id: product.sku, status: 'running' as const, message: 'Estamos consultando el estado de la revisión de Uony.',
  } : undefined;
  const savedAnswers = Object.fromEntries(fields.map(field => [field.id, field.value ?? '']));
  const answers = draft ? { ...savedAnswers, ...draft.answers } : savedAnswers;
  const changed = !!draft && (Object.keys(draft.answers).some(key => !(key in savedAnswers)) || fields.some(field => (answers[field.id] ?? '') !== (field.value ?? '')));
  const stale = !!draft && (draft.revision !== revision || draft.evaluationId !== evaluation?.evaluationId);
  const editorDirty = hasProductEdits(product);
  const blocked = saving || query.isFetching || editorDirty || stale || conflict;
  useEffect(() => { if (account === currentAccountEmail()) writeRequirementsDraft(draftKey, draft); }, [account, draftKey, draft]);
  const updateDraft = (next: RequirementsDraft | null) => {
    if (account !== currentAccountEmail() || saving) return;
    setDraft(next); writeRequirementsDraft(draftKey, next); setNotice(''); setValidation('');
  };
  const change = (fieldId: string, value: string) => {
    if (!evaluation?.evaluationId) return;
    updateDraft({ ...draft, revision: draft?.revision ?? revision, evaluationId: draft?.evaluationId ?? evaluation.evaluationId,
      attribute, answers: { ...answers, [fieldId]: value } });
  };
  const ask = () => askProductAssistant(`Quiero continuar la preparación de este producto con Uony y completar sus requisitos de Amazon. SKU: ${product.sku}.`,
    { sku: product.sku, revision });
  const saveAnswers = async () => {
    if (blocked || !evaluation?.evaluationId) return;
    const checked = formResponse({ id: 'requirements-validation', title: 'Datos para Amazon', fields,
      context: { kind: 'product_guide', sku: product.sku, revision, section: 'amazon_requirements', step: 'fields', evaluationId: evaluation.evaluationId } }, answers,
    new Set(fields.filter(field => field.closed === false).map(field => field.id)));
    if (checked.error) { setValidation(checked.error); return; }
    setNotice(''); setValidation('');
    const result = await save({ revision, evaluationId: evaluation.evaluationId, answers, ...(attribute ? { attribute } : {}) });
    if (result && account === currentAccountEmail()) {
      setDraft(null); writeRequirementsDraft(draftKey, null); setAttribute('');
      setNotice('Respuestas guardadas en esta ficha. Hemos vuelto a evaluar sus requisitos.');
    }
  };
  return <section className="product-preparation amazon-requirements" aria-label="Requisitos de Amazon">
    <header className="product-preparation-heading"><div><p>La misma ficha en Producto y en tu conversación</p><h2>Requisitos de Amazon</h2></div>
      <button type="button" className="amazon-requirements-uony" onClick={ask}><Icon name="uony" size={18} />Completar con Uony</button></header>
    {query.isPending ? <p role="status">Evaluando los datos guardados…</p> : query.isError || !evaluation ? <div role="alert">
      <p>{errorMessage(query.error, 'No se ha podido comprobar qué datos necesita Amazon.')}</p>
      <button type="button" onClick={() => void query.refetch()}>Reintentar evaluación</button>
    </div> : <>
      {reasoning && <AmazonReasoningStatus key={`${reasoning.id}:${reasoning.status}`} reasoning={reasoning} disabled={saving || query.isFetching || editorDirty}
        onRetry={acknowledgeUnknown => void prepare({ revision, retry: true, acknowledgeUnknown })} />}
      {!reasoning && <><p className="product-preparation-notice">{evaluation.message}</p>
      <InformationDisclosure label="Sobre esta comprobación"><p>Comprobamos los datos con los requisitos de Amazon. Amazon revisará el producto cuando decidas enviarlo.</p></InformationDisclosure>
      {evaluation.productType && <p className="amazon-requirements-category">Tipo de producto: <strong>{evaluation.productType}</strong>{evaluation.referenceAsin && <> · ASIN de referencia: {evaluation.referenceAsin}</>}</p>}
      {evaluation.state !== 'unconfigured' && <div className="amazon-requirements-counts" role="status">
        <span><strong>{evaluation.counts.missing}</strong> datos pendientes</span><span><strong>{evaluation.counts.invalid}</strong> datos por corregir</span>
        {evaluation.state === 'locally_valid' && <span>Validación local completada</span>}
      </div>}
      {editorDirty && <p className="product-preparation-warning" role="status">Guarda primero los cambios del editor de la ficha. Conservaremos aquí tus respuestas para Amazon.</p>}
      {(stale || conflict) && <div className="product-preparation-warning" role="alert"><p>La ficha o los requisitos han cambiado. Tus respuestas siguen aquí; compáralas con los datos guardados antes de continuar.</p>
        <details><summary>Ver datos actuales y mis respuestas</summary><dl>{fields.map(field => <div key={field.id}><dt>{field.label}</dt><dd>Guardado: {field.value || 'Sin indicar'}<br />Mi respuesta: {answers[field.id] || 'Sin indicar'}</dd></div>)}</dl></details>
        <div className="product-preparation-conflict-actions"><button type="button" disabled={saving || query.isFetching || !evaluation.evaluationId} onClick={() => {
          const retired = Object.entries(draft?.answers ?? {}).filter(([key]) => !fields.some(field => field.id === key)).map(([, value]) => value).filter(Boolean);
          updateDraft({ revision, evaluationId: evaluation.evaluationId ?? '', attribute, answers: Object.fromEntries(fields.map(field => [field.id, answers[field.id] ?? field.value ?? ''])), previousAnswers: [...(draft?.previousAnswers ?? []), ...retired] }); clearError();
        }}>He revisado los cambios: conservar mis respuestas</button>
          <button type="button" disabled={saving || query.isFetching} onClick={() => { updateDraft(null); clearError(); }}>Usar los datos guardados</button></div>
      </div>}
      {!!draft?.previousAnswers?.length && <details className="product-preparation-warning"><summary>Respuestas de campos anteriores para consultar o copiar</summary>{draft.previousAnswers.map((value, index) => <p key={index}>{value}</p>)}</details>}
      <AmazonRequirementsSource key={`${evaluation.productType}:${evaluation.marketplaceId}:${evaluation.referenceAsin}`} evaluation={evaluation} revision={revision}
        disabled={saving || query.isFetching || editorDirty || (evaluation.state !== 'stale' && (changed || stale || conflict))} saving={saving}
        onSave={async source => { const result = await configure(source); if (result && currentAccountEmail() === account) { setAttribute(''); setNotice('Requisitos consultados. Revisa la categoría y los datos pendientes.'); } }} />
      {changed && <p className="amazon-requirements-hint">{evaluation.state === 'stale' ? 'Puedes actualizar los requisitos. Tus respuestas seguirán aquí para compararlas después.' : 'Guarda o descarta tus respuestas antes de cambiar de categoría o de atributo.'}</p>}
      {!!evaluation.attributes?.length && <label className="amazon-requirements-attribute" htmlFor={`${id}-attribute`}><span>Revisar un atributo de la ficha</span><select id={`${id}-attribute`} value={attribute} disabled={changed || saving || stale || conflict} onChange={event => { setAttribute(event.target.value); updateDraft(null); clearError(); }}>
        <option value="">Siguientes datos pendientes</option>{evaluation.attributes.map(item => <option key={item.id} value={item.id}>{item.label} · {item.present ? item.valid ? 'Guardado' : 'Revisar' : item.required ? 'Obligatorio' : 'Opcional'}</option>)}
      </select></label>}
      {fields.length > 0 && evaluation.state !== 'stale' && <form aria-label="Completar datos de Amazon" noValidate onSubmit={event => { event.preventDefault(); void saveAnswers(); }} aria-busy={saving}>
        <p className="amazon-requirements-hint">{attribute ? 'Edita este atributo y guarda para volver a evaluar la ficha.' : 'Responde este grupo de preguntas. La siguiente evaluación tendrá en cuenta tus respuestas.'}</p>
        <fieldset disabled={saving}><legend className="sr-only">Datos aceptados por Amazon</legend><AmazonRequirementFields fields={fields} answers={answers} onChange={change} /></fieldset>
        <div className="product-preparation-actions">{changed && <button type="button" disabled={saving} onClick={() => { updateDraft(null); clearError(); }}>Descartar mis cambios</button>}
          <button type="submit" disabled={blocked}>{saving ? 'Guardando y evaluando…' : 'Guardar y volver a evaluar'}</button></div>
      </form>}
      {!!evaluation.issues?.length && <details className="amazon-requirements-issues"><summary>Ver detalles de la evaluación ({evaluation.issues.length})</summary><ul>{evaluation.issues.map((issue, index) => <li key={`${issue.path}:${index}`}>{issue.message}</li>)}</ul></details>}
      {evaluation.evaluatedAt && <p className="amazon-requirements-hint">Última evaluación: {new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(evaluation.evaluatedAt))}</p>}</>}
    </>}
    {(error || validation) && <p role="alert" className="product-preparation-error">{validation || error}</p>}
    {notice && <p role="status" className="product-preparation-saved">{notice}</p>}
  </section>;
}
