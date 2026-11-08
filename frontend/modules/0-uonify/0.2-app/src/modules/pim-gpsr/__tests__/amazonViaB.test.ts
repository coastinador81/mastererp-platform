import {
  AMAZON_EU_STORES, VIA_B_BRAND_ES, VIA_B_PRODUCT_ES, VIA_B_BRAND_EN,
  joinStores, renderViaB, storeName, unconfirmedStores, type AmazonCompliance,
} from '../model/amazonViaB';

describe('vía B de Amazon (§8)', () => {
  test('textos legales EXACTOS citan Seller Central y llevan el marcador de tiendas', () => {
    expect(VIA_B_BRAND_ES).toContain('Seller Central');
    expect(VIA_B_BRAND_ES).toContain('Brand Registry');
    expect(VIA_B_BRAND_ES).toContain('{tiendas}');
    expect(VIA_B_PRODUCT_ES).toContain('Seller Central');
    expect(VIA_B_PRODUCT_ES).toContain('{tiendas}');
    expect(VIA_B_BRAND_EN).toContain('{stores}');
    // El texto de producto NO menciona Brand Registry (es el caso sin BR).
    expect(VIA_B_PRODUCT_ES).not.toContain('Brand Registry');
  });

  test('storeName traduce ISO2 → dominio', () => {
    expect(storeName('ES')).toBe('amazon.es');
    expect(storeName('DE')).toBe('amazon.de');
    expect(storeName('ZZ')).toBe('ZZ');
    expect(AMAZON_EU_STORES.length).toBeGreaterThanOrEqual(4);
  });

  test('joinStores en lenguaje natural ES', () => {
    expect(joinStores(['amazon.es'])).toBe('amazon.es');
    expect(joinStores(['amazon.es', 'amazon.de'])).toBe('amazon.es y amazon.de');
    expect(joinStores(['amazon.es', 'amazon.de', 'amazon.fr'])).toBe('amazon.es, amazon.de y amazon.fr');
  });

  test('renderViaB sustituye {tiendas} por la(s) tienda(s)', () => {
    const out = renderViaB(VIA_B_BRAND_ES, ['amazon.es']);
    expect(out).toContain('para amazon.es,');
    expect(out).not.toContain('{tiendas}');
  });

  test('unconfirmedStores: solo las tiendas sin confirmar', () => {
    const value: AmazonCompliance = { ES: { confirmed: true }, DE: { confirmed: false } };
    expect(unconfirmedStores(['ES', 'DE', 'FR'], value)).toEqual(['DE', 'FR']);
    expect(unconfirmedStores(['ES'], value)).toEqual([]);
  });
});
