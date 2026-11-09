import { forwardRef } from 'react';
import { SiteLink } from '../common/SiteLink';
import { SERVICE_CATALOG, type CatalogServiceId } from '@/modules/workspace/model/services';

/**
 * Destino comercial de cada servicio activo en la Home. Los «Próximamente» se
 * muestran deshabilitados, sin enlace. La lista, el orden, los nombres, los
 * iconos y los estados salen de SERVICE_CATALOG (fuente única que comparte con el
 * lanzador del espacio).
 */
const HOME_LINKS: Partial<Record<CatalogServiceId, string>> = {
  producto: '/productos#catalogo',
  estudio: '/productos',
  erp: '/espacio?service=erp',
  nexus: '/espacio?service=nexus',
};

/** Panel de herramientas de la portada (#tools-panel). */
export const ToolsPanel = forwardRef<HTMLElement, { open: boolean }>(function ToolsPanel({ open }, ref) {
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
          const to = entry.status === 'active' ? HOME_LINKS[entry.id] : undefined;
          return to
            ? <SiteLink key={entry.id} className="tool-entry" to={to}>{content}</SiteLink>
            : (
              <button key={entry.id} className="tool-entry is-coming" type="button" disabled aria-disabled="true" title="Próximamente">
                {content}
                <small className="coming-tag">Próximamente</small>
              </button>
            );
        })}
      </nav>
    </section>
  );
});
