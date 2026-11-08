import { activeRequirementsProgressIndex } from '../model/requirementsConversation';
import type { ChatMessage } from '../model/workspaceState';
import type { ConversationFormData } from '../model/conversationForm';

const waiting: ConversationFormData = { id: 'waiting', title: 'Revisar datos', fields: [], context: {
  kind: 'product_guide', sku: 'A', revision: 1, section: 'amazon_requirements', step: 'reasoning' },
  reasoning: { id: 'job-a', status: 'running', message: 'Comprobando documentos.' } };
const progress: ChatMessage = { role: 'assistant', text: 'Comprobando documentos.', model: 'uonify-guide', conversationForm: waiting };
const changes = (sku: string) => [{ previousSku: sku, product: { sku, name: sku } }];
it('la charla posterior no consume ni sustituye la operación vigente', () => {
  expect(activeRequirementsProgressIndex([progress, { role: 'user', text: 'Otra pregunta' }, { role: 'assistant', text: 'Respuesta', model: 'gemini' }])).toBe(0);
});
it('un formulario posterior de otro producto deja un único seguimiento vigente', () => {
  const second: ChatMessage = { ...progress, conversationForm: { ...waiting, id: 'next', context: { ...waiting.context!, sku: 'B' } as ConversationFormData['context'] } };
  expect(activeRequirementsProgressIndex([progress, second])).toBe(1);
});
it('las preguntas vigentes reemplazan el progreso de revisión', () => {
  const question: ChatMessage = { ...progress, conversationForm: { id: 'question', title: 'Completar datos', context: {
    kind: 'product_guide', sku: 'A', revision: 1, section: 'amazon_requirements', step: 'fields', evaluationId: 'evaluation' },
    fields: [{ id: 'weight', label: 'Peso', type: 'text', required: true }] } };
  expect(activeRequirementsProgressIndex([progress, question])).toBe(-1);
});
it('la referencia terminal debe corresponder al producto del seguimiento y proceder de una guía', () => {
  expect(activeRequirementsProgressIndex([progress, { role: 'assistant', text: 'Guardado', model: 'uonify-guide', productChanges: changes('B') }])).toBe(0);
  expect(activeRequirementsProgressIndex([progress, { role: 'assistant', text: 'Guardado', model: 'gemini', productChanges: changes('A') }])).toBe(0);
  expect(activeRequirementsProgressIndex([progress, { role: 'assistant', text: 'Guardado', model: 'uonify-guide', productChanges: changes('A') }])).toBe(-1);
});
