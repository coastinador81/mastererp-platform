import { useLayoutEffect, useRef, useState } from 'react';
import { useEventListener } from '@/shared/hooks';
import toolsCss from '../../styles/common/tools-panel.css?inline';
import { useViewStyles } from '../../hooks/useViewStyles';
import { ToolsPanel } from '../home/ToolsPanel';

/** Hoja propia del botón y su panel (constante de módulo): useViewStyles la inyecta y el prerender la enlaza. */
const SHEETS: readonly string[] = [toolsCss];

const documentTarget = typeof document === 'undefined' ? null : document;

/**
 * Botón de servicios (9 puntos) con el panel «Tu espacio Uonify». Es el mismo en la cabecera
 * de la portada y en la de las páginas interiores (D-HOME-REORG-20261109: a la derecha,
 * «Iniciar sesión» y el botón de servicios). Al abrirse enfoca el primer servicio; un clic
 * fuera o Escape lo cierran, y Escape devuelve el foco al botón.
 */
export function ServicesButton() {
  useViewStyles('tools-panel', SHEETS);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>('.tools-grid a,.tools-grid button')?.focus();
  }, [open]);
  useEventListener('pointerdown', event => {
    const target = event.target as Node;
    if (open && !panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
  }, documentTarget);
  useEventListener('keydown', event => {
    if (event.key !== 'Escape' || !open) return;
    setOpen(false);
    triggerRef.current?.focus();
  }, documentTarget);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="tools-trigger"
        aria-label="Herramientas de Uonify"
        aria-expanded={open}
        aria-controls="tools-panel"
        title="Herramientas de Uonify"
        onClick={() => setOpen(value => !value)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {[5, 12, 19].flatMap(cy => [5, 12, 19].map(cx => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.7" />))}
        </svg>
      </button>
      <ToolsPanel ref={panelRef} open={open} />
    </>
  );
}
