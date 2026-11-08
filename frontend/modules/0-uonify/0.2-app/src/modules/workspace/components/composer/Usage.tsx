import { useLayoutEffect, useRef, type CSSProperties, type RefObject } from 'react';
import { useComposerStore } from '../../hooks/composerStore';
import { useDismissOnPointerDown } from '../../hooks/useDismiss';
import { useUsage } from '../../hooks/useUsage';
import { limitInfo } from '../../model/aiLimit';
import { toBox, usagePanelPosition } from '../../model/placement';
import { UsagePayerNote } from './UsageExtras';

/**
 * Indicador de uso del compositor del espacio (composer-tools.js): solo el
 * anillo, con el porcentaje en su nombre y su tooltip; el panel enseña los
 * límites como Claude, con datos de la API, justo encima de su botón, y con qué
 * paga Uony en esta sesión (plan de ChatGPT o tokens de Uonify).
 */
export function UsageTrigger({ triggerRef, panelId }: { triggerRef: RefObject<HTMLButtonElement | null>; panelId: string }) {
  const summary = useUsage();
  const open = useComposerStore(state => state.usageOpen);
  return (
    <button
      ref={triggerRef}
      className={`composer-usage-trigger${summary.main !== null ? ' has-usage' : ''}`}
      type="button"
      data-composer-usage-trigger=""
      aria-label={summary.ariaLabel}
      aria-expanded={open}
      aria-controls={panelId}
      data-tooltip={summary.tooltip}
      style={{ '--usage-progress': `${summary.main ?? 0}%` } as CSSProperties}
      onClick={() => useComposerStore.getState().setUsageOpen(!open)}
    >
      <span className="composer-usage-ring" aria-hidden="true" />
      <span data-composer-usage-label="">{summary.label}</span>
    </button>
  );
}

export interface UsagePanelProps {
  formRef: RefObject<HTMLFormElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  panelId: string;
}

export function UsagePanel({ formRef, triggerRef, panelId }: UsagePanelProps) {
  const summary = useUsage();
  const open = useComposerStore(state => state.usageOpen);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = () => useComposerStore.getState().setUsageOpen(false);

  useDismissOnPointerDown(open, [panelRef, triggerRef], close);

  // Justo encima de su botón, alineado a él y dentro del compositor.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const form = formRef.current;
    const trigger = triggerRef.current;
    if (!open || !panel || !form || !trigger) return;
    // El panel se coloca dentro del borde del compositor: se mide su caja interior.
    const outer = toBox(form);
    const inner = { ...outer, left: outer.left + form.clientLeft, width: form.clientWidth };
    const place = usagePanelPosition(inner, toBox(trigger), panel.offsetWidth);
    panel.style.right = 'auto';
    panel.style.left = `${place.left}px`;
    panel.style.bottom = `${place.bottom}px`;
  }, [open, formRef, triggerRef]);

  const { usage, rows } = summary;
  return (
    <div ref={panelRef} className="composer-usage-panel" id={panelId} role="region" aria-label="Límites de uso de OpenAI" hidden={!open}>
      <div className="composer-usage-heading">
        <strong>{summary.heading}</strong>
        {usage?.model ? <span>{usage.model}</span> : null}
      </div>
      {!usage ? <p className="composer-usage-empty">Aún no hay datos de uso de esta cuenta.</p> : null}
      {usage && !rows.length ? <p className="composer-usage-empty">No hay límites disponibles para esta respuesta.</p> : null}
      {usage
        ? rows.map(row => (
            <div key={row.label} className="composer-usage-row" title={row.detail}>
              <div>
                <span>{row.label}</span>
                {row.reset ? <small>Se restablece {row.reset}</small> : null}
                <strong>{Math.round(row.used)}%</strong>
              </div>
              <i style={{ '--usage-row': `${row.used}%` } as CSSProperties}>
                <b />
              </i>
            </div>
          ))
        : null}
      {usage ? <UsagePayerNote info={limitInfo(usage)} /> : null}
    </div>
  );
}
