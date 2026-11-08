import { getChannel } from '@/shared/pim';
import { AMAZON_CHANNEL, registerAmazonChannel } from '../api/amazonChannel';
import { SAMPLE_SKU, sampleProduct, sampleSlices } from '../mocks/fixtures/sampleProduct';
import { amazonChecks } from '../model/amazonChecks';
import { publishData } from '../model/publishData';
import {
  doneMessage,
  initialChannels,
  readyItems,
  reviewOf,
  sendState,
  summaryText,
  dialogTitle,
  publishLabel,
} from '../model/publishReview';
import type { PublishItem } from '../model/types';

// Puerto de tests/publish-and-cleanup.test.cjs (canal Amazon, revisión previa y
// publishData) con la lógica del diálogo «Publicar».

test('Amazon es un canal registrado y su revisión dice qué falta antes de publicar', () => {
  registerAmazonChannel();
  const amazon = getChannel('Amazon');
  expect(amazon && typeof amazon.publish).toBe('function');
  expect(amazon?.market).toBe(AMAZON_CHANNEL.market);
  const product = sampleProduct();
  const slices = sampleSlices() as { images: Array<{ url: string }>; gpsr: Record<string, unknown> };
  const data = { ...product, bullet_points: product.bullets as string[], images: slices.images.map(image => image.url), gpsr: slices.gpsr };
  const missing = amazonChecks(data).filter(row => row.required && !row.ok).map(row => row.label);
  expect(missing.join(', ')).toBe('');
  const bare = amazonChecks({ name: 'Taza', sku: 'T1' }).filter(row => row.required && !row.ok).map(row => row.label);
  expect(bare).toEqual(expect.arrayContaining(['Precio', 'Marca', 'GPSR: contacto del fabricante']));
});

test('un SKU escrito sin guardar bloquea el producto hasta guardarlo', () => {
  const sku = amazonChecks({ sku: 'UON-1', pendingSku: 'OTRO-1' }).find(row => row.label === 'SKU');
  expect(sku?.ok).toBe(false);
  expect(sku?.hint).toBe('Guarda la ficha: el SKU ha cambiado a OTRO-1');
});

test('el producto de ejemplo lleva GPSR con los contactos de ejemplo de Uonify', () => {
  const gpsr = (sampleSlices() as { gpsr: Record<string, string> }).gpsr;
  for (const key of ['manufacturer_contact', 'eu_responsible_address', 'compliance_document_url']) expect(gpsr[key]).toContain('uonify');
});

test('«Publicar» solo envía el SKU guardado y la galería como «Guardar Cambios»', () => {
  const store: Record<string, unknown> = {
    edited: { sku: 'OTRO-1', price: '9' },
    images: [{ url: 'a.jpg' }, { url: 'a.jpg' }, ...Array.from({ length: 12 }, (_, i) => ({ url: `${i}.jpg` }))],
  };
  const data = publishData({ sku: 'UON-1', name: 'X', image: 'thumb.jpg' }, (_key, slice) => store[slice]);
  expect(data.sku).toBe('UON-1');
  expect(data.pendingSku).toBe('OTRO-1');
  expect(data.price).toBe('9');
  expect(data.images).toHaveLength(10);
  expect(new Set(data.images).size).toBe(10);
  const emptied = publishData({ sku: 'UON-1', name: 'X', image: 'thumb.jpg' }, (_key, slice) => (slice === 'images' ? [] : undefined));
  expect(emptied.images).toHaveLength(0);
  const fallback = publishData({ sku: 'UON-1', name: 'X', image: 'thumb.jpg', bullets: ['uno', ' '] }, () => undefined);
  expect(fallback.images).toEqual(['thumb.jpg']);
  expect(fallback.bullet_points).toEqual(['uno']);
});

const lookup = (id: string) => (id === 'Amazon' ? { label: 'Amazon', checks: amazonChecks } : null);
const ready: PublishItem = {
  sku: SAMPLE_SKU,
  name: 'Ejemplo',
  image: '',
  data: { sku: SAMPLE_SKU, name: 'Ejemplo', brand: 'Uonify', price: '10', images: ['a.jpg'], description: 'Texto', gpsr: { manufacturer_contact: 'x', eu_responsible_address: 'y' } },
};
const incomplete: PublishItem = { sku: 'T1', name: 'Taza', image: '', data: { sku: 'T1', name: 'Taza' } };

test('revisión: lo obligatorio bloquea el producto y lo recomendado solo avisa', () => {
  const review = reviewOf(ready, ['Amazon'], lookup);
  expect(review.ready).toBe(true);
  expect(review.missing).toHaveLength(0);
  expect(review.advice.map(row => row.label)).toContain('Cinco viñetas');
  expect(reviewOf(incomplete, ['Amazon'], lookup).ready).toBe(false);
  expect(reviewOf(ready, [], lookup).ready).toBe(false);
  expect(readyItems([ready, incomplete], ['Amazon'], lookup).map(item => item.sku)).toEqual([SAMPLE_SKU]);
});

test('textos del diálogo: título, botón, resumen y resultados', () => {
  expect(dialogTitle([ready])).toBe('Publicar «Ejemplo»');
  expect(dialogTitle([ready, incomplete])).toBe('Publicar 2 productos');
  expect(publishLabel(1)).toBe('Publicar 1 producto');
  expect(publishLabel(0)).toBe('Publicar');
  const items = [ready, incomplete];
  expect(summaryText({ phase: 'review', items, chosen: ['Amazon'], results: {}, ready: 1 })).toBe('1 producto listo · 1 necesita revisión y no se envía.');
  expect(summaryText({ phase: 'review', items, chosen: [], results: {}, ready: 0 })).toBe('Elige al menos un canal.');
  expect(summaryText({ phase: 'publishing', items, chosen: ['Amazon'], results: {}, ready: 1 })).toBe('Publicando…');
  const results = { [`${SAMPLE_SKU}|Amazon`]: { state: 'done' as const, message: 'enviado.' } };
  expect(summaryText({ phase: 'done', items, chosen: ['Amazon'], results, ready: 1 })).toBe('1 producto enviado de 1.');
  expect(summaryText({ phase: 'done', items, chosen: ['Amazon'], results: {}, ready: 1 })).toBe('No se ha podido publicar ningún producto.');
  expect(sendState(ready, ['Amazon'], results, true)).toBe('sent');
  expect(sendState(incomplete, ['Amazon'], results, false)).toBe('skipped');
  expect(doneMessage({ status: 'ACCEPTED', issues: [{ severity: 'WARNING' }, { severity: 'WARNING' }] })).toBe('enviado con 2 avisos.');
  expect(doneMessage({ status: 'ACCEPTED', issues: [] })).toBe('enviado.');
});

test('se marcan los canales activos en la ficha o, si no hay, todos', () => {
  const channels = [{ id: 'Amazon' }, { id: 'Shopify' }];
  expect(initialChannels(['Amazon'], channels)).toEqual(['Amazon']);
  expect(initialChannels([], channels)).toEqual(['Amazon', 'Shopify']);
  expect(initialChannels(['Wix'], channels)).toEqual([]);
});
