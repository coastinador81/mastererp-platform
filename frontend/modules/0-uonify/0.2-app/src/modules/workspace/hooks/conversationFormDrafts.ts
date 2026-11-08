/** Borradores de la sesión abierta: nunca se escriben en almacenamiento del navegador. */
export interface ConversationFormDraft {
  values: Record<string, string>;
  customFieldIds: string[];
  step: number;
  open: boolean;
}
const drafts = new Map<string, ConversationFormDraft>();
const copy = (draft: ConversationFormDraft): ConversationFormDraft => ({ ...draft, values: { ...draft.values }, customFieldIds: [...draft.customFieldIds] });
export const conversationFormDraftKey = (account: string, threadId: string, formId: string) => JSON.stringify([account, threadId, formId]);
export const readConversationFormDraft = (key: string) => drafts.has(key) ? copy(drafts.get(key)!) : undefined;
export function writeConversationFormDraft(key: string, draft: ConversationFormDraft) {
  drafts.delete(key);
  drafts.set(key, copy(draft));
  if (drafts.size > 256) drafts.delete(drafts.keys().next().value!);
}
export function clearConversationFormDrafts() { drafts.clear(); }
if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', clearConversationFormDrafts);
