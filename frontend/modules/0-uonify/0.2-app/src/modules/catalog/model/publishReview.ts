import type { Channel, PublishCheck, PublishResult } from '@/shared/pim';
import type { PublishItem } from './types';

/**
 * Lógica pura del diálogo «Publicar» (prototipo: pim/publicar.js): revisión de cada
 * ficha para cada canal elegido, textos de estado y resumen. El diálogo solo pinta.
 */
export type PublishPhase = 'review' | 'publishing' | 'done';

export interface PublishOutcome {
  state: 'pending' | 'done' | 'error';
  message?: string;
}

/** Resultados por «sku|canal». */
export type PublishResults = Record<string, PublishOutcome>;

export interface ReviewRow extends PublishCheck {
  channel: string;
}

export interface Review {
  rows: ReviewRow[];
  missing: ReviewRow[];
  advice: ReviewRow[];
  ready: boolean;
}

/** Nombres de las pestañas en «Completar en …». */
export const TAB_NAMES: Record<string, string> = {
  atributos: 'Atributos',
  descripciones: 'Descripciones',
  imagenes: 'Imágenes',
  gpsr: 'GPSR',
};

export const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

export const resultKey = (sku: string, channel: string): string => `${sku}|${channel}`;

type ChannelLookup = (id: string) => Pick<Channel, 'checks' | 'label'> | null;

/** Canales marcados al abrir: los activos en la ficha o, si no hay, todos. */
export function initialChannels(preselect: string[] | null | undefined, channels: Pick<Channel, 'id'>[]): string[] {
  const wanted = preselect && preselect.length ? preselect : channels.map(channel => channel.id);
  return wanted.filter(id => channels.some(channel => channel.id === id));
}

export function reviewOf(item: PublishItem, chosen: string[], lookup: ChannelLookup): Review {
  const rows = chosen.flatMap(id => {
    const channel = lookup(id);
    return channel ? channel.checks(item.data).map(row => ({ ...row, channel: id })) : [];
  });
  const missing = rows.filter(row => row.required && !row.ok);
  const advice = rows.filter(row => !row.required && !row.ok);
  return { rows, missing, advice, ready: chosen.length > 0 && missing.length === 0 };
}

export function readyItems(items: PublishItem[], chosen: string[], lookup: ChannelLookup): PublishItem[] {
  return items.filter(item => reviewOf(item, chosen, lookup).ready);
}

/** Línea de estado (región viva) bajo la revisión. */
export function summaryText({ phase, items, chosen, results, ready }: {
  phase: PublishPhase;
  items: PublishItem[];
  chosen: string[];
  results: PublishResults;
  ready: number;
}): string {
  if (phase === 'done') {
    const sent = items.filter(item => chosen.every(id => results[resultKey(item.sku, id)]?.state === 'done')).length;
    return sent ? `${plural(sent, 'producto enviado', 'productos enviados')} de ${ready}.` : 'No se ha podido publicar ningún producto.';
  }
  if (phase === 'publishing') return 'Publicando…';
  if (!chosen.length) return 'Elige al menos un canal.';
  const pending = items.length - ready;
  const tail = pending ? ` · ${plural(pending, 'necesita', 'necesitan')} revisión y no se ${pending === 1 ? 'envía' : 'envían'}` : '';
  return `${plural(ready, 'producto listo', 'productos listos')}${tail}.`;
}

/** Estado de un producto durante y después del envío. */
export type SendState = 'skipped' | 'pending' | 'sent' | 'failed';

export function sendState(item: PublishItem, chosen: string[], results: PublishResults, ready: boolean): SendState {
  if (!ready) return 'skipped';
  const states = chosen.map(id => results[resultKey(item.sku, id)]).filter(Boolean);
  if (states.some(state => state.state === 'pending')) return 'pending';
  if (states.every(state => state.state === 'done')) return 'sent';
  return 'failed';
}

/** Mensaje del resultado de un envío correcto (con los avisos de Amazon, si los hay). */
export function doneMessage(answer: PublishResult | null | undefined): string {
  const warnings = (answer?.issues || []).filter(issue => (issue as { severity?: string } | null)?.severity === 'WARNING').length;
  return `enviado${warnings ? ` con ${plural(warnings, 'aviso', 'avisos')}` : ''}.`;
}

/** Título del diálogo. */
export function dialogTitle(items: PublishItem[]): string {
  return items.length === 1 ? `Publicar «${items[0].name || items[0].sku}»` : `Publicar ${items.length} productos`;
}

/** Texto del botón principal en la revisión. */
export function publishLabel(ready: number): string {
  return ready > 0 ? `Publicar ${plural(ready, 'producto', 'productos')}` : 'Publicar';
}
