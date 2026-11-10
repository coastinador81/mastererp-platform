import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { useHydrated } from '../../hooks/useHydrated';
import { LegalMarkdown } from './LegalMarkdown';
import {
  LEGAL_TABS, PRIVACY_PANEL, TERMINOS_PANELS,
  type LegalPageKey, type LegalPanel, type LegalTab, type LegalTabId,
} from './legalContent';

/** Dirección de cada pestaña según la página en la que estamos. Privacidad vive en su
 *  propia página; el resto son anclas de /terminos. Funciona sin JS. */
function hrefFor(tab: LegalTab, page: LegalPageKey): string {
  if (tab.page === 'privacidad') return '/privacidad';
  return page === 'terminos' ? `#panel-${tab.id}` : `/terminos#panel-${tab.id}`;
}

/** Panel activo a partir del hash: `#panel-<id>` (una pestaña) o `#<id>-<sección>` (un
 *  apartado del índice). Devuelve null si el hash no apunta a ningún panel de la página. */
function panelFromHash(hash: string, panels: readonly LegalPanel[]): LegalTabId | null {
  const raw = hash.replace(/^#/, '');
  if (!raw) return null;
  const direct = raw.startsWith('panel-') ? raw.slice('panel-'.length) : raw;
  for (const panel of panels) {
    if (direct === panel.id || raw === panel.id || raw.startsWith(`${panel.id}-`)) return panel.id;
  }
  return null;
}

function Panel({ panel, shown }: { panel: LegalPanel; shown: boolean }) {
  return (
    <section className={`tab-panel${shown ? ' is-shown' : ''}`} id={`panel-${panel.id}`} aria-labelledby={`tab-${panel.id}`}>
      <h2 className="panel-title">{panel.title}</h2>
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
        <LegalMarkdown source={panel.body} idPrefix={panel.id} headingOffset={1} />
      </div>
    </section>
  );
}

/**
 * Centro legal con pestañas. La barra es la misma en /terminos y /privacidad.
 *
 * Sin JavaScript (la puerta de DEV sirve estas dos páginas sin JS), las pestañas son
 * anclas `:target`: el panel y la pestaña activa los decide el CSS. Con JavaScript (la
 * SPA), React lee el ancla de la URL al cargar y al navegar y muestra la pestaña pedida
 * —así, llegar a /terminos#panel-… desde /privacidad abre el panel correcto, no el
 * primero— y la trae a la vista. La clase `legal-center--<página>` evita que /privacidad
 * marque además la pestaña Términos como activa.
 */
export function LegalCenter({ page }: { page: LegalPageKey }) {
  const panels = page === 'terminos' ? TERMINOS_PANELS : [PRIVACY_PANEL];
  const defaultId: LegalTabId = page === 'privacidad' ? 'privacidad' : panels[0].id;
  const location = useLocation();
  // false en el prerender (sin JS, manda el CSS :target); true en la SPA (manda React).
  const hydrated = useHydrated();
  const hashId = panelFromHash(location.hash, panels);
  const activeId = hashId ?? defaultId;
  const activeTabRef = useRef<HTMLAnchorElement | null>(null);

  // Con JS, al elegir una pestaña por su ancla la traemos a la vista (la barra se desplaza).
  useEffect(() => {
    if (hydrated && hashId) activeTabRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [hydrated, hashId]);

  return (
    <div className={`legal-center legal-center--${page}${hydrated ? ' is-hydrated' : ''}`}>
      <nav className="legal-tabs" aria-label="Textos legales">
        <ul>
          {LEGAL_TABS.map(tab => {
            // Con JS, la pestaña activa la marca React (el CSS la marca sin JS). En
            // /privacidad solo la pestaña Privacidad; en /terminos, la del ancla.
            const active = hydrated && (page === 'privacidad' ? tab.id === 'privacidad' : tab.id === activeId);
            return (
              <li key={tab.id}>
                <a
                  id={`tab-${tab.id}`}
                  data-tab={tab.id}
                  href={hrefFor(tab, page)}
                  ref={active ? activeTabRef : undefined}
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
          <Panel panel={panel} key={panel.id} shown={hydrated && panel.id === activeId} />
        ))}
      </div>
    </div>
  );
}
