import { createPimStore, NEW_PRODUCT_KEY, PIM_STORE_KEY, PIM_TAB_ORDER, sortPimTabs, isPimTabKey, type PimTabDefinition } from '@/shared/pim';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { map.set(key, String(value)); }),
    raw: map,
  };
}

describe('almacén por producto (UonifyPIM.store)', () => {
  // Portada de tests/pim-core.test.cjs del prototipo.
  test('el estado de las pestañas sigue al producto cuando «Guardar y Crear» le da su SKU', () => {
    const store = createPimStore({ storage: memoryStorage() });
    const scope = store.scope(NEW_PRODUCT_KEY);
    scope.set('edited', { name: 'Lámpara' });
    store.rename(NEW_PRODUCT_KEY, 'LMP-1');
    scope.set('images', [{ id: 'a' }]); // una petición que termina después de guardar
    expect(store.get<{ name: string }>('LMP-1', 'edited').name).toBe('Lámpara');
    expect(store.get<unknown[]>('LMP-1', 'images')).toHaveLength(1);
    expect(store.get('__new__', 'images')).toBeUndefined();
  });

  test('get/set/update/all con valor por defecto', () => {
    const store = createPimStore({ storage: null });
    expect(store.get('UON-1', 'bullets', [])).toEqual([]);
    store.set('UON-1', 'bullets', ['uno']);
    store.update<string[]>('UON-1', 'bullets', list => [...list, 'dos'], []);
    store.update<number>('UON-1', 'count', n => n + 1, 0);
    expect(store.all('UON-1')).toEqual({ bullets: ['uno', 'dos'], count: 1 });
    // all() devuelve una copia
    store.all('UON-1').bullets = [];
    expect(store.get('UON-1', 'bullets')).toEqual(['uno', 'dos']);
  });

  test('rename mezcla con lo que ya tuviera el destino y drop lo borra', () => {
    const store = createPimStore({ storage: null });
    store.set('A', 'gpsr', { ok: true });
    store.set('B', 'audit', { score: 80 });
    store.rename('A', 'B');
    expect(store.all('B')).toEqual({ audit: { score: 80 }, gpsr: { ok: true } });
    expect(store.entry('A')).toBeUndefined();
    store.drop('B');
    expect(store.entry('B')).toBeUndefined();
  });

  test('un solo ámbito por clave', () => {
    const store = createPimStore({ storage: null });
    expect(store.scope('X')).toBe(store.scope('X'));
    expect(store.scope('X')).not.toBe(store.scope('Y'));
  });

  test('avisa a los suscriptores de cada cambio', () => {
    const store = createPimStore({ storage: null });
    const events: unknown[] = [];
    const off = store.subscribe(event => events.push(event));
    store.set('K', 'video', { videos: [] });
    store.rename('K', 'K2');
    store.drop('K2');
    off();
    store.set('K', 'video', null);
    expect(events).toEqual([
      { type: 'set', key: 'K', slice: 'video', value: { videos: [] } },
      { type: 'rename', from: 'K', to: 'K2' },
      { type: 'drop', key: 'K2' },
    ]);
  });

  test('guarda en sessionStorage (200 ms después) y lo recupera al recargar', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const store = createPimStore({ storage });
    store.set('UON-KIT-01', 'videoView', 'create');
    expect(storage.setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(JSON.parse(storage.raw.get(PIM_STORE_KEY)!)).toEqual({ 'UON-KIT-01': { videoView: 'create' } });
    const reloaded = createPimStore({ storage });
    expect(reloaded.get('UON-KIT-01', 'videoView')).toBe('create');
    vi.useRealTimers();
  });

  test('si la cuota se llena sigue funcionando en memoria', () => {
    const storage = { getItem: () => 'no es JSON', setItem: () => { throw new Error('QuotaExceededError'); } };
    const store = createPimStore({ storage });
    store.set('K', 'images', ['data:image/png;base64,…']);
    expect(() => store.flush()).not.toThrow();
    expect(store.get('K', 'images')).toHaveLength(1);
  });
});

describe('pestañas de la ficha', () => {
  test('orden del prototipo y utilidades', () => {
    expect(PIM_TAB_ORDER).toEqual(['atributos', 'auditoria', 'descripciones', 'gpsr', 'imagenes', 'modelos3d', 'video', 'aplus', 'incidencias']);
    expect(isPimTabKey('gpsr')).toBe(true);
    expect(isPimTabKey('media')).toBe(false);
    const make = (key: PimTabDefinition['key']): PimTabDefinition => ({ key, label: key, icon: null, component: () => null });
    expect(sortPimTabs([make('aplus'), make('atributos'), make('video'), make('atributos')]).map(tab => tab.key))
      .toEqual(['atributos', 'video', 'aplus']);
  });
});
