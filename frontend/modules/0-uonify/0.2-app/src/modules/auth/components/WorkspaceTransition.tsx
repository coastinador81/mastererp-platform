import { useEffect, useLayoutEffect, useRef } from 'react';
import clsx from 'clsx';
import { cancelTransition, retryTransition } from '../flows/access';
import { useNativeDialog } from '../hooks/useNativeDialog';
import { patchTransition, useAuthUi } from '../state/authUi';
import { BRAND } from './brand';

const STEPS = [0, 1, 2];
// La capa no se cierra con Escape: sale sola o con sus botones.
const ignoreCancel = () => {};

/** Capa de acceso y bienvenida al espacio (prototipo: #uon-workspace-transition). */
export function WorkspaceTransition() {
  const view = useAuthUi(state => state.transition);
  const { ref, onKeyDown } = useNativeDialog(view.open, ignoreCancel);
  const message = useRef<HTMLDivElement>(null);

  // Aparece en el fotograma siguiente para que se vea el fundido.
  useEffect(() => {
    if (!view.open || view.visible) return undefined;
    const frame = window.requestAnimationFrame(() => patchTransition({ visible: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [view.open, view.visible]);

  // Cada mensaje repite su animación de entrada sin volver a crear la región viva.
  useLayoutEffect(() => {
    const element = message.current;
    if (!element || !view.messageKey) return;
    element.classList.remove('is-changing');
    void element.offsetWidth;
    element.classList.add('is-changing');
  }, [view.messageKey]);

  return (
    <dialog
      ref={ref}
      id="uon-workspace-transition"
      className={clsx('uon-workspace-transition', {
        'is-visible': view.visible,
        'is-ready': view.ready,
        'is-leaving': view.leaving,
        'is-error': view.error,
      })}
      data-context={view.context}
      aria-labelledby="uon-transition-title"
      aria-describedby="uon-transition-copy"
      onKeyDown={onKeyDown}
    >
      <img data-uonify-logo="relief" className="uon-transition-brand" src={BRAND.wordmark} width={154} height={34} alt="Uonify" />
      <div className="uon-transition-center">
        <div className="uon-transition-emblem" aria-hidden="true">
          <span className="uon-transition-orbit" />
          <span className="uon-transition-orbit uon-transition-orbit-inner" />
          <div className="uon-transition-logo">
            <img data-uonify-logo="relief" src={BRAND.overlay} width={1024} height={640} fetchPriority="high" decoding="async" alt="" />
          </div>
        </div>
        <p className="uon-transition-kicker" id="uon-transition-kicker">
          {view.kicker}
        </p>
        <div ref={message} className="uon-transition-message" aria-live="polite" aria-atomic="true">
          <h2 id="uon-transition-title" tabIndex={-1}>
            {view.title}
          </h2>
          <p id="uon-transition-copy">{view.copy}</p>
        </div>
        <div className="uon-transition-steps" aria-hidden="true">
          {STEPS.map(index => (
            <span key={index} className={clsx(index === view.step && 'is-current', index < view.step && 'is-complete')} />
          ))}
        </div>
        <div className="uon-transition-actions">
          <button type="button" id="uon-transition-retry" hidden={!view.retry} onClick={retryTransition}>
            Intentar de nuevo
          </button>
          <button type="button" id="uon-transition-cancel" hidden={!view.cancel} onClick={cancelTransition}>
            Volver
          </button>
        </div>
      </div>
      <p className="uon-transition-foot">TUS IDEAS. TODO UN UNIVERSO DE POSIBILIDADES.</p>
    </dialog>
  );
}
