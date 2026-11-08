import { Icon, Progress } from '@/shared/ui';
import type { AmazonModel } from '../model/amazon';

/**
 * Indicadores del resultado (Completado, Amazon Readiness, Score General) en tinta: el
 * producto no define umbrales, así que el color no los califica. Barra y contadores.
 */
export function AmazonSummary({ model }: { model: AmazonModel }) {
  const stat = (label: string, value: string | number) => (
    <div className="pim-auditoria-stat">
      <span className="pim-auditoria-stat-label">{label}</span>
      <span className="pim-auditoria-stat-value">{value}%</span>
    </div>
  );
  return (
    <div className="pim-auditoria-summary" data-region="amazon-summary">
      <div className="pim-auditoria-stats">
        {stat('Completado', model.completionPercentage)}
        {stat('Amazon Readiness', model.readiness)}
        {stat('Score General', model.overall)}
      </div>
      <Progress value={model.completionPercentage} label="Completado" className="pim-auditoria-bar" />
      <div className="pim-meta pim-auditoria-counters">
        <span className="pim-auditoria-count pim-auditoria--green">
          <Icon name="check-circle-2" size={14} />{model.mappedCount} mapeados
        </span>
        <span className="pim-auditoria-count pim-auditoria--red">
          <Icon name="x-circle" size={14} />{model.missingRequired.length} faltantes
        </span>
        <span className="pim-auditoria-count pim-auditoria--amber">
          <Icon name="alert-circle" size={14} />{model.missingOptional.length} opcionales
        </span>
      </div>
    </div>
  );
}
