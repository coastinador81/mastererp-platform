import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useEventListener } from '@/shared/hooks';
import { useSession } from '@/modules/auth';
import { isSignedIn, startAccess, usePublicSession } from '../../hooks/usePublicSession';
import { PATHS } from '../../model/views';
import { HomeLink } from '../common/HomeLink';
import { ToolsPanel } from './ToolsPanel';

const documentTarget = typeof document === 'undefined' ? null : document;

/** Cabecera de la portada: logotipo, navegación, acceso y panel de herramientas. */
export function HomeHeader() {
  const { links } = usePublicSession();
  const { status } = useSession();
  const signedIn = isSignedIn(status);
  const [toolsOpen, setToolsOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (toolsOpen) panelRef.current?.querySelector<HTMLElement>('.tools-grid a,.tools-grid button')?.focus();
  }, [toolsOpen]);
  useEventListener('pointerdown', event => {
    const target = event.target as Node;
    if (toolsOpen && !panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) setToolsOpen(false);
  }, documentTarget);
  useEventListener('keydown', event => { if (event.key === 'Escape' && toolsOpen) setToolsOpen(false); }, documentTarget);

  return (
    <header className="header">
      <HomeLink className="home-brand" brand aria-label="Uonify, volver al inicio">
        <img data-uonify-logo="relief" src="/assets/brands/uonify-wordmark-3d.webp" width="789" height="166" alt="Uonify" />
      </HomeLink>
      <nav className="nav" aria-label="Navegación principal">
        {!signedIn && (
          <>
            <Link to={PATHS.sobreUonify}>Sobre Uonify</Link>
            <Link to={PATHS.comoFunciona}>Cómo funciona</Link>
          </>
        )}
      </nav>
      <div className="header-actions">
        <button type="button" className="identity-trigger" data-auth-trigger onClick={() => startAccess()}>{links.identityTrigger}</button>
        <button
          ref={triggerRef}
          type="button"
          className="tools-trigger"
          aria-label="Herramientas de Uonify"
          aria-expanded={toolsOpen}
          aria-controls="tools-panel"
          title="Herramientas de Uonify"
          onClick={() => setToolsOpen(open => !open)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {[5, 12, 19].flatMap(cy => [5, 12, 19].map(cx => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.7" />))}
          </svg>
        </button>
      </div>
      <ToolsPanel ref={panelRef} open={toolsOpen} />
    </header>
  );
}
