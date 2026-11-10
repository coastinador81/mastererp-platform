import { forwardRef } from 'react';
import { SERVICE_CATALOG, type CatalogServiceId } from '@/modules/workspace';
import { startAccess, usePublicSession } from '../../hooks/usePublicSession';
import { SiteLink } from '../common/SiteLink';

/**
 * Destino de cada servicio en la Home: abre su servicio en el espacio (el Estudio, que
 * vive en la conversación, abre el chat). La lista, el orden, los nombres, los iconos
 * y los estados salen de SERVICE_CATALOG, la fuente única que comparte con el lanzador
 * del espacio. Si un servicio vuelve a ser «Próximamente», se pinta deshabilitado, sin
 * enlace y con su etiqueta.
 */
const homeLink = (id: CatalogServiceId) => (id === 'estudio' ? '/espacio' : `/espacio?service=${id}`);

/**
 * Panel de herramientas de la portada y de las interiores (#tools-panel). Con sesión, cada
 * servicio enlaza a su vista del espacio. Sin sesión (orden del dueño, 10-11-2026), cada
 * servicio abre «Iniciar sesión» y, al entrar, el espacio abre ese servicio.
 */
export const ToolsPanel = forwardRef<HTMLElement, { open: boolean; onChoose?: () => void }>(function ToolsPanel({ open, onChoose }, ref) {
  const { signedIn } = usePublicSession();
  return (
    <section ref={ref} id="tools-panel" className="tools-panel" aria-labelledby="tools-heading" hidden={!open}>
      <div className="tools-heading">
        <h2 id="tools-heading">Tu espacio Uonify</h2>
        <SiteLink className="tools-know" to="/productos">Conocer Uonify <span aria-hidden="true">↗</span></SiteLink>
      </div>
      <nav className="tools-grid" aria-label="Herramientas">
        {SERVICE_CATALOG.map(entry => {
          const content = (
            <>
              <img className="product-icon" src={entry.iconSrc} width="72" height="72" alt="" />
              <span>{entry.name}</span>
            </>
          );
          if (entry.status !== 'active') return (
            <button key={entry.id} className="tool-entry is-coming" type="button" disabled aria-disabled="true" title="Próximamente">
              {content}
              <small className="coming-tag">Próximamente</small>
            </button>
          );
          if (signedIn) return <SiteLink key={entry.id} className="tool-entry" to={homeLink(entry.id)} onClick={onChoose}>{content}</SiteLink>;
          return (
            <button
              key={entry.id}
              className="tool-entry"
              type="button"
              title={`Inicia sesión para abrir ${entry.name}`}
              onClick={() => {
                onChoose?.();
                startAccess(undefined, entry.id === 'estudio' ? {} : { service: entry.id });
              }}
            >
              {content}
            </button>
          );
        })}
      </nav>
    </section>
  );
});
