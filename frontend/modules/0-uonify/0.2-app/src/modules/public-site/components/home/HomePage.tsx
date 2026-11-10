import homeStyles from '../../styles/home/styles.css?inline';
import homeV20 from '../../styles/home/v20.css?inline';
import homeFlow from '../../styles/home/flow.css?inline';
import compactComposer from '../../styles/home/compact-composer.css?inline';
import homeTesting from '../../styles/home/testing.css?inline';
import { viewSheets } from '../../styles/sheets';
import { PUBLIC_VIEWS } from '../../model/views';
import { PublicView } from '../common/PublicView';
import { SkipLink } from '../common/SkipLink';
import { SiteFooter } from '../footer/SiteFooter';
import { HomeHeader } from './HomeHeader';
import { HomeHero } from './HomeHero';

/** Hojas de la portada en el orden de unified.js (home-v20, v20, flow de v21 y testing). */
const SHEETS = viewSheets(homeStyles, homeV20, homeFlow, homeTesting, compactComposer);

/**
 * Portada pública (`/`, #view-portada). Como en el PROTO, <AuthDialogs/> la oculta
 * mientras se consulta la sesión y lleva al espacio a quien ya lo tiene listo.
 */
export function HomePage() {
  return (
    <PublicView view={PUBLIC_VIEWS.portada} sheets={SHEETS}>
      <SkipLink />
      <div className="ambient" aria-hidden="true"><span></span><i></i><i></i></div>
      <HomeHeader />
      <HomeHero />
      <SiteFooter />
    </PublicView>
  );
}
