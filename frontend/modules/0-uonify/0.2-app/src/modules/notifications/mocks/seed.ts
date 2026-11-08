import { settingsPath } from '@/modules/settings';
import { formatDayMonth, startOfDay } from '../model/time';
import type { AppNotification } from '../model/types';

/**
 * Notificaciones de ejemplo de una cuenta con plan Básico, Amazon conectado hace
 * casi un año y el producto de ejemplo «Make It Possible» by Uonify. Las fechas son
 * relativas al momento de sembrar: siempre hay algo en «Hoy» y en «Anteriores», y
 * el modelo 3D llega 2 minutos después (así se ve el sondeo de la campana).
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const SAMPLE_SKU = 'UON-KIT-01';
/** Cuándo llega el modelo 3D tras sembrar la bandeja. */
export const DELAYED_ARRIVAL_MS = 2 * MINUTE;

const iso = (ms: number) => new Date(ms).toISOString();

/** Instante «hace `minutes`» sin salir de hoy aunque sea de madrugada (mantiene el orden). */
function todayAgo(now: number, minutes: number, maxMinutes: number): number {
  const elapsed = (now - startOfDay(now)) / MINUTE;
  const scale = Math.min(1, (elapsed * 0.9) / maxMinutes);
  return now - minutes * scale * MINUTE;
}

export function seedNotifications(now: number): AppNotification[] {
  const today = (minutes: number) => todayAgo(now, minutes, 190);
  const paymentAt = startOfDay(now) - 5 * HOUR - 20 * MINUTE; // ayer, 18:40
  const amazonAt = now - 2 * DAY - 3 * HOUR;
  const invoiceAt = now - 4 * DAY - 2 * HOUR;
  const limitAt = now - 9 * DAY - 6 * HOUR;
  const year = new Date(now).getFullYear();

  return [
    {
      id: 'ntf-video-ready-0412',
      type: 'video_ready',
      title: 'Tu vídeo está listo',
      body: '«Make It Possible · anuncio 16:9» (15 s) ya está en la biblioteca de Vídeo del producto.',
      createdAt: iso(today(14)),
      readAt: null,
      href: `/espacio/producto/${SAMPLE_SKU}/video`,
    },
    {
      id: 'ntf-support-10482',
      type: 'support_replied',
      title: 'Soporte ha respondido a tu consulta',
      body: 'Lucía, del equipo de Uonify, ha respondido a «No puedo conectar mi cuenta de Amazon» (ticket T-10482).',
      createdAt: iso(today(95)),
      readAt: null,
      href: `${settingsPath('ayuda')}?ticket=T-10482`,
    },
    {
      id: 'ntf-chatgpt-near-39',
      type: 'chatgpt_limit_near',
      title: 'Te queda poco del límite semanal de ChatGPT',
      body: 'Has usado el 85 % del límite semanal de tu plan de ChatGPT. Se renueva el lunes a las 3:00.',
      createdAt: iso(today(190)),
      readAt: null,
      href: settingsPath('uso'),
    },
    {
      id: 'ntf-payment-failed-2027',
      type: 'payment_failed',
      title: 'No hemos podido renovar tu plan Básico',
      body: `Tu banco ha rechazado el cobro de 711,48 € de la renovación anual. Actualiza el método de pago antes del ${formatDayMonth(paymentAt + 7 * DAY)} para mantener tu plan.`,
      createdAt: iso(paymentAt),
      readAt: null,
      href: settingsPath('plan'),
    },
    {
      id: 'ntf-amazon-expiring-30',
      type: 'amazon_auth_expiring',
      title: 'Tu autorización de Amazon caduca en 30 días',
      body: `Amazon pide renovarla cada 365 días. Renuévala antes del ${formatDayMonth(amazonAt + 30 * DAY)} para que Uonify siga sincronizando tu cuenta de vendedor.`,
      createdAt: iso(amazonAt),
      readAt: iso(amazonAt + 3 * HOUR),
      href: settingsPath('conexiones'),
    },
    {
      id: 'ntf-invoice-0318',
      type: 'invoice_issued',
      title: `Factura F-${year}-0318 emitida`,
      body: 'Recarga de 2.000 tokens de Uonify · 20,00 €. Total con IVA: 24,20 €. Ya puedes descargarla.',
      createdAt: iso(invoiceAt),
      readAt: iso(invoiceAt + 40 * MINUTE),
      href: settingsPath('plan'),
    },
    {
      id: 'ntf-chatgpt-reached-38',
      type: 'chatgpt_limit_reached',
      title: 'Has alcanzado el límite semanal de ChatGPT',
      body: 'Uony se ha detenido hasta que se renueve tu límite. Si quieres seguir antes, puedes elegir usar tokens de Uonify.',
      createdAt: iso(limitAt),
      readAt: iso(limitAt + 25 * MINUTE),
      href: settingsPath('uso'),
    },
    {
      id: 'ntf-model3d-ready-0413',
      type: 'model3d_ready',
      title: 'Tu modelo 3D está listo',
      body: 'El modelo de «Make It Possible» (GLB, 2,4 MB) ya se puede ver en 3D y en realidad aumentada.',
      createdAt: iso(now + DELAYED_ARRIVAL_MS),
      readAt: null,
      href: `/espacio/producto/${SAMPLE_SKU}/modelos3d`,
    },
  ];
}
