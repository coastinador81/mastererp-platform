/**
 * Apartado de Finanzas sin registros en la empresa elegida: estado vacío limpio, con
 * la misma cabecera que las fichas del ERP. No muestra datos de ejemplo.
 */
export function EmptyApartado({ label, onClose }: { label: string; onClose: (detail: number) => void }) {
  return (
    <div className="product-editor-layout erp-sheet" role="region" aria-label={label}>
      <header className="product-center-header">
        <div className="product-source-header-summary">
          <div className="product-center-title">
            <h1>{label}</h1>
            <p>Aún no hay {label.toLowerCase()} en esta empresa.</p>
          </div>
        </div>
      </header>
      <div>
        <button type="button" className="secondary-action" onClick={event => onClose(event.detail)}>Volver a la conversación</button>
      </div>
    </div>
  );
}
