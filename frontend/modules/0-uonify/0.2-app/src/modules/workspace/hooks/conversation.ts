import { USE_MOCKS } from '@/shared/api/config';
import { sendLivePrompt } from './liveConversation';
import { isGuidedMessage, sendGuidedMessage } from './guidedConversation';
import { postAssistantMessage } from '../api/assistant';
import { isUsageLimitError } from '../model/aiLimit';
import { emitAssistantReply } from '../model/events';
import { reduceMotion } from '../model/motion';
import { pendingLabel } from '../model/pendingLabel';
import { resolveReply, routePrompt, wantsChatOnly } from '../model/routePrompt';
import { NEW_PRODUCT_VIEW, SERVICES, servicePath } from '../model/services';
import type { Thread } from '../model/workspaceState';
import { navigateTo, returnToChat } from './actions';
import { getAiPreferences, useComposerStore } from './composerStore';
import { limitBlocksSending, markLimitReached, openLimitDialog, setUsageSnapshot, USAGE_QUERY_KEY } from './limitActions';
import { announce, setUi, useUiStore } from './uiStore';
import { activeThreadOf, useWorkspaceStore } from './workspaceStore';

/**
 * Motor de la conversación (app-shell.js, `sendPrompt`). La respuesta nunca llega
 * de golpe: primero «Revisando tu petición…», después «Abriendo X…» cuando viene otra pantalla,
 * y solo entonces la respuesta y la pantalla. Una respuesta cada vez. Con el
 * backend de IA, esta antesala será la espera de la respuesta real.
 *
 * Límite del plan de ChatGPT: con el plan agotado (y sin elegir otra forma de pago),
 * no se envía nada: el texto se queda en el compositor y se abre el aviso. Si el
 * servidor rechaza el mensaje (429), se retira del hilo y el texto vuelve al compositor.
 */
export { USAGE_QUERY_KEY };

interface PendingSend {
  /** El servidor rechazó el mensaje por el límite del plan de ChatGPT. */
  limited: boolean;
  /** La respuesta ya se ha pintado. */
  finished: boolean;
}

/** Registra la petición en el backend y refresca el uso; si falla por otra causa, la conversación sigue. */
function recordMessage(thread: Thread, text: string, send: PendingSend): void {
  const ai = getAiPreferences();
  postAssistantMessage({ threadId: thread.id, service: thread.service, text, ...ai })
    .then(result => {
      if (result?.usage) setUsageSnapshot(result.usage);
    })
    .catch((error: unknown) => {
      if (!isUsageLimitError(error)) return; // El uso se actualizará en la próxima consulta.
      send.limited = true;
      markLimitReached();
      // Si la respuesta ya se pintó (red lenta), al menos se avisa y se deja elegir.
      if (send.finished) openLimitDialog('rejected');
      else withdraw(thread, text);
    });
}

/** Uony no llegó a recibir el mensaje: sale del hilo y el texto vuelve al compositor. */
function withdraw(thread: Thread, text: string): void {
  if (useUiStore.getState().pendingReply?.threadId === thread.id) setUi({ pendingReply: null });
  useWorkspaceStore.getState().withdrawLastMessage(thread.id);
  // Lo que se haya escrito mientras tanto no se pisa.
  const composer = useComposerStore.getState();
  if (!composer.draft.trim()) composer.setDraft(text);
  announce('Has llegado al límite de tu plan de ChatGPT. Tu mensaje no se ha enviado.');
  openLimitDialog('rejected');
}

/**
 * Nombre del producto guardado de la ficha abierta (PROTO: `selectedProduct()?.name`):
 * el que aporte el servicio (useWorkspaceUi().setSheetTitle) o el de la cabecera de
 * la ficha. Una ficha nueva es «tu nuevo producto».
 */
function sheetTitle(): string | null {
  const { route, sheetTitle: title } = useUiStore.getState();
  if (!route.hasSheet || route.view === NEW_PRODUCT_VIEW) return null;
  return title ?? (document.querySelector('[data-product-header-name]')?.textContent?.trim() || null);
}

export function sendPrompt(text: string, { immediate = false }: { immediate?: boolean } = {}): boolean {
  if (!USE_MOCKS) {
    const link = useComposerStore.getState().productLink;
    const store = useWorkspaceStore.getState();
    return sendLivePrompt(text, link && link.text === text && link.account === store.historyAccount
      && link.threadId === store.activeThreadId ? { productLink: link } : {});
  }
  // Cambiar la vista no requiere cuota de IA ni interrumpe una preparación en curso.
  if (wantsChatOnly(text)) {
    const store = useWorkspaceStore.getState();
    const thread = activeThreadOf(store);
    if (thread) store.pushMessage(thread.id, { role: 'user', text });
    useComposerStore.getState().setDraft('');
    returnToChat();
    const reply = 'Aquí tienes el chat. Conservamos la conversación y el borrador de tu producto.';
    if (thread) store.pushMessage(thread.id, { role: 'assistant', text: reply });
    announce(reply);
    emitAssistantReply(reply, thread ? { threadId: thread.id } : undefined);
    return true;
  }
  const ui = useUiStore.getState();
  if (ui.pendingReply) return false;
  if (limitBlocksSending()) {
    useComposerStore.getState().setDraft(text);
    openLimitDialog('send');
    return false;
  }
  const origin = { service: ui.route.service, view: ui.route.view };
  const route = routePrompt(text, origin.service);
  const ai = getAiPreferences();
  const store = useWorkspaceStore.getState();
  const thread = activeThreadOf(store) ?? store.createThread({ title: text, service: origin.service, view: origin.view });
  store.pushMessage(thread.id, { role: 'user', text, model: ai.model, effort: ai.effort, speed: ai.speed });
  store.setConversationExpanded(true);
  useComposerStore.getState().setDraft('');
  if (isGuidedMessage(thread.id, text)) {
    void sendGuidedMessage(thread, text);
    return true;
  }
  const send: PendingSend = { limited: false, finished: false };
  recordMessage(thread, text, send);
  const opensScreen = Boolean(route.service) && route.service !== origin.service;

  const finish = () => {
    if (send.limited) return; // Ya se retiró el mensaje y se abrió el aviso.
    send.finished = true;
    setUi({ pendingReply: null });
    const now = useUiStore.getState();
    const latest = useWorkspaceStore.getState();
    // Si la persona se fue a otro sitio, la respuesta espera en su hilo y no la trae de vuelta.
    const result = resolveReply({
      route,
      origin,
      current: { service: now.route.service, view: now.route.view },
      sameThread: latest.activeThreadId === thread.id,
      hasSheet: now.route.hasSheet,
      sheetTitle: sheetTitle(),
    });
    if (result.stayed) {
      latest.updateThread(thread.id, { service: result.service, view: result.view });
      if (result.navigate) navigateTo(servicePath(result.service, result.view));
    }
    latest.pushMessage(thread.id, { role: 'assistant', text: result.reply });
    announce(`Uony: ${result.reply}`);
    emitAssistantReply(result.reply);
  };

  // Una petición escrita antes de entrar llega enseguida: la bienvenida fue su antesala.
  if (immediate) {
    finish();
    return true;
  }
  const label = pendingLabel(text);
  setUi({ pendingReply: { threadId: thread.id, label } });
  announce(label);
  const quick = reduceMotion();
  if (!opensScreen) {
    setTimeout(finish, quick ? 150 : 700);
    return true;
  }
  setTimeout(() => {
    if (useUiStore.getState().pendingReply?.threadId !== thread.id || !route.service) return;
    const label = `Abriendo ${SERVICES[route.service].name}…`;
    setUi({ pendingReply: { threadId: thread.id, label } });
    announce(label);
  }, quick ? 0 : 500);
  setTimeout(finish, quick ? 200 : 950);
  return true;
}
