import legalCss from '../../styles/legal/legal.css?inline';
import { viewSheets } from '../../styles/sheets';
import { PATHS, PUBLIC_VIEWS } from '../../model/views';
import { HomeLink } from '../common/HomeLink';
import { PageHeader } from '../common/PageHeader';
import { PublicView } from '../common/PublicView';
import { SiteFooter } from '../footer/SiteFooter';
import { LegalCenter } from './LegalCenter';
import { PAGE_META, type LegalPageKey } from './legalContent';

const SHEETS = viewSheets(legalCss);

/**
 * Centro legal de Uonify (#view-privacidad y #view-terminos). Público en todos los
 * entornos y sin sesión. Lleva la cabecera de las páginas públicas (sin página actual: las
 * legales no están en el menú) y el pie global. Una barra de pestañas común lleva a cada
 * texto; /terminos reúne el contrato y /privacidad es su propia pestaña. La puerta de DEV
 * sirve estas dos páginas también sin JS: la cabecera no pinta allí el botón de servicios.
 */
export function LegalPage({ doc }: { doc: LegalPageKey }) {
  const meta = PAGE_META[doc];
  return (
    <PublicView view={PUBLIC_VIEWS[doc]} sheets={SHEETS}>
      <PageHeader loginLabel="Tu espacio Uonify" noJs />
      <main id="contenido" tabIndex={-1}>
        <p className="eyebrow">{meta.eyebrow}</p>
        <h1>{meta.title}</h1>
        <p className="lead">{meta.lead}</p>
        <LegalCenter page={doc} />
        <HomeLink className="back" to={PATHS.composer}>Volver a Uonify →</HomeLink>
      </main>
      <SiteFooter />
    </PublicView>
  );
}

export function PrivacyPage() {
  return <LegalPage doc="privacidad" />;
}

export function TermsPage() {
  return <LegalPage doc="terminos" />;
}
