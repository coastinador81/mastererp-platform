import { createThreeContext } from '../model/threeContext';

function setup() {
  let time = 0;
  let init: (() => void) | null = null;
  const context = createThreeContext({ now: () => time, schedule: fn => { init = fn; } });
  return { context, advance: (ms: number) => { time += ms; }, initialize: () => init?.() };
}

describe('ThreeJSContext (límite de 3 canvas, E53)', () => {
  test('no permite pintar hasta inicializarse (150 ms)', () => {
    const { context, initialize } = setup();
    expect(context.isInitialized()).toBe(false);
    expect(context.canRender()).toBe(false);
    initialize();
    expect(context.canRender()).toBe(true);
  });

  test('3 canvas como máximo; el cuarto espera en cola y entra al liberarse uno', () => {
    const { context, initialize } = setup();
    initialize();
    expect(['a', 'b', 'c'].map(id => context.register(id))).toEqual([true, true, true]);
    expect(context.canRender()).toBe(false);
    expect(context.register('d')).toBe(false);
    expect(context.register('a')).toBe(true);
    context.unregister('b');
    expect(context.count()).toBe(3);
    expect(context.register('d')).toBe(true);
  });

  test('los registros sin renovar en 15 s se descartan; el latido los mantiene', () => {
    const { context, advance, initialize } = setup();
    initialize();
    context.register('visor');
    context.register('otro');
    advance(10_000);
    context.touch('visor');
    advance(10_000);
    expect(context.count()).toBe(1);
  });

  test('avisa a los suscriptores', () => {
    const { context, initialize } = setup();
    const listener = vi.fn();
    const off = context.subscribe(listener);
    initialize();
    context.register('a');
    context.unregister('a');
    expect(listener).toHaveBeenCalledTimes(3);
    expect(context.version()).toBe(3);
    off();
    context.register('b');
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
