import { useRef } from 'react';
import { Link } from 'react-router';
import { useEventListener } from '@/shared/hooks';
import type { PublicViewKey } from '../../../model/views';
import type { NavPage } from './navModel';

const documentTarget = typeof document === 'undefined' ? null : document;

interface NavDropdownProps {
  id: string;
  label: string;
  pages: readonly NavPage[];
  current?: PublicViewKey;
  active: boolean;
  open: boolean;
  onToggle: (open: boolean) => void;
}

/**
 * Grupo de la fila que se despliega al pulsarlo, como en las webs de Google: cada página con su
 * frase de cabecera. Un clic fuera o Escape lo cierran (Escape devuelve el foco al botón).
 */
export function NavDropdown({ id, label, pages, current, active, open, onToggle }: NavDropdownProps) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEventListener('pointerdown', event => {
    if (open && !root.current?.contains(event.target as Node)) onToggle(false);
  }, documentTarget);
  useEventListener('keydown', event => {
    if (event.key !== 'Escape' || !open) return;
    onToggle(false);
    trigger.current?.focus({ preventScroll: true });
  }, documentTarget);
  return (
    <div className="hnav-group" ref={root}>
      <button
        ref={trigger}
        type="button"
        className={active ? 'hnav-item is-active' : 'hnav-item'}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => onToggle(!open)}
      >
        {label}
        <svg className="hnav-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
      </button>
      <div id={id} className="hnav-panel" hidden={!open}>
        <ul>
          {pages.map(page => (
            <li key={page.to}>
              <Link to={page.to} className="hnav-option" aria-current={page.view === current ? 'page' : undefined} onClick={() => onToggle(false)}>
                <strong>{page.label}</strong>
                <span>{page.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
