/**
 * Simulación de Uony de soporte: POST /support/assistant/messages responde en un
 * flujo NDJSON (meta → delta… → done), con las reglas de model/assistant.
 */
import { http } from 'msw';
import { fail, HttpResponse, latency, mock } from '@/shared/mocks/utils';
import { SUPPORT_PATHS } from '../api/paths';
import { chunkText, replyTo } from '../model/assistant/compose';
import { trimTranscript } from '../model/tickets';
import type { AssistantEvent, AssistantRequest } from '../model/types';
import { publishedArticles } from './helpHandlers';
import { configDb, conversationsDb, type Conversation } from './store';

export const MESSAGE_MAX = 2000;

export const assistantHandler = http.post(mock(SUPPORT_PATHS.assistant), async ({ request }) => {
  await latency(250);
  if (!configDb.get().assistantEnabled) {
    return fail(503, 'Uony de soporte no está disponible ahora. Abre un ticket o escríbenos a hola@uonify.com.', 'assistant_disabled');
  }
  const body = (await request.json().catch(() => null)) as Partial<AssistantRequest> | null;
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message) return fail(400, 'Escribe tu pregunta.', 'invalid_message');
  if (message.length > MESSAGE_MAX) return fail(400, `El mensaje admite como máximo ${MESSAGE_MAX} caracteres.`, 'invalid_message');

  const existing = typeof body?.conversationId === 'string' ? conversationsDb.get(body.conversationId) : undefined;
  const conversation: Conversation = existing ?? {
    id: `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    misses: 0,
    lastQuestion: null,
    turns: [],
    updatedAt: new Date().toISOString(),
  };
  const reply = replyTo({
    message,
    misses: conversation.misses,
    lastQuestion: conversation.lastQuestion ?? undefined,
    articleSlug: typeof body?.context?.articleSlug === 'string' ? body.context.articleSlug : undefined,
    articles: publishedArticles(),
  });
  // Se guarda la conversación ya tachada (nunca el texto con datos sensibles).
  conversationsDb.upsert({
    ...conversation,
    misses: reply.misses,
    lastQuestion: reply.intent === 'question' ? reply.redactedMessage : conversation.lastQuestion,
    turns: trimTranscript([...conversation.turns, { role: 'user', text: reply.redactedMessage }, { role: 'uony', text: reply.text }]),
    updatedAt: new Date().toISOString(),
  });

  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AssistantEvent) => {
        if (!cancelled) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        send({ type: 'meta', conversationId: conversation.id, redactedMessage: reply.redactedMessage, redacted: reply.redacted, sources: reply.sources });
        await latency(500);
        for (const chunk of chunkText(reply.text)) {
          if (cancelled) return;
          send({ type: 'delta', text: chunk });
          await latency(40);
        }
        send({ type: 'done', handoff: reply.handoff, filtered: reply.filtered });
        if (!cancelled) controller.close();
      } catch {
        // La persona ha parado la respuesta: el flujo ya está cerrado.
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  return new HttpResponse(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
});
