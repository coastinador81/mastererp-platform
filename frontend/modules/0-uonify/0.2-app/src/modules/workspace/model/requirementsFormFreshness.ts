import type { AmazonRequirements } from '@/modules/catalog';
import { conversationFormOf, type ConversationFormData } from './conversationForm';

/** La identidad de evaluación no incluye las fuentes: también cuenta su revisión vigente. */
export function requirementsFormIsCurrent(form: ConversationFormData, result: AmazonRequirements): boolean {
  const context = form.context;
  const { product, evaluation } = result;
  if (context?.kind !== 'product_guide' || context.section !== 'amazon_requirements' || context.step !== 'fields'
    || product.sku !== context.sku || product.revision !== context.revision
    || evaluation.state !== 'needs_input' || !context.evaluationId || evaluation.evaluationId !== context.evaluationId
    || (evaluation.reasoning && (evaluation.reasoning.status !== 'completed'
      || evaluation.reasoning.requiresPreparation || evaluation.reasoning.materialsPending))) return false;
  // fields es el grupo actual; counts.questions incluye también los grupos siguientes.
  const saved = conversationFormOf(form, 'assistant');
  const current = conversationFormOf({ ...form, fields: evaluation.fields }, 'assistant');
  return !!saved && !!current && JSON.stringify(saved.fields) === JSON.stringify(current.fields);
}
