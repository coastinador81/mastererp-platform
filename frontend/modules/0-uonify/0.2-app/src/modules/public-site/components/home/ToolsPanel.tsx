import { forwardRef } from 'react';
import { SiteLink } from '../common/SiteLink';

/** Herramientas del panel «Tu espacio Uonify» (sin `to`: aún no disponibles). */
export const TOOL_ENTRIES: ReadonlyArray<{ label: string; icon: string; to?: string }> = [
  { label: 'ERP', icon: 'erp', to: '/espacio?service=erp' },
  { label: 'Catálogo', icon: 'catalogo', to: '/productos#catalogo' },
  { label: 'Analítica', icon: 'analitica', to: '/productos#ventas' },
  { label: 'Captura y auditoría', icon: 'auditoria', to: '/espacio?service=auditoria' },
  { label: 'Agentes', icon: 'hive', to: '/espacio?service=agentes' },
  { label: 'Academy', icon: 'academy' },
  { label: 'Logística', icon: 'logistica' },
  { label: 'Fábrica y proveedores', icon: 'fabrica', to: '/productos#proveedores' },
  { label: 'Nexus', icon: 'nexus', to: '/espacio?service=nexus' },
];

/** Panel de herramientas de la portada (#tools-panel). */
export const ToolsPanel = forwardRef<HTMLElement, { open: boolean }>(function ToolsPanel({ open }, ref) {
  return (
    <section ref={ref} id="tools-panel" className="tools-panel" aria-labelledby="tools-heading" hidden={!open}>
      <div className="tools-heading"><h2 id="tools-heading">Tu espacio Uonify</h2></div>
      <nav className="tools-grid" aria-label="Herramientas">
        {TOOL_ENTRIES.map(tool => {
          const content = (
            <>
              <img className="product-icon" src={`/assets/product-icons/${tool.icon}.png`} width="72" height="72" alt="" />
              <span>{tool.label}</span>
            </>
          );
          return tool.to
            ? <SiteLink key={tool.label} className="tool-entry" to={tool.to}>{content}</SiteLink>
            : <button key={tool.label} className="tool-entry" type="button" aria-disabled="true">{content}</button>;
        })}
      </nav>
    </section>
  );
});
