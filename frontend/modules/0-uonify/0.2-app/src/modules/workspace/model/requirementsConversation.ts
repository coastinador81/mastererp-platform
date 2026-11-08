import { conversationFormOf, isRequirementsProgress } from './conversationForm';
import type { ChatMessage } from './workspaceState';

/** El seguimiento pertenece a la última operación de producto, aunque después haya charla. */
export function activeRequirementsProgressIndex(messages: ChatMessage[]): number {
  let current = -1;
  for (let index = 0; index < messages.length; index += 1) {
    const entry = messages[index];
    if (entry.role !== 'assistant') continue;
    const form = conversationFormOf(entry.conversationForm, entry.role);
    if (form?.context && ['product_guide', 'drive_analysis', 'product_incident'].includes(form.context.kind)) {
      current = isRequirementsProgress(form) ? index : -1;
    } else if (current >= 0 && entry.model === 'uonify-guide' && !form) {
      const context = messages[current].conversationForm?.context;
      if (context?.kind === 'product_guide' && entry.productChanges?.some(change => change.product.sku === context.sku)) current = -1;
    }
  }
  return current;
}
