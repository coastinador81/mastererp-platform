/**
 * Contrato de la ayuda con el backend (bajo API_BASE). Simulación: mocks/.
 *
 * Centro de ayuda (/help/*) — admin usa las rutas de escritura:
 *   GET    /help/config                        → HelpConfig
 *   PUT    /help/config                        → HelpConfig (admin; 400 con motivo)
 *   GET    /help/collections                   → HelpCollection[] (con articleCount)
 *   GET    /help/articles?collection=&sort=popular&limit=&status=all
 *                                              → HelpArticleSummary[] (status=all incluye borradores, para admin)
 *   GET    /help/articles/:slug?preview=1      → HelpArticle (404 si no existe o no está publicado)
 *   POST   /help/articles                      → 201 HelpArticle (admin; 400, 409 slug repetido)
 *   PUT    /help/articles/:slug                → HelpArticle (admin; puede cambiar el slug; 404, 409)
 *   DELETE /help/articles/:slug                → 204 (admin; 404)
 *   GET    /help/search?q=&limit=              → SearchResponse (registra las búsquedas sin resultados)
 *   GET    /help/search/misses                 → [{ query, count, lastAt }] (admin)
 *   POST   /help/articles/:slug/feedback       → { helpful, notHelpful } · body { helpful, comment? }
 *
 * Soporte (/support/*) — la sesión va en la cookie:
 *   POST   /support/assistant/messages         → flujo NDJSON de AssistantEvent · body AssistantRequest
 *   GET    /support/tickets?scope=all          → TicketSummary[] (scope=all: todos, para admin)
 *   POST   /support/tickets                    → 201 Ticket · cabecera Idempotency-Key · body TicketInput
 *   GET    /support/tickets/:id                → Ticket (marca como leída la respuesta)
 *   POST   /support/tickets/:id/messages       → Ticket · body { body, author?: 'team' (admin) }
 *   POST   /support/tickets/:id/close          → Ticket
 *   GET    /support/videocall/slots            → SlotsResponse (según /help/config)
 *   GET    /support/bookings?scope=all         → Booking[]
 *   POST   /support/bookings                   → 201 Booking pendiente de pago · Idempotency-Key · 409 hueco ocupado
 *   POST   /support/bookings/:id/pay           → Booking confirmada con meetUrl (producción: pago con Stripe)
 *   POST   /support/bookings/:id/cancel        → Booking cancelada (409 fuera de plazo)
 *
 * Errores: { error, message } con el mensaje en español para la persona.
 */
export const HELP_PATHS = {
  config: '/help/config',
  collections: '/help/collections',
  articles: '/help/articles',
  article: (slug: string) => `/help/articles/${encodeURIComponent(slug)}`,
  feedback: (slug: string) => `/help/articles/${encodeURIComponent(slug)}/feedback`,
  search: '/help/search',
  searchMisses: '/help/search/misses',
} as const;

export const SUPPORT_PATHS = {
  assistant: '/support/assistant/messages',
  tickets: '/support/tickets',
  ticket: (id: string) => `/support/tickets/${encodeURIComponent(id)}`,
  ticketMessages: (id: string) => `/support/tickets/${encodeURIComponent(id)}/messages`,
  ticketClose: (id: string) => `/support/tickets/${encodeURIComponent(id)}/close`,
  slots: '/support/videocall/slots',
  bookings: '/support/bookings',
  bookingPay: (id: string) => `/support/bookings/${encodeURIComponent(id)}/pay`,
  bookingCancel: (id: string) => `/support/bookings/${encodeURIComponent(id)}/cancel`,
} as const;
