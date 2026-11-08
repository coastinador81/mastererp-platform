import { Icon, Progress } from '@/shared/ui';
import { useAuditStore } from '../hooks/useAuditStore';

/** «Progreso de Validación - categoría»: %, barra y contadores (válidos, revisar, faltantes). */
export function SchemaSummary({ titleId }: { titleId: string }) {
  const { audit } = useAuditStore();
  const count = (status: string) => Object.values(audit.fieldValidations).filter(value => value === status).length;
  return (
    <>
      <div className="pim-section-head">
        <h3 className="pim-section-title" id={titleId}>
          <Icon name="database" size={16} />
          <span>Progreso de Validación - {audit.selectedCategory}</span>
        </h3>
        <span className="pim-auditoria-pct-inline">{audit.completionProgress}% Completado</span>
      </div>
      <Progress value={audit.completionProgress} label="Progreso de Validación" className="pim-auditoria-bar" />
      <div className="pim-meta pim-auditoria-counters">
        <span className="pim-auditoria-count pim-auditoria--green">
          <Icon name="check-circle-2" size={14} />{count('valid')} válidos
        </span>
        <span className="pim-auditoria-count pim-auditoria--amber">
          <Icon name="clock" size={14} />{count('review')} revisar
        </span>
        <span className="pim-auditoria-count pim-auditoria--red">
          <Icon name="x-circle" size={14} />{audit.missingFields.length} faltantes
        </span>
      </div>
    </>
  );
}
