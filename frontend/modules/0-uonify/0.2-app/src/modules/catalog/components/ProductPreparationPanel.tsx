import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { currentAccountEmail } from '@/modules/auth';
import { useLatest } from '@/shared/hooks';
import { errorMessage } from '@/shared/api/client';
import { hasProductEdits, usePimStore, type PimTabKey } from '@/shared/pim';
import { InformationDisclosure } from '@/shared/ui';
import type { CatalogProduct } from '../model/types';
import { reconcilePreparationAnswers } from '../model/preparationAnswers';
import { useProductPreparation } from '../hooks/useProductPreparation';
import { preparationDraftKey, readPreparationDrafts, writePreparationDrafts, type PreparationDrafts } from '../hooks/preparationDrafts';
import { PreparationFields } from './PreparationFields';
import '../styles/preparation.css';

interface Props { product: CatalogProduct; tab: PimTabKey; onSelectTab: (tab: PimTabKey, focus: boolean) => void; complementary?: boolean }
const subscribeIdentity = (listener: () => void) => {
  window.addEventListener('uonify:identity-changed', listener);
  return () => window.removeEventListener('uonify:identity-changed', listener);
};

export function ProductPreparationPanel(props: Props) {
  const account = useSyncExternalStore(subscribeIdentity, currentAccountEmail, () => null);
  return account ? <OwnedPreparation key={`${account}:${props.product.sku}`} {...props} account={account} /> : null;
}

function OwnedPreparation({ product, tab, onSelectTab, complementary, account }: Props & { account: string }) {
  const { query, saving, error, conflict, saveSection, clearError } = useProductPreparation(account, product.sku);
  const draftKey = preparationDraftKey(account, product.sku);
  const [drafts, setDrafts] = useState(() => readPreparationDrafts(draftKey));
  const [notice, setNotice] = useState('');
  const currentTab = useLatest(tab);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (account === currentAccountEmail()) writePreparationDrafts(draftKey, drafts); }, [account, draftKey, drafts]);
  usePimStore(product.sku);
  const editorDirty = hasProductEdits(product);
  const section = query.data?.preparation?.sections.find(item => item.id === tab);
  const savedAnswers = Object.fromEntries(section?.fields.map(field => [field.id, field.value]) ?? []);
  const draft = drafts[tab];
  const answers = draft?.answers ?? savedAnswers;
  const retiredFields = section ? Object.keys(answers).filter(id => !section.fields.some(field => field.id === id)) : [];
  const schemaChanged = retiredFields.length > 0;
  const changed = !!section && (schemaChanged || section.fields.some(field => (answers[field.id] ?? '') !== field.value));
  const revision = Number(query.data?.product?.revision ?? product.revision);
  const stale = changed && (draft?.revision !== revision || schemaChanged);
  const blocked = saving || editorDirty || stale || conflict;
  const sameOwner = () => mounted.current && currentAccountEmail() === account;
  const updateDrafts = (update: (before: PreparationDrafts) => PreparationDrafts) => {
    setDrafts(before => {
      const next = update(before);
      if (currentAccountEmail() === account) writePreparationDrafts(draftKey, next);
      return next;
    });
  };
  const change = (id: string, value: string) => {
    if (!sameOwner() || saving) return;
    updateDrafts(before => ({ ...before, [tab]: { ...before[tab], revision: before[tab]?.revision ?? revision, answers: { ...answers, [id]: value } } }));
    setNotice('');
  };
  const discard = () => {
    if (!sameOwner() || saving) return;
    updateDrafts(before => { const next = { ...before }; delete next[tab]; return next; }); clearError(); setNotice('');
  };
  const save = async (advance: boolean) => {
    if (!sameOwner() || blocked || !section) return;
    const submittedTab = tab;
    setNotice('');
    const result = await saveSection(tab, changed && draft ? draft.revision : revision, answers, advance);
    if (!result || !sameOwner()) return;
    updateDrafts(before => { const next = { ...before }; delete next[submittedTab]; return next; });
    setNotice(advance ? 'Datos revisados y guardados. La creación de recursos mantiene su estado indicado en cada sección.' : 'Borrador guardado en esta ficha.');
    if (advance && currentTab.current === submittedTab) onSelectTab(result.preparation.activeSection, true);
  };
  const content = query.isPending ? <p role="status">Cargando preparación…</p> : !section ? <div role="alert">
    <p>{query.isError ? errorMessage(query.error, 'No se ha podido recuperar la preparación.') : 'La preparación no está disponible en este momento.'}</p>
    <button type="button" onClick={() => void query.refetch()}>Reintentar</button>
  </div> : <>
    <header className="product-preparation-heading"><div><p>Preparación manual · {query.data!.preparation.sections.findIndex(item => item.id === tab) + 1} de {query.data!.preparation.sections.length}</p><h2>{section.label}</h2></div>
      <span className="product-preparation-state">{changed ? 'Cambios sin guardar' : section.state === 'reviewed' ? 'Datos revisados' : section.state === 'saved' ? 'Borrador guardado' : 'Por preparar'}</span>
    </header>
    <InformationDisclosure label="Sobre esta sección"><p>{section.notice}</p></InformationDisclosure>
    {query.data?.preparation.briefReady && <p className="product-preparation-summary">La preparación de las ocho secciones está revisada. Los recursos y la publicación conservan su estado propio.</p>}
    {editorDirty && <p role="status" className="product-preparation-warning">Hay cambios sin guardar en el editor de esta ficha. Guárdalos allí antes de guardar la preparación. Tus respuestas se conservan.</p>}
    {(stale || conflict) && <div className="product-preparation-warning" role="alert">
      <p>La ficha tiene una revisión nueva. Tus respuestas siguen aquí. Compara los datos antes de volver a guardar.</p>
      {schemaChanged && <><p>También han cambiado algunos campos. Al conservar tus respuestas, el texto de los campos convertidos en notas pasará a esas notas. Las demás respuestas retiradas seguirán visibles para que puedas copiarlas.</p>
        <details><summary>Ver respuestas de campos anteriores</summary>{retiredFields.map(id => <p key={id}>{answers[id] || 'Sin indicar'}</p>)}</details></>}
      <details><summary>Ver los datos guardados</summary><dl>{section.fields.map(field => <div key={field.id}><dt>{field.label}</dt><dd>{field.value || 'Sin indicar'}</dd></div>)}</dl></details>
      <div className="product-preparation-conflict-actions">
        <button type="button" disabled={saving || query.isFetching} onClick={() => {
          if (!sameOwner()) return;
          const reconciled = reconcilePreparationAnswers(section.fields, answers);
          updateDrafts(before => ({ ...before, [tab]: { revision, ...reconciled, previousAnswers: [...(before[tab]?.previousAnswers ?? []), ...reconciled.previousAnswers] } })); clearError();
        }}>He revisado los cambios: conservar mis respuestas</button>
        <button type="button" disabled={saving || query.isFetching} onClick={discard}>Usar los datos guardados</button>
      </div>
    </div>}
    {!!draft?.previousAnswers?.length && <details className="product-preparation-warning"><summary>Respuestas de campos anteriores para consultar o copiar</summary>{draft.previousAnswers.map((value, index) => <p key={index}>{value}</p>)}</details>}
    <form onSubmit={event => { event.preventDefault(); void save(true); }} noValidate aria-label={`Preparar ${section.label}`} aria-busy={saving}>
      <fieldset disabled={saving}><legend className="sr-only">Datos de {section.label}</legend>
        <PreparationFields fields={section.fields} answers={answers} onChange={change} />
      </fieldset>
      {error && <p role="alert" className="product-preparation-error">{error}</p>}
      {notice && <p role="status" className="product-preparation-saved">{notice}</p>}
      <footer className="product-preparation-actions">
        <button type="button" disabled={blocked} onClick={() => void save(false)}>Guardar borrador</button>
        <button type="submit" disabled={blocked} className={complementary ? '' : 'product-preparation-continue'}>{saving ? 'Guardando…' : tab === 'aplus' ? 'Guardar revisión de A+' : 'Guardar y continuar'}</button>
      </footer>
    </form>
  </>;
  return complementary ? <details className="product-preparation product-preparation-complement"><summary>Preparación de esta sección</summary><div>{content}</div></details>
    : <section className="product-preparation" aria-label="Preparación del producto">{content}</section>;
}
