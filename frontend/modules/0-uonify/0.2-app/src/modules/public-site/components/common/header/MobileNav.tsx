import { useRef } from 'react';
import { Link } from 'react-router';
import { useEventListener } from '@/shared/hooks';
import type { PublicViewKey } from '../../../model/views';
import type { NavEntry } from './navModel';

const documentTarget = typeof document === 'undefined' ? null : document;

interface MobileNavProps {
  entries: readonly NavEntry[];
  current?: PublicViewKey;
  open: boolean;
  onToggle: (open: boolean) => void;
}

/**
 * Menú de la cabecera en pantallas estrechas: un botón con las tres líneas abre, bajo la cabecera,
 * la lista completa (los grupos con su título). Escape o elegir una página lo cierran.
 */
export function MobileNav({ entries, current, open, onToggle }: MobileNavProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  useEventListener('keydown', event => {
    if (event.key !== 'Escape' || !open) return;
    onToggle(false);
    trigger.current?.focus({ preventScroll: true });
  }, documentTarget);
  const item = (page: { to: string; label: string; view: PublicViewKey }) => (
    <li key={page.to}>
      <Link to={page.to} aria-current={page.view === current ? 'page' : undefined} onClick={() => onToggle(false)}>{page.label}</Link>
    </li>
  );
  return (
    <>
      <button ref={trigger} type="button" className="hnav-burger" aria-expanded={open} aria-controls="hnav-mobile" aria-label={open ? 'Cerrar el menú' : 'Abrir el menú'} onClick={() => onToggle(!open)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">{open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}</svg>
      </button>
      <nav id="hnav-mobile" className="hnav-sheet" aria-label="Menú" hidden={!open}>
        <ul>
          {entries.map(entry => entry.kind === 'link' ? item(entry.page) : (
            <li key={entry.key} className="hnav-sheet-group">
              <span>{entry.label}</span>
              <ul>{entry.pages.map(item)}</ul>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
