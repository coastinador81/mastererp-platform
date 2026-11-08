import { useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { ProductIcon } from './ProductIcon';

export interface BulkPublishBarProps {
  /** Seleccionados en total. */
  count: number;
  /** Todos los visibles están marcados / algunos lo están. */
  allChecked: boolean;
  onToggleAll: () => void;
  onClear: () => void;
  onPublish: () => void;
}

/**
 * Barra de selección del catálogo (prototipo: publishBarHTML y syncPublishSelection):
 * aparece con la primera casilla, se actualiza en su sitio y, si se vacía desde ella,
 * el foco vuelve a la lista.
 */
export function BulkPublishBar({ count, allChecked, onToggleAll, onClear, onPublish }: BulkPublishBarProps) {
  const bar = useRef<HTMLDivElement>(null);
  const all = useRef<HTMLInputElement>(null);
  const previous = useRef(count);

  useLayoutEffect(() => {
    if (all.current) all.current.indeterminate = count > 0 && !allChecked;
  }, [count, allChecked]);

  // Entra con suavidad al pasar de oculta a visible (clase quitada al acabar).
  useLayoutEffect(() => {
    const wasHidden = previous.current === 0;
    previous.current = count;
    if (wasHidden && count > 0) bar.current?.classList.add('is-entering');
  }, [count]);

  // Vaciada desde la barra (todos fuera, «Quitar selección»): el foco vuelve a la lista.
  const emptyFromBar = (run: () => void) => {
    const inside = Boolean(bar.current?.contains(document.activeElement));
    flushSync(run);
    if (!inside || !bar.current?.hidden) return;
    bar.current?.closest('.product-catalog-drawer')?.querySelector<HTMLElement>('[data-select-product]')?.focus({ preventScroll: true });
  };

  return (
    <div className="product-bulk-slot" data-publish-bar>
      <div
        ref={bar}
        className="product-bulk-bar"
        role="region"
        aria-label="Productos seleccionados"
        hidden={count === 0}
        onAnimationEnd={event => event.currentTarget.classList.remove('is-entering')}
      >
        <label className="product-bulk-all">
          <input ref={all} type="checkbox" data-select-all aria-label="Seleccionar todos los productos" checked={count > 0 && allChecked} onChange={() => emptyFromBar(onToggleAll)} />
          <span data-bulk-count><strong>{count}</strong> {count === 1 ? 'seleccionado' : 'seleccionados'}</span>
        </label>
        <button
          type="button"
          className="product-icon-button product-bulk-clear"
          aria-label="Quitar selección"
          data-tooltip="Quitar selección"
          data-tooltip-pos="above"
          onClick={() => emptyFromBar(onClear)}
        >
          <ProductIcon name="close" />
        </button>
        <button type="button" className="primary-action product-bulk-publish" onClick={onPublish}>
          <ProductIcon name="send" />
          Publicar
        </button>
      </div>
    </div>
  );
}
