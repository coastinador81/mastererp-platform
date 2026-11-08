/**
 * Aviso de «Uony ha respondido» (en el PROTO, el evento `uonify:assistant-reply`):
 * el modo «Hablar con Uony» lo escucha para leer la respuesta en voz alta cuando
 * llega, después de su breve «Revisando tu petición…».
 * `requestId` solo lo aporta la entrega durable: correlaciona la respuesta con
 * su handoff y con la narración verificada de la voz en directo.
 */
export interface ReplyOptions { threadId?: string; spoken?: string; requestId?: string }
type ReplyListener = (text: string, options?: ReplyOptions) => void;
const listeners = new Set<ReplyListener>();

export function onAssistantReply(listener: ReplyListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitAssistantReply(text: string, options?: ReplyOptions): void {
  [...listeners].forEach(listener => listener(text, options));
}
