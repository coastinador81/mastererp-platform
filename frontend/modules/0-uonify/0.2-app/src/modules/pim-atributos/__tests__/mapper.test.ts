import { amazonUpdatePayload, gpsrFields, mapInternalToAmazon, mapInternalToShopify } from '../model/productMapper';

// Portado de tests/pim-core.test.cjs: «creating an Amazon listing never sends the
// sample compliance data of the original mapper».
describe('mapeadores de producto', () => {
  test('crear un listing nunca envía los datos de cumplimiento de ejemplo del original', () => {
    const payload = mapInternalToAmazon({ sku: 'T1', name: 'Taza' });
    const text = JSON.stringify(payload);
    expect(text).not.toMatch(/example\.com|Calle Ejemplo/);
    expect(payload).not.toHaveProperty('gpsr_safety_attestation_value');
    expect(payload).not.toHaveProperty('gpsr_manufacturer_reference');
    expect(payload.bullet_points).toEqual(['Taza']);
    expect(payload).toMatchObject({ seller_id: '1Y6J8', marketplace_id: 'A1RKKUPIHCS9HS', country_code: 'ES', product_type: 'PRODUCT', brand: 'Generic' });
  });

  test('envía el GPSR del propio producto (o de su pestaña GPSR)', () => {
    const gpsr = { manufacturer_contact: 'fabricante@uonify.com', eu_responsible_address: 'https://uonify.com/responsable', compliance_document_url: 'https://uonify.com/manual.pdf', safety_attestation: true };
    expect(mapInternalToAmazon({ sku: 'T1', name: 'Taza', gpsr })).toMatchObject({
      gpsr_manufacturer_reference: 'fabricante@uonify.com',
      dsa_responsible_party_address: 'https://uonify.com/responsable',
      new_source_location: 'https://uonify.com/manual.pdf',
      content_type: 'user_manual',
      content_language: 'es_ES',
      gpsr_safety_attestation_value: true,
    });
    expect(gpsrFields({ sku: 'T1' }, { manufacturer_contact: 'a@b.es' })).toEqual({ gpsr_manufacturer_reference: 'a@b.es' });
    expect(gpsrFields({ sku: 'T1' }, { safety_attestation: false })).toEqual({});
  });

  test('actualizar un listing: atributos con idioma, cinco viñetas y nueve imágenes como máximo', () => {
    const payload = amazonUpdatePayload('S1', {
      name: 'Taza',
      description: 'Cerámica',
      bullet_points: ['1', '2', '', '3', '4', '5', '6'],
      images: Array.from({ length: 12 }, (_, i) => `${i}.jpg`),
    });
    expect(payload.product_type).toBe('LUGGAGE');
    const attributes = payload.attributes as Record<string, Array<{ value: unknown; language_tag: string }>>;
    expect(attributes.bullet_point.map(item => item.value)).toEqual(['1', '2', '3', '4', '5']);
    expect(attributes.item_name[0]).toEqual({ value: 'Taza', language_tag: 'es_ES' });
    expect(payload.images).toHaveLength(9);
  });

  test('Shopify: solo imágenes http(s), cinco como máximo, y metafields de viñetas', () => {
    const data = mapInternalToShopify({ sku: 'S1', name: 'Taza', image: 'https://cdn/a.jpg', images: ['data:image/png;base64,x', { src: 'https://cdn/b.jpg' }], bullet_points: ['Uno'] });
    expect(data.images).toEqual([{ src: 'https://cdn/a.jpg' }, { src: 'https://cdn/b.jpg' }]);
    expect(data.metafields).toEqual([{ namespace: 'custom', key: 'vineta1', value: 'Uno', type: 'multi_line_text_field' }]);
    expect(data.handle).toBe('s1');
  });
});
