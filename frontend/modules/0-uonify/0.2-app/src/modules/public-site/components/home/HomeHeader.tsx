import { Link } from 'react-router';
import { startAccess, usePublicSession } from '../../hooks/usePublicSession';
import { PATHS } from '../../model/views';
import { HomeLink } from '../common/HomeLink';
import { PublicModuleLauncher } from './PublicModuleLauncher';

/** Cabecera de la portada: logotipo, navegación, acceso y lanzador de aplicaciones. */
export function HomeHeader() {
  const { links } = usePublicSession();

  return (
    <header className="header">
      <HomeLink className="home-brand" brand aria-label="Uonify, volver al inicio">
        <img data-uonify-logo="relief" src="/assets/brands/uonify-wordmark-3d.webp" width="789" height="166" alt="Uonify" />
      </HomeLink>
      <nav className="nav" aria-label="Navegación principal">
        <Link to={PATHS.comoFunciona}>Cómo funciona</Link>
        <Link to={PATHS.productos}>Servicios</Link>
        <Link to={PATHS.loQuePuedesHacer}>Lo que puedes hacer</Link>
        <Link to={PATHS.partners}>Partners</Link>
        <Link to={PATHS.clientes}>Clientes</Link>
        <Link to={PATHS.precios}>Precios</Link>
        <Link to="/ayuda">Ayuda</Link>
      </nav>
      <div className="header-actions">
        <button type="button" className="identity-trigger" data-auth-trigger onClick={() => startAccess()}>{links.identityTrigger}</button>
        <PublicModuleLauncher />
      </div>
    </header>
  );
}
