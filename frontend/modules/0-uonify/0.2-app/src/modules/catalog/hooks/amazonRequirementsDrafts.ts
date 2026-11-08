export interface RequirementsDraft {
  revision: number;
  evaluationId: string;
  answers: Record<string, string>;
  attribute?: string;
  previousAnswers?: string[];
}
const drafts = new Map<string, RequirementsDraft>();
export const requirementsDraftKey = (account: string, sku: string) => JSON.stringify([account, sku]);
export function readRequirementsDraft(key: string) {
  const draft = drafts.get(key);
  return draft ? { ...draft, answers: { ...draft.answers } } : null;
}
export function writeRequirementsDraft(key: string, draft: RequirementsDraft | null) {
  drafts.delete(key);
  if (draft) drafts.set(key, { ...draft, answers: { ...draft.answers } });
  if (drafts.size > 128) drafts.delete(drafts.keys().next().value!);
}
export function clearRequirementsDrafts() { drafts.clear(); }
if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', clearRequirementsDrafts);
