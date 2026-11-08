import { useComposerStore } from '../hooks/composerStore';
import { useUiStore } from '../hooks/uiStore';
import { useWorkspaceStore } from '../hooks/workspaceStore';
import { conversationFormDraftKey, readConversationFormDraft, writeConversationFormDraft } from '../hooks/conversationFormDrafts';

test('la salida de una cuenta retira conversación, adjuntos y respuestas privadas del espacio', () => {
  const thread = useWorkspaceStore.getState().createThread({ title: 'Privado', service: 'producto', view: 'list' });
  useWorkspaceStore.getState().pushMessage(thread.id, { role: 'user', text: 'Información privada' });
  useComposerStore.setState({ draft: 'Respuesta privada', attachments: [new File(['private'], 'private.txt')], status: 'Privado', usageOpen: true, listening: 'talk' });
  useUiStore.setState({ pendingReply: { threadId: thread.id, label: 'Privado' }, sheetTitle: 'Producto privado', liveText: 'Dato privado' });
  const key = conversationFormDraftKey('owner@example.test', thread.id, 'form');
  writeConversationFormDraft(key, { values: { weight: '1' }, customFieldIds: [], step: 0, open: true });
  window.dispatchEvent(new CustomEvent('uonify:identity-changed', { detail: { email: null } }));
  expect(useWorkspaceStore.getState().threads).toEqual([]);
  expect(useComposerStore.getState()).toMatchObject({ draft: '', attachments: [], status: '', usageOpen: false, listening: null });
  expect(useUiStore.getState()).toMatchObject({ pendingReply: null, sheetTitle: null, liveText: '' });
  expect(readConversationFormDraft(key)).toBeUndefined();
});
