/**
 * Tipos de la campana de notificaciones (contrato con el backend, simulado en
 * mocks/handlers.ts). Las fechas viajan en ISO 8601 y `href` es una ruta interna
 * de la aplicación (p. ej. «/espacio/configuracion/plan»).
 */
export type NotificationType =
  | 'invoice_issued'
  | 'chatgpt_limit_near'
  | 'chatgpt_limit_reached'
  | 'amazon_auth_expiring'
  | 'video_ready'
  | 'model3d_ready'
  | 'support_replied'
  | 'payment_failed'
  | 'announcement';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Cuándo se generó (ISO). */
  createdAt: string;
  /** Cuándo se leyó (ISO) o null si sigue sin leer. */
  readAt: string | null;
  /** Ruta interna a la que lleva; null si no lleva a ningún sitio. */
  href: string | null;
}

/** GET /notifications → las más recientes y el total sin leer (puede haber más que las listadas). */
export interface NotificationsPage {
  items: AppNotification[];
  unread: number;
}

/** POST /notifications/:id/read */
export interface MarkReadResponse {
  id: string;
  readAt: string;
  unread: number;
}

/** POST /notifications/read-all */
export interface MarkAllReadResponse {
  updated: number;
  readAt: string;
  unread: number;
}

/** Tono semántico del icono: solo comunica estado (azul, verde, ámbar o rojo). */
export type NotificationTone = 'info' | 'success' | 'warning' | 'error';
