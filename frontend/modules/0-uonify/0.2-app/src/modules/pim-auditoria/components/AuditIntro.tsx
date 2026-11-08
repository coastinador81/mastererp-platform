import { useId } from 'react';
import { Icon } from '@/shared/ui';
import { STEPS } from '../model/schemas';

/**
 * Instrucciones (E03): estado vacío sobre tarjeta discontinua, con el título, el icono
 * de cerebro en gris y los cuatro pasos literales del original.
 */
export function AuditIntro() {
  const titleId = useId();
  return (
    <section className="pim-card pim-card-dashed pim-empty pim-auditoria-intro" data-region="intro" aria-labelledby={titleId}>
      <Icon name="brain" size={32} />
      <h3 className="pim-auditoria-intro-title" id={titleId}>Auditoría IA Inteligente</h3>
      <ol className="pim-auditoria-intro-steps" role="list">
        {STEPS.map(([name, text], index) => (
          <li key={name}>
            <span className="pim-auditoria-intro-n">{index + 1}.</span> <strong>{name}</strong> - {text}
          </li>
        ))}
      </ol>
    </section>
  );
}
