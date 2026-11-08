import type { ConversationField } from '../model/conversationForm';
import { customerLocation } from '@/shared/lib/customerText';

/** Citas de la pregunta actual: texto de la fuente, nunca HTML ni enlaces ejecutables. */
export function ConversationResourceEvidence({ evidence }: { evidence: NonNullable<ConversationField['resourceEvidence']> }) {
  return <div className="uony-question-resources">
    <p>Tu respuesta se aplicará a todos los recursos enumerados en esta lista.</p>
    <details><summary>Ver recursos y citas · {new Intl.NumberFormat('es-ES').format(evidence.length)}</summary>
      <ol>{evidence.map((entry, index) => <li key={index}>
        <strong>{entry.sourceName}</strong>{customerLocation(entry.locator) && <small>{customerLocation(entry.locator)}</small>}
        <blockquote>{entry.excerpt}</blockquote>
      </li>)}</ol>
    </details>
  </div>;
}
