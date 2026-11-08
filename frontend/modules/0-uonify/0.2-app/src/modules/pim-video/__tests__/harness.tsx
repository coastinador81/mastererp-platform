import { render } from '@testing-library/react';
import { pimStore, PimTabHost, type PimProduct, type PimTabContext } from '@/shared/pim';
import { DialogHost, Toaster } from '@/shared/ui';
import { tab } from '..';
import type { StudioState, VideoItem } from '../model/types';
import { SAMPLE_PLANS } from './fixtures';

/** Ficha simulada para montar la pestaña como lo hace catalog. */
export const SKU = 'UON-KIT-01';
export const PRODUCT: PimProduct = {
  sku: SKU,
  name: 'Make It Possible by Uonify',
  brand: 'Uonify',
  asin: 'B0TEST1234',
  bullets: ['25 piezas de madera: tres personajes para construir', 'Apila por turnos. Gana quien no derriba la torre'],
};

export function makeContext(product: PimProduct | null = PRODUCT, overrides: Partial<PimTabContext> = {}): PimTabContext {
  const key = product?.sku ?? '__new__';
  return {
    key,
    isNew: !product,
    product,
    store: pimStore.scope(key),
    draft: () => ({ ...(product ?? {}), ...pimStore.get<Record<string, unknown>>(key, 'edited', {}) }),
    edit: patch => { pimStore.update<Record<string, unknown>>(key, 'edited', edited => ({ ...edited, ...patch }), {}); },
    persist: async data => ({ sku: String(data.sku), name: String(data.name) }),
    skuTaken: () => false,
    channels: () => ({ Amazon: true }),
    switchTab: () => {},
    ...overrides,
  };
}

export function renderTab(context: PimTabContext = makeContext()) {
  return render(<><PimTabHost tab={tab} context={context} /><DialogHost /><Toaster /></>);
}

/** Vídeo del producto de ejemplo (como lo siembra catalog). */
export const SAMPLE_VIDEO_ITEM: VideoItem = {
  id: 'jenga-video-campana',
  name: 'uonify-juego-de-piezas.mp4',
  url: '/assets/video-uonify-v63/uonify-juego-propuesta-v63.mp4',
  poster: '/assets/video-uonify-v63/portada.jpg',
  size: 28411446,
  type: 'video/mp4',
  duration: 26.8,
  width: 1920,
  height: 1080,
  codecs: 'H.264 · AAC',
  title: 'Todo empieza jugando · Make It Possible by Uonify',
  source: 'upload',
  destination: 'listing',
  language: 'es',
  chapters: [
    { time: 0, title: 'Todo empieza jugando.', thumb: '/assets/video-uonify-v63/escenas/01-apertura.jpg' },
    { time: 6, title: 'Juntos, pieza a pieza.', thumb: '/assets/video-uonify-v63/escenas/02-construccion.jpg' },
  ],
};

export const SAMPLE_STUDIO: StudioState = { destination: 'listing', format: '16:9', audio: true, plans: SAMPLE_PLANS, project: null };

/** Siembra porciones del producto antes de montar la pestaña. */
export function seed(slices: Record<string, unknown>, key = SKU): void {
  Object.entries(slices).forEach(([slice, value]) => pimStore.set(key, slice, value));
}
