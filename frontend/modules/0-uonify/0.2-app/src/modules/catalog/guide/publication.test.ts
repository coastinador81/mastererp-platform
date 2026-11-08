import { describe, expect, it } from 'vitest';
import { amazonPublicationUrl } from './publication';

describe('Enlace de la publicación Amazon.es', () => {
  it('acepta enlaces de ficha y rechaza destinos ajenos, inseguros o sin producto', () => {
    expect(amazonPublicationUrl('https://www.amazon.es/nombre/dp/B0TEST0001?th=1')).toBe('https://www.amazon.es/nombre/dp/B0TEST0001?th=1');
    expect(amazonPublicationUrl('https://amazon.es/gp/product/B0TEST0001')).toBe('https://amazon.es/gp/product/B0TEST0001');
    for (const url of [undefined, '', 'javascript:alert(1)', 'https://amazon.es.ejemplo.com/dp/B0TEST0001', 'http://amazon.es/dp/B0TEST0001', 'https://amazon.es/', 'https://user:pass@amazon.es/dp/B0TEST0001']) {
      expect(amazonPublicationUrl(url)).toBeUndefined();
    }
  });
});
