import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { InformationDisclosure } from '@/shared/ui';
import { useContextUsage } from '../../hooks/useContextUsage';
import { useComposerStore } from '../../hooks/composerStore';
import { useDismissOnPointerDown } from '../../hooks/useDismiss';
import { visibleBottom } from '../../hooks/uiStore';
import { contextNumber, contextPercentage } from '../../model/contextUsage';
import { toBox, usagePanelPosition } from '../../model/placement';
import { GoogleBillingPanel } from './GoogleBillingPanel';

/** El pequeño círculo mide la información enviada, separado de los costes de IA. */
export function ContextUsage({ formRef }: { formRef: RefObject<HTMLFormElement | null> }) {
  const context = useContextUsage();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'context' | 'google'>('context');
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const { summary, data } = context;
  const percentage = summary ? contextPercentage(summary.percentage) : null;
  const label = percentage !== null ? `Contexto de esta conversación: ${percentage} % ocupado`
    : context.loading ? 'Contexto de esta conversación: midiendo' : 'Contexto de esta conversación: no disponible';
  useDismissOnPointerDown(open, [button, panel], () => setOpen(false));
  useLayoutEffect(() => {
    if (!open || !panel.current || !button.current || !formRef.current) return;
    const place = () => {
      if (!panel.current || !button.current || !formRef.current) return;
      const form = formRef.current;
      const outer = toBox(form);
      const inner = { ...outer, left: outer.left + form.clientLeft, width: form.clientWidth };
      const position = usagePanelPosition(inner, toBox(button.current), panel.current.offsetWidth,
        { panelHeight: panel.current.offsetHeight, viewportHeight: visibleBottom() });
      panel.current.style.left = `${position.left}px`;
      panel.current.style.bottom = `${position.bottom}px`;
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(formRef.current); observer?.observe(panel.current);
    window.addEventListener('resize', place);
    return () => { observer?.disconnect(); window.removeEventListener('resize', place); };
  }, [open, formRef, context.message, percentage, tab]);
  const close = () => { setOpen(false); button.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); button.current?.focus(); }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open]);
  return <>
    <button ref={button} type="button" className={`composer-context-trigger is-${summary?.tone ?? 'unknown'}`}
      aria-label={label} aria-controls={id} aria-expanded={open} data-tooltip={label}
      data-context-percentage={summary?.ringPercentage} onClick={() => {
        useComposerStore.getState().setPicker(null); setOpen(value => !value);
      }} onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); close(); } }}>
      <svg viewBox="0 0 20 20" aria-hidden="true" className="composer-context-circle">
        <circle cx="10" cy="10" r="7.5" className="composer-context-track" />
        {summary ? <circle cx="10" cy="10" r="7.5" pathLength="100" className="composer-context-fill"
          strokeDasharray={`${summary.ringPercentage} 100`} /> :
          <text x="10" y="13" textAnchor="middle" className="composer-context-unknown">{context.loading ? '…' : '?'}</text>}
      </svg>
    </button>
    <div ref={panel} id={id} role="region" aria-label="Contexto y Google" className="composer-context-panel"
      hidden={!open} onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      }} onBlur={event => {
        // Un control puede perder el foco al deshabilitarse durante la consulta.
        // Ese cambio interno no debe cerrar el panel ni cancelar su petición.
        if (event.relatedTarget && !panel.current?.contains(event.relatedTarget)
          && !button.current?.contains(event.relatedTarget)) setOpen(false);
      }}>
      <div className="composer-context-heading"><strong>Uso</strong>
        <button type="button" aria-label="Cerrar información del contexto" onClick={close}>×</button></div>
      <div role="tablist" aria-label="Información de uso" className="composer-usage-tabs" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const selected = event.key === 'Home' ? 'context' : event.key === 'End' ? 'google' : tab === 'context' ? 'google' : 'context';
        setTab(selected); panel.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[selected === 'context' ? 0 : 1]?.focus();
      }}>
        <button type="button" role="tab" id={`${id}-context-tab`} aria-controls={`${id}-context-content`} aria-selected={tab === 'context'}
          tabIndex={tab === 'context' ? 0 : -1} onClick={() => setTab('context')}>Contexto</button>
        <button type="button" role="tab" id={`${id}-google-tab`} aria-controls={`${id}-google-content`} aria-selected={tab === 'google'}
          tabIndex={tab === 'google' ? 0 : -1} onClick={() => setTab('google')}>Google</button>
      </div>
      <div role="tabpanel" id={`${id}-context-content`} aria-labelledby={`${id}-context-tab`} hidden={tab !== 'context'} className="composer-usage-tabpanel">
      {summary ? <>
        <p className={`composer-context-percent is-${summary.tone}`}>{percentage} % ocupado</p>
        <dl><div><dt>Tokens usados</dt><dd>{contextNumber(summary.used)}</dd></div>
          <div><dt>Límite del modelo</dt><dd>{contextNumber(summary.limit)}</dd></div>
          <div><dt>Tokens libres</dt><dd>{contextNumber(summary.remaining)}</dd></div></dl>
        {summary.percentage >= 100 ? <p className="composer-context-alert">La próxima entrada supera la capacidad del modelo.</p> :
          summary.percentage >= 90 ? <p className="composer-context-alert">Queda poco espacio en el contexto.</p> : null}
        {/* D-PROTECCIÓN: el popover NUNCA muestra el motor real (era «Gemini 3.5 Flash»). Marca «Uony» cuando hay medición. */}
        <p className="composer-context-model">{data?.modelLabel ? 'Uony' : null}</p>
      </> : <p className="composer-context-state" role="status">{context.message}</p>}
      {!summary && !context.loading && context.canRetry ? <button type="button" className="composer-context-retry" onClick={context.retry}>Volver a medir</button> : null}
      <InformationDisclosure label="Qué mide este círculo">
        <p>Muestra el espacio que ocupará la próxima entrada de Uony, incluido lo que estás escribiendo,
          las instrucciones de Uony y la información del producto abierto.</p>
        <p>Uony envía hasta 12 intercambios recientes de este hilo. El resto de la conversación sigue guardado.
          Cambiar de modelo o de razonamiento actualiza la medición.</p>
        <p>Este espacio es la memoria de trabajo del modelo. El saldo de Google y los tokens consumidos se consultan por separado.</p>
      </InformationDisclosure>
      </div>
      <div role="tabpanel" id={`${id}-google-content`} aria-labelledby={`${id}-google-tab`} hidden={tab !== 'google'} className="composer-usage-tabpanel">
        <GoogleBillingPanel active={open && tab === 'google'} />
      </div>
    </div>
  </>;
}
