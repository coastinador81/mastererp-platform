import { useSyncExternalStore } from 'react';
import type { PimTabKey } from '../tabs';

/**
 * Canales de venta y publicadores (prototipo: `UonifyPIM.channels` de
 * pim/publicar.js y `UonifyPIM.publishers` de pim/atributos.js).
 * - Un canal (hoy Amazon; los marketplaces nuevos se registran igual) dice qué
 *   revisa antes de enviar y cómo publica. Lo usa el diálogo «Publicar» (catalog).
 * - Un publicador es el envío real de un canal (Amazon: el mismo que «Guardar
 *   Cambios» de Atributos con el canal activo). Lo registra el módulo que lo sabe hacer.
 */

/** Lo que se publica: producto guardado + trabajo de las pestañas (publishData del prototipo). */
export interface PublishData {
  sku: string;
  name?: string;
  /** SKU escrito pero sin guardar: bloquea el producto hasta guardarlo. */
  pendingSku?: string;
  bullet_points?: string[];
  images?: string[];
  customFields?: unknown[];
  gpsr?: Record<string, unknown> | null;
  [field: string]: unknown;
}

/** Una comprobación de la revisión previa (obligatoria o recomendada). */
export interface PublishCheck {
  label: string;
  ok: boolean;
  /** Sin ella no se envía ese producto a ese canal. */
  required: boolean;
  /** Pestaña donde se completa. */
  tab: PimTabKey;
  hint: string;
}

export interface PublishIssue {
  message?: string;
  [field: string]: unknown;
}

export interface PublishResult {
  status: string;
  issues: PublishIssue[];
}

export type Publisher = (data: PublishData) => Promise<PublishResult>;

export interface ChannelDefinition {
  label: string;
  /** Mercado y cuenta, p. ej. «Amazon.es · Seller Central». */
  market?: string;
  /** URL del logotipo (p. ej. /assets/brands/amazon-logo.svg). */
  logo?: string;
  /** Si la cuenta del canal está conectada. */
  connected?: () => boolean;
  checks: (data: PublishData) => PublishCheck[];
  publish: (data: PublishData) => Promise<PublishResult>;
}

export interface Channel extends ChannelDefinition {
  id: string;
}

const channels = new Map<string, Channel>();
const publishers = new Map<string, Publisher>();
const listeners = new Set<() => void>();
let snapshot: Channel[] = [];

function emit(): void {
  snapshot = [...channels.values()];
  listeners.forEach(listener => listener());
}

/** Registra (o sustituye) un canal; devuelve la función que lo retira. */
export function registerChannel(id: string, definition: ChannelDefinition): () => void {
  const channel: Channel = { id, ...definition };
  channels.set(id, channel);
  emit();
  return () => {
    if (channels.get(id) !== channel) return;
    channels.delete(id);
    emit();
  };
}

/** Canales registrados, en orden de registro. */
export function getChannels(): Channel[] {
  return snapshot;
}

export function getChannel(id: string): Channel | null {
  return channels.get(id) ?? null;
}

/** Registra el envío de un canal (p. ej. 'Amazon'); devuelve la función que lo retira. */
export function registerPublisher(id: string, publisher: Publisher): () => void {
  publishers.set(id, publisher);
  emit();
  return () => {
    if (publishers.get(id) !== publisher) return;
    publishers.delete(id);
    emit();
  };
}

export function getPublisher(id: string): Publisher | null {
  return publishers.get(id) ?? null;
}

/**
 * Publica con el publicador registrado; si falta, rechaza como el prototipo
 * («El canal de Amazon no está disponible.»).
 */
export function publishWith(id: string, data: PublishData, label = id): Promise<PublishResult> {
  const publisher = getPublisher(id);
  if (!publisher) return Promise.reject(new Error(`El canal de ${label} no está disponible.`));
  return publisher(data);
}

export function subscribeChannels(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Canales registrados; se actualiza si un módulo registra uno después. */
export function useChannels(): Channel[] {
  return useSyncExternalStore(subscribeChannels, getChannels, getChannels);
}
