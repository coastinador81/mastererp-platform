import type { PimTabKey } from '@/shared/pim';

export interface PreparationDraft { revision: number; answers: Record<string, string>; previousAnswers?: string[] }
export type PreparationDrafts = Partial<Record<PimTabKey, PreparationDraft>>;
const drafts = new Map<string, PreparationDrafts>();
const copy = (value: PreparationDrafts): PreparationDrafts => Object.fromEntries(Object.entries(value).map(([section, draft]) => [section, { ...draft, answers: { ...draft.answers }, previousAnswers: [...(draft.previousAnswers ?? [])] }]));
export const preparationDraftKey = (account: string, sku: string) => JSON.stringify([account, sku]);
export const readPreparationDrafts = (key: string) => copy(drafts.get(key) ?? {});
export function writePreparationDrafts(key: string, value: PreparationDrafts) {
  drafts.delete(key);
  drafts.set(key, copy(value));
  if (drafts.size > 128) drafts.delete(drafts.keys().next().value!);
}
export function clearPreparationDrafts() { drafts.clear(); }
if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', clearPreparationDrafts);
