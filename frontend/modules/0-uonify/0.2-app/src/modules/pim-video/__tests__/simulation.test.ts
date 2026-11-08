import { describe, expect, it } from 'vitest';
import { lintShot, lintClosing } from '../model/lint';
import { planFromResponse } from '../model/plan';
import { projectFrom, projectProgress } from '../model/project';
import { proposePlan } from '../mocks/fixtures/proposal';
import { EDIT_MS, QUEUE_MS, RETRY_SHOT_MS, SHOT_MS, projectAt, spentBy, type SimProject } from '../mocks/simulation';
import { findCuts } from '../lib/scenes';

const T0 = Date.parse('2026-09-26T10:00:00Z');
const sim = (patch: Partial<SimProject> = {}): SimProject => ({
  id: 'vp-1', createdAt: T0, sku: 'UON-KIT-01', destination: 'listing', format: '16:9', audio: true,
  shots: [{ id: 'shot-1' }, { id: 'shot-2' }, { id: 'shot-3' }, { id: 'shot-4' }], retries: [], ...patch,
});

describe('simulación del servidor de vídeo', () => {
  it('avanza En cola → Generando los planos → Montando → Listo, con el vídeo de muestra', () => {
    const project = sim();
    expect(projectAt(project, T0).status).toBe('queued');
    const generating = projectAt(project, T0 + QUEUE_MS + SHOT_MS + 10);
    expect(generating.status).toBe('generating');
    expect(generating.shots.map(shot => shot.status)).toEqual(['done', 'generating', 'generating', 'generating']);
    expect(projectAt(project, T0 + QUEUE_MS + 4 * SHOT_MS + 10).status).toBe('editing');
    const done = projectAt(project, T0 + QUEUE_MS + 4 * SHOT_MS + EDIT_MS);
    expect(done.status).toBe('done');
    expect(done.result?.url).toBe('/assets/video-uonify-v63/uonify-juego-propuesta-v63.mp4');
    expect(done.result?.charged).toEqual({ amount: 17.92, currency: 'EUR' });
    // El cliente lo lee con la misma función que la respuesta real.
    const read = projectFrom({ project: done }, { destination: 'listing' });
    expect(read?.status).toBe('done');
    expect(read?.result?.generation.provider).toBe('gemini-api');
    expect(projectProgress(projectFrom({ project: generating }, {})!).pct).toBe(28);
  });

  it('descuenta el saldo al terminar y «Rehacer plano» crea una versión nueva', () => {
    const doneAt = T0 + QUEUE_MS + 4 * SHOT_MS + EDIT_MS;
    expect(spentBy(sim(), doneAt - 1)).toBe(0);
    expect(spentBy(sim({ audio: false }), doneAt)).toBe(8.96);
    const retried = sim({ retries: [{ shotId: 'shot-2', startedAt: doneAt + 1000 }] });
    const during = projectAt(retried, doneAt + 2000);
    expect(during.status).toBe('generating');
    expect(during.shots.find(shot => shot.id === 'shot-2')?.status).toBe('generating');
    expect(during.result?.version).toBe(1);
    const after = projectAt(retried, doneAt + 1000 + RETRY_SHOT_MS + EDIT_MS);
    expect(after.status).toBe('done');
    expect(after.result?.version).toBe(2);
    expect(after.result?.charged.amount).toBe(4.48);
    expect(spentBy(retried, doneAt + 1000 + RETRY_SHOT_MS + EDIT_MS)).toBe(22.4);
  });

  it('la propuesta simulada de Uonify pasa la revisión y usa las fotos de la ficha', () => {
    const images = [
      { id: 'main', url: 'https://x/main.jpg', name: 'main.jpg', width: 1600, height: 1600, source: 'upload' as const },
      { id: 'ia', url: 'https://x/ia.jpg', name: 'ia.jpg', width: 1672, height: 941, source: 'ai-generated' as const },
    ];
    for (const destination of ['listing', 'ads'] as const) {
      const data = proposePlan({ destination, product: { name: 'Make It Possible', brand: 'Uonify', bullets: ['25 piezas de madera: tres personajes'] }, images });
      const plan = planFromResponse(data, destination, images);
      expect(plan?.origin).toBe('ia');
      plan?.shots.forEach(shot => expect(lintShot(shot), shot.action).toEqual([]));
      expect(lintClosing(plan?.closing)).toEqual([]);
      expect(plan?.shots[0].image?.id).toBe('main');
      expect(plan?.shots[0].text).toBe('25 piezas de madera');
    }
  });
});

describe('detección de escenas', () => {
  it('marca los picos con al menos 2 s entre escenas y falla si no se leen fotogramas', () => {
    const times = Array.from({ length: 30 }, (_, index) => index);
    const scores = times.map(time => ([6, 7, 15, 22].includes(time) ? 60 : 2));
    expect(findCuts(scores, times, 1, 30)).toEqual([0, 6, 15, 22]);
    expect(() => findCuts(times.map(() => 0), times, 1, 30)).toThrow(/No se pudieron leer los fotogramas/);
  });
});
