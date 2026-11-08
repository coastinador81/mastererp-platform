import type { IconName } from '@/shared/ui';
import type { NotificationTone, NotificationType } from './types';

/** Aspecto de cada tipo de notificación: icono, tono y nombre para lectores de pantalla. */
export interface NotificationTypeMeta {
  icon: IconName;
  tone: NotificationTone;
  /** Categoría leída antes del título («Factura», «Pago»…). */
  label: string;
}

export const NOTIFICATION_TYPES: Record<NotificationType, NotificationTypeMeta> = {
  invoice_issued: { icon: 'ntf-receipt', tone: 'info', label: 'Factura' },
  chatgpt_limit_near: { icon: 'ntf-gauge', tone: 'warning', label: 'Límite de ChatGPT' },
  chatgpt_limit_reached: { icon: 'ntf-gauge', tone: 'error', label: 'Límite de ChatGPT' },
  amazon_auth_expiring: { icon: 'ntf-key', tone: 'warning', label: 'Amazon' },
  video_ready: { icon: 'video', tone: 'success', label: 'Vídeo' },
  model3d_ready: { icon: 'package', tone: 'success', label: 'Modelo 3D' },
  support_replied: { icon: 'ntf-message', tone: 'info', label: 'Soporte' },
  payment_failed: { icon: 'ntf-credit-card', tone: 'error', label: 'Pago' },
  announcement: { icon: 'megaphone', tone: 'info', label: 'Uonify' },
};

export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(NOTIFICATION_TYPES, value);
}

/** Aspecto de un tipo; uno desconocido (el backend va por delante) se pinta como aviso de Uonify. */
export function notificationMeta(type: string): NotificationTypeMeta {
  return isNotificationType(type) ? NOTIFICATION_TYPES[type] : NOTIFICATION_TYPES.announcement;
}
