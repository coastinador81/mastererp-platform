import { Link } from 'react-router';
import { LOCALE_LABELS, useTranslation } from '@/shared/i18n';
import { Icon } from '@/shared/ui';
import footerCss from '../../styles/site-footer.css?inline';
import { useHydrated } from '../../hooks/useHydrated';
import { useViewStyles } from '../../hooks/useViewStyles';
import { PATHS } from '../../model/views';
import { GlobeMenu } from './GlobeMenu';

/** Hoja propia del pie (constante de módulo): useViewStyles la inyecta y el prerender la enlaza. */
const SHEETS: readonly string[] = [footerCss];

/** Centro de ayuda público (módulo help). */
const HELP_PATH = '/ayuda';

/**
 * Pie global de Uonify (D-HOME-REORG-20261109, requisito del dueño del 09-11-2026): el MISMO
 * en todas las páginas —portada, interiores, Ayuda, centro legal y el espacio con sesión— y
 * nunca se oculta. A la izquierda, Partners y Clientes; a la derecha, «Términos y
 * condiciones» (el centro legal con pestañas), el globo «Idioma» (menú «Idioma y
 * accesibilidad») y «Ayuda». Sin variantes por página ni marca de página actual: su marcado
 * es idéntico en todas. Trae su hoja (styles/site-footer.css) y no depende de las de las
 * vistas, así lo puede montar el espacio (se exporta en el index del módulo).
 * Sin JS (HTML prerenderizado, que la puerta sirve en /terminos y /privacidad), el globo es
 * una etiqueta fija con el idioma; con JS, el menú completo. Una sola instancia por página.
 */
export function SiteFooter() {
  useViewStyles('site-footer', SHEETS);
  const interactive = useHydrated();
  const { locale } = useTranslation();
  return (
    <footer className="site-footer uon-token-scope">
      <nav className="site-footer__nav" aria-label="Partners y clientes">
        <Link className="site-footer__link" to={PATHS.partners}>Partners</Link>
        <Link className="site-footer__link" to={PATHS.clientes}>Clientes</Link>
      </nav>
      <nav className="site-footer__nav" aria-label="Legal, idioma y ayuda">
        <Link className="site-footer__link" to={PATHS.terminos}>Términos y condiciones</Link>
        {interactive ? <GlobeMenu /> : (
          <span className="site-footer__language site-footer__language--fixed">
            <Icon name="globe" size={16} className="site-footer__icon" />
            <span className="sr-only">Idioma: </span>
            <span lang={locale}>{LOCALE_LABELS[locale]}</span>
          </span>
        )}
        <Link className="site-footer__link" to={HELP_PATH}>Ayuda</Link>
      </nav>
    </footer>
  );
}
