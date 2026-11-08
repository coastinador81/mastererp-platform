import type { PimProduct } from '@/shared/pim';
import { defaultCustomFields, generateCustomFields } from '../model/customFields';
import { createField, parseOptions, shownValue, showsFieldAI, typeLabel, isTechnicalValue } from '../model/fields';
import { activeChannels, buildDataToSave, buildProductToCreate, categoryDisplay, currentValues, galleryImages } from '../model/productValues';
import type { CustomField } from '../model/types';

const amazonProduct: PimProduct = {
  sku: 'AMZ-1',
  name: 'Lámpara',
  source: 'amazon',
  asin: 'B0TEST1234',
  _raw_attributes: {
    external_product_id: [{ value: '8412345678901' }],
    item_depth_width_height: [{ height: { value: 40, unit: 'cm' }, width: { value: 20 }, depth: { value: 15, unit: 'cm' } }],
    material: [{ value: 'Roble' }],
    wattage: [{ value: 60, unit: 'W' }],
    number_of_items: [{ value: 1 }],
    batteries_required: [{ value: false }],
    brand: [{ value: 'Nórdika' }],
    odd_attribute: [null],
    plain_list: ['uno'],
  },
};

describe('campos personalizados por defecto (useAmazonAttributes, E31)', () => {
  test('un producto de Amazon da ASIN, EAN, medidas y sus atributos confirmados', () => {
    const fields = generateCustomFields(amazonProduct, 'AMZ-1');
    const byName = Object.fromEntries(fields.map(field => [field.name, field]));
    expect(byName.ASIN.value).toBe('B0TEST1234');
    expect(byName.EAN.value).toBe('8412345678901');
    expect(byName.Alto.value).toBe('40 cm');
    expect(byName.Ancho.value).toBe('20 cm');
    expect(byName.Material).toMatchObject({ type: 'text', value: 'Roble' });
    // Un valor con unidad es texto; un número sin unidad, número; un booleano, casilla.
    expect(byName.Potencia).toMatchObject({ type: 'text', value: '60 W' });
    expect(byName['Número de Artículos']).toMatchObject({ type: 'number', value: '1' });
    expect(byName['Requiere Baterías']).toMatchObject({ type: 'checkbox', value: false });
    expect(byName['Plain List']).toMatchObject({ type: 'text', value: 'uno' });
    expect(fields.every(field => field.isConfirmed)).toBe(true);
    expect(fields.some(field => field.name === 'Marca')).toBe(false); // excluido
  });

  test('un primer elemento null no rompe la pestaña y un producto propio no genera nada', () => {
    expect(() => generateCustomFields(amazonProduct, 'k')).not.toThrow();
    expect(generateCustomFields({ sku: 'U1', name: 'Taza', source: 'uonify' }, 'U1')).toEqual([]);
    expect(generateCustomFields(null, 'x')).toEqual([]);
  });

  test('los campos del propio producto mandan sobre los generados', () => {
    const own: CustomField[] = [{ id: 'f1', name: 'Color', type: 'text', value: 'Azul', options: [], isConfirmed: true }];
    expect(defaultCustomFields({ ...amazonProduct, customFields: own }, 'AMZ-1')).toBe(own);
    expect(defaultCustomFields(amazonProduct, 'AMZ-1').length).toBeGreaterThan(5);
  });
});

describe('reglas de los campos', () => {
  test('textos, iconos IA, valores mostrados y datos técnicos', () => {
    expect(typeLabel('textarea')).toBe('Texto Largo');
    expect(typeLabel('otro')).toBe('otro');
    expect(showsFieldAI('Título SEO')).toBe(true);
    expect(showsFieldAI('Color')).toBe(false);
    const field = (patch: Partial<CustomField>): CustomField => ({ id: 'x', name: 'n', type: 'text', value: '', options: [], isConfirmed: true, ...patch });
    expect(shownValue(field({ type: 'checkbox', value: true }), false)).toBe('Sí');
    expect(shownValue(field({ value: '' }), false)).toBe('Sin valor');
    expect(shownValue(field({ type: 'select', value: '' }), true)).toBe('');
    expect(isTechnicalValue('EAN', '123')).toBe(true);
    expect(isTechnicalValue('Manual', 'https://uonify.com/manual.pdf')).toBe(true);
    expect(isTechnicalValue('Color', 'Azul')).toBe(false);
  });

  test('las opciones se derivan de lo tecleado sin reescribirlo (E16) y los ids no se repiten', () => {
    expect(parseOptions('A, ')).toEqual(['A']);
    expect(parseOptions('Rojo, Verde ,Azul')).toEqual(['Rojo', 'Verde', 'Azul']);
    const first = createField([], 100);
    expect(createField([first], 100).id).toBe('field-101');
  });
});

describe('valores del formulario y datos que se guardan', () => {
  test('edición: lo editado manda; un producto de Amazon lee retail_price y cost_price', () => {
    const product: PimProduct = { sku: 'A', name: 'A', source: 'amazon', price: 10, retail_price: 19.9, cost_price: { amount: 7 } };
    expect(currentValues({}, product)).toMatchObject({ price: 19.9, cost: 7, stock: '0' });
    expect(currentValues({ price: '25', category: '' }, product)).toMatchObject({ price: '25', category: '' });
  });

  test('el término del buscador solo tapa la categoría mientras sea la aplicada (E34)', () => {
    expect(categoryDisplay('TOY_FIGURE', { term: 'Figura de juguete', forCategory: 'TOY_FIGURE' })).toBe('Figura de juguete');
    expect(categoryDisplay('LAMP', { term: 'Figura de juguete', forCategory: 'TOY_FIGURE' })).toBe('LAMP');
  });

  test('crear conserva todos los datos del formulario (E18) con nombre y SKU sin espacios', () => {
    const created = buildProductToCreate({ name: ' Taza ', sku: ' TZ-1 ', brand: 'Uonify', price: '9.90', stock: '5' }, [], 42);
    expect(created).toMatchObject({ id: 'new-42', name: 'Taza', sku: 'TZ-1', brand: 'Uonify', price: '9.90', stock: '5', status: 'draft', source: 'uonify' });
    expect(created.channels).toEqual({ shopify: false, amazon: false, wix: false });
  });

  test('guardar: viñetas con texto, galería sin duplicados (10 como máximo), precio donde lo lee Amazon', () => {
    const product: PimProduct = { sku: 'A', name: 'A', source: 'amazon', images: ['old.jpg'] };
    const gallery = [{ url: 'a.jpg' }, { url: 'a.jpg' }, ...Array.from({ length: 12 }, (_, i) => ({ url: `${i}.jpg` }))];
    const data = buildDataToSave({ product, edited: { price: '30', cost: '12' }, fields: [], bullets: ['Uno', ' ', 'Dos'], gallery });
    expect(data.bullet_points).toEqual(['Uno', 'Dos']);
    expect(data.images).toHaveLength(10);
    expect(data.retail_price).toBe('30');
    expect(data.cost_price).toEqual({ amount: '12' });
    expect(galleryImages(undefined, product)).toEqual(['old.jpg']);
  });

  test('la cabecera decide Amazon; Shopify sale del propio producto', () => {
    const product: PimProduct = { sku: 'A', name: 'A', channels: { shopify: true, amazon: false } };
    expect(activeChannels({ Amazon: true }, product)).toMatchObject({ shopify: true, amazon: true });
    expect(activeChannels({}, product)).toMatchObject({ shopify: true, amazon: false });
  });
});
