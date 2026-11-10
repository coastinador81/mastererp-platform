import { Link } from 'react-router';
import { useSession } from '@/modules/auth';
import { isSignedIn, startAccess, usePublicSession } from '../../hooks/usePublicSession';
import { PATHS } from '../../model/views';
import { HomeLink } from '../common/HomeLink';
import { ServicesButton } from '../common/ServicesButton';

/**
 * Cabecera de la portada (D-HOME-REORG-20261109): el logotipo, «Sobre Uonify» y «Cómo
 * funciona» (solo sin sesión); a la derecha, el acceso y el botón de servicios.
 */
export function HomeHeader() {
  const { links } = usePublicSession();
  const { status } = useSession();
  const signedIn = isSignedIn(status);

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
        <ServicesButton />
      </div>
    </header>
  );
}
