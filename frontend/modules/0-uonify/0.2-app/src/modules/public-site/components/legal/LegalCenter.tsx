import { LegalMarkdown } from './LegalMarkdown';
import {
  LEGAL_TABS, PRIVACY_PANEL, TERMINOS_PANELS,
  type LegalPageKey, type LegalPanel, type LegalTab,
} from './legalContent';

/** Dirección de cada pestaña según la página en la que estamos. Privacidad vive en su
 *  propia página; el resto son anclas de /terminos. Funciona sin JS. */
function hrefFor(tab: LegalTab, page: LegalPageKey): string {
  if (tab.page === 'privacidad') return '/privacidad';
  return page === 'terminos' ? `#panel-${tab.id}` : `/terminos#panel-${tab.id}`;
}

function Panel({ panel }: { panel: LegalPanel }) {
  return (
    <section className="tab-panel" id={`panel-${panel.id}`} aria-labelledby={`tab-${panel.id}`}>
      <p className="panel-title">{panel.title}</p>
      {panel.toc.length > 1 && (
        <nav className="panel-toc" aria-label={`Índice de ${panel.title}`}>
          <ol>
            {panel.toc.map(item => (
              <li key={item.id}>
                <a href={`#${item.id}`}>{item.label}</a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="legal-body">
        <LegalMarkdown source={panel.body} idPrefix={panel.id} />
      </div>
    </section>
  );
}

/**
 * Centro legal con pestañas. La barra es la misma en /terminos y /privacidad. En
 * /terminos, las pestañas son paneles con ancla (`:target`); el primero (Términos) se
 * ve por defecto. En /privacidad, la pestaña Privacidad está activa y las demás enlazan
 * a /terminos. Todo funciona sin JavaScript (la puerta de DEV sirve estas dos páginas
 * sin JS); con `:has`, al elegir una pestaña solo se ve su panel.
 */
export function LegalCenter({ page }: { page: LegalPageKey }) {
  const panels = page === 'terminos' ? TERMINOS_PANELS : [PRIVACY_PANEL];
  return (
    <div className="legal-center">
      <nav className="legal-tabs" aria-label="Textos legales">
        <ul>
          {LEGAL_TABS.map(tab => {
            const active = page === 'privacidad' && tab.id === 'privacidad';
            return (
              <li key={tab.id}>
                <a
                  id={`tab-${tab.id}`}
                  data-tab={tab.id}
                  href={hrefFor(tab, page)}
                  aria-current={active ? 'page' : undefined}
                  className={active ? 'is-active' : undefined}
                >
                  {tab.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="legal-panels">
        {panels.map(panel => (
          <Panel panel={panel} key={panel.id} />
        ))}
      </div>
    </div>
  );
}
