import {
  getChannel,
  getChannels,
  getDefaultCustomFields,
  getPublisher,
  PIM_ENDPOINTS,
  publishWith,
  registerChannel,
  registerDefaultCustomFields,
  registerPublisher,
  subscribeChannels,
} from '@/shared/pim';

describe('canales y publicadores (UonifyPIM.channels / publishers)', () => {
  test('registrar, listar, obtener y retirar un canal', () => {
    const notify = vi.fn();
    const off = subscribeChannels(notify);
    const remove = registerChannel('Prueba', {
      label: 'Prueba',
      market: 'prueba.es',
      checks: data => [{ label: 'SKU', ok: Boolean(data.sku), required: true, tab: 'atributos', hint: 'Obligatorio' }],
      publish: async () => ({ status: 'ACCEPTED', issues: [] }),
    });
    expect(notify).toHaveBeenCalledOnce();
    expect(getChannels().map(channel => channel.id)).toContain('Prueba');
    expect(getChannel('Prueba')?.checks({ sku: 'UON-1' })[0].ok).toBe(true);
    remove();
    expect(getChannel('Prueba')).toBeNull();
    off();
  });

  test('publishWith usa el publicador registrado o rechaza como el prototipo', async () => {
    await expect(publishWith('Amazon', { sku: 'UON-1' })).rejects.toThrow('El canal de Amazon no está disponible.');
    const remove = registerPublisher('Amazon', async data => ({ status: 'ACCEPTED', issues: [{ message: data.sku }] }));
    expect(getPublisher('Amazon')).toBeTypeOf('function');
    await expect(publishWith('Amazon', { sku: 'UON-1' })).resolves.toEqual({ status: 'ACCEPTED', issues: [{ message: 'UON-1' }] });
    remove();
    expect(getPublisher('Amazon')).toBeNull();
  });

  test('campos personalizados por defecto (los registra Atributos)', () => {
    expect(getDefaultCustomFields()).toBeNull();
    const remove = registerDefaultCustomFields(product => (product ? [{ id: 'f1', name: 'Material' }] : []));
    expect(getDefaultCustomFields()?.({ sku: 'X', name: 'X' }, 'X')).toHaveLength(1);
    remove();
    expect(getDefaultCustomFields()).toBeNull();
  });

  test('rutas de los servicios bajo API_BASE (api.config.ENDPOINTS)', () => {
    expect(PIM_ENDPOINTS.SHOPIFY_PRODUCTS).toBe('/shopify/products');
    expect(PIM_ENDPOINTS.AMAZON_LISTINGS).toBe('/amazon/listings');
    expect(PIM_ENDPOINTS.AI_BULLET_POINT).toBe('/bullet-point');
    Object.values(PIM_ENDPOINTS).forEach(path => expect(path).toMatch(/^\/[a-z0-9/-]+$/));
  });
});
