import { Fragment } from 'react';
import legalCss from '../../styles/legal/legal.css?inline';
import { viewSheets } from '../../styles/sheets';
import { PATHS, PUBLIC_VIEWS } from '../../model/views';
import { HomeLink } from '../common/HomeLink';
import { PublicView } from '../common/PublicView';
import { LEGAL_DOCUMENTS, type LegalKey } from './legalContent';

const SHEETS = viewSheets(legalCss);

/**
 * Privacidad y Condiciones (#view-privacidad y #view-terminos). Públicas en todos
 * los entornos y sin sesión: se abren desde el acceso en otra pestaña.
 */
export function LegalPage({ doc }: { doc: LegalKey }) {
  const content = LEGAL_DOCUMENTS[doc];
  return (
    <PublicView view={PUBLIC_VIEWS[doc]} sheets={SHEETS}>
      <header>
        <HomeLink brand aria-label="Uonify, inicio">
          <img data-uonify-logo="relief" src="/assets/brands/uonify-wordmark-3d.webp" width="132" height="28" alt="Uonify" />
        </HomeLink>
        <HomeLink to={PATHS.composer}>Volver a Uonify</HomeLink>
      </header>
      <main>
        <p className="eyebrow">{content.eyebrow}</p>
        <h1>{content.title}</h1>
        <p className="lead">{content.lead}</p>
        {content.sections.map(section => (
          <Fragment key={section.heading}>
            <h2>{section.heading}</h2>
            <p>{section.body}</p>
          </Fragment>
        ))}
        <HomeLink className="back" to={PATHS.composer}>Volver a Uonify →</HomeLink>
      </main>
    </PublicView>
  );
}

export function PrivacyPage() {
  return <LegalPage doc="privacidad" />;
}

export function TermsPage() {
  return <LegalPage doc="terminos" />;
}
