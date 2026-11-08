import { useLayoutEffect, useRef } from 'react';
import clsx from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import { Icon } from '@/shared/ui';
import { useAplus, useAplusController } from '../hooks/aplusContext';

/** Selector «Documento A+» (solo con más de un documento del ASIN; A08/E04). */
function DocumentSelect() {
  const controller = useAplusController();
  const { docs, value, blocked } = useAplus(useShallow(state => ({
    docs: state.availableDocuments,
    value: state.pendingDocumentKey ?? state.selectedDocumentKey,
    blocked: state.loading || state.publishing,
  })));
  const ref = useRef<HTMLSelectElement>(null);
  const refocus = useRef(false);

  // Al bloquearse con el foco dentro se pierde el foco; al desbloquearse vuelve.
  useLayoutEffect(() => {
    const select = ref.current;
    if (!select) return;
    if (blocked && document.activeElement === select) refocus.current = true;
    if (!blocked && refocus.current) {
      refocus.current = false;
      if (!document.activeElement || document.activeElement === document.body) select.focus({ preventScroll: true });
    }
  }, [blocked]);

  if (docs.length <= 1) return null;
  return (
    <select
      ref={ref}
      className="pim-select pim-aplus-docs"
      aria-label="Documento A+"
      value={value}
      disabled={blocked}
      onChange={event => controller.selectDocument(event.target.value)}
    >
      {docs.map((doc, idx) => {
        const crk = doc.contentReferenceKey || doc.contentMetadata?.contentReferenceKey || '';
        const status = doc.contentMetadata?.status || 'UNKNOWN';
        const name = doc.contentMetadata?.name || `Documento ${idx + 1}`;
        const label = status === 'APPROVED' ? 'Publicado' : status === 'DRAFT' ? 'Borrador' : status;
        return <option key={`${crk}-${idx}`} value={crk}>{`${name} (${label})`}</option>;
      })}
    </select>
  );
}

/** Cabecera: título, documento, Recargar y línea de datos con los estados. */
export function AplusHeader() {
  const controller = useAplusController();
  const { count, valid, unsaved, loading, blocked } = useAplus(useShallow(state => ({
    count: state.modules.length,
    valid: state.modules.filter(module => module.isValid).length,
    unsaved: state.hasUnsavedChanges,
    loading: state.loading,
    blocked: state.loading || state.publishing,
  })));
  const asin = controller.asin;

  return (
    <header className="pim-head pim-aplus-head">
      <div className="pim-head-row pim-aplus-head-row">
        <div className="pim-aplus-head-text">
          <h2>Contenido A+</h2>
          <p>Crea módulos de contenido premium para tus productos</p>
        </div>
        <div className="pim-aplus-head-tools">
          <span className="pim-aplus-docs-slot">
            <DocumentSelect />
          </span>
          <button
            type="button"
            className="pim-btn pim-btn-ghost pim-btn-sm"
            aria-disabled={blocked}
            onClick={() => {
              if (!blocked) controller.reload();
            }}
          >
            <Icon name="refresh-cw" size={14} className={loading ? 'pim-spin' : undefined} />
            Recargar
          </button>
        </div>
      </div>
      <div className="pim-aplus-status-row">
        <div className="pim-meta">
          {asin ? (
            <span>
              ASIN: <span className="pim-mono pim-aplus-asin">{asin}</span>
            </span>
          ) : null}
          <span>{`${count} módulo${count !== 1 ? 's' : ''} creado${count !== 1 ? 's' : ''}`}</span>
        </div>
        <span className="pim-badge pim-badge-amber" hidden={!unsaved}>Cambios sin guardar</span>
        <span className={clsx('pim-badge', valid === count ? 'pim-badge-green' : 'pim-badge-amber')} hidden={count === 0}>
          {`${valid}/${count} válido${valid !== 1 ? 's' : ''}`}
        </span>
      </div>
    </header>
  );
}
