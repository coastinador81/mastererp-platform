/**
 * Campana de notificaciones de la cabecera del espacio: facturas, límite de ChatGPT,
 * caducidad de la autorización de Amazon, vídeos y modelos 3D listos, respuestas de
 * soporte y cobros fallidos. Contrato: docs/FRONTEND-FASE-2.md y api/notifications.ts.
 *
 *   <NotificationsBell />        campana con contador, lista y marcar como leídas
 *   NOTIFICATIONS_QUERY_KEY      para invalidar la lista tras una acción que genere un aviso
 */
export { NotificationsBell, type NotificationsBellProps } from './components/NotificationsBell';
export { NOTIFICATIONS_QUERY_KEY } from './hooks/useNotifications';
export type { AppNotification, NotificationType } from './model/types';
