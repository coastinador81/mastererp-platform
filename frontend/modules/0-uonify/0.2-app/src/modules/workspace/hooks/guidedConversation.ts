import { guideOf, handleGuideText, pauseGuide, productPath, startsGuide } from '@/modules/catalog';
import { postAssistantMessage } from '../api/assistant';
import { emitAssistantReply } from '../model/events';
import { isUsageLimitError } from '../model/aiLimit';
import { pendingLabel } from '../model/pendingLabel';
import type { Thread } from '../model/workspaceState';
import { getAiPreferences, useComposerStore } from './composerStore';
import { navigateTo } from './actions';
import { markLimitReached, openLimitDialog, setUsageSnapshot } from './limitActions';
import { announce, setUi, useUiStore } from './uiStore';
import { useWorkspaceStore } from './workspaceStore';

export const isGuidedMessage = (threadId: string, text: string) => Boolean(guideOf(threadId)) || startsGuide(text);
export function openGuidedProduct(threadId: string, sku: string): void {
  useWorkspaceStore.getState().updateThread(threadId, { service: 'producto', view: `sku:${sku}` });
  useWorkspaceStore.getState().setChatPanelCollapsed(false);
  navigateTo(productPath({ sku }));
}
export function pauseGuidedWork(threadId: string): void {
  pauseGuide(threadId);
  announce('Preparación pausada. Tu borrador está guardado.');
}
export async function sendGuidedMessage(thread: Thread, text: string): Promise<void> {
  const label = pendingLabel(text, guideOf(thread.id)?.step);
  setUi({ pendingReply: { threadId: thread.id, label } });
  announce(label);
  // Antesala breve, en paralelo con la petición; una red lenta no suma otra espera.
  const visible = new Promise<void>(resolve => setTimeout(resolve, 700));
  try {
    const result = await postAssistantMessage({ threadId: thread.id, service: thread.service, text, ...getAiPreferences() });
    if (!useWorkspaceStore.getState().threads.some(item => item.id === thread.id)) return;
    if (result?.usage) setUsageSnapshot(result.usage);
    const reply = await handleGuideText(thread.id, text);
    await visible;
    const store = useWorkspaceStore.getState();
    if (!reply.text || !store.threads.some(item => item.id === thread.id)) return;
    store.pushMessage(thread.id, { role: 'assistant', text: reply.text });
    if (store.activeThreadId === thread.id) {
      if (reply.openProduct && guideOf(thread.id)?.sku) openGuidedProduct(thread.id, guideOf(thread.id)!.sku!);
      announce(`Uony: ${reply.text}`);
      emitAssistantReply(reply.text, { threadId: thread.id, spoken: reply.spoken });
    }
  } catch (error) {
    await visible;
    if (isUsageLimitError(error)) {
      markLimitReached();
      useWorkspaceStore.getState().withdrawLastMessage(thread.id);
      useComposerStore.getState().setDraft(text);
      openLimitDialog('rejected');
    } else {
      const reply = 'No he podido completar este paso. Tus datos se conservan; vuelve a intentarlo.';
      useWorkspaceStore.getState().pushMessage(thread.id, { role: 'assistant', text: reply });
      if (useWorkspaceStore.getState().activeThreadId === thread.id) announce(`Uony: ${reply}`);
      emitAssistantReply(reply, { threadId: thread.id });
    }
  } finally {
    if (useUiStore.getState().pendingReply?.threadId === thread.id) setUi({ pendingReply: null });
  }
}
