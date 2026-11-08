import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pimStore } from '@/shared/pim';
import { dialog, toast } from '@/shared/ui';
import { handlers } from '../mocks/handlers';
import { EDIT_MS, QUEUE_MS, SHOT_MS, projectAt, type SimProject } from '../mocks/simulation';
import { resetBalance } from '../jobs/balance';
import { resetJobs } from '../jobs/jobsStore';
import { applyProject, stopAllPolling } from '../jobs/polling';
import { readLibraryFrom } from '../jobs/scope';
import { projectFrom, resultLine } from '../model/project';
import { readStudio } from '../model/studio';
import { SAMPLE_STUDIO, SKU, renderTab, seed } from './harness';

const server = setupServer(...handlers);
const nbsp = (text: string | null) => String(text).replace(/[\u00a0\u202f]/g, ' ');
const T0 = Date.parse('2026-09-26T10:00:00Z');
const SIM: SimProject = {
  id: 'vp-test', createdAt: T0, sku: SKU, destination: 'listing', format: '16:9', audio: true,
  shots: [{ id: 'shot-1' }, { id: 'shot-2' }, { id: 'shot-3' }, { id: 'shot-4' }], retries: [],
};
const DONE_AT = T0 + QUEUE_MS + 4 * SHOT_MS + EDIT_MS;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  pimStore.clear();
  sessionStorage.clear();
  resetBalance();
  resetJobs();
});
afterEach(() => {
  stopAllPolling();
  act(() => {
    dialog.close();
    toast.dismiss();
  });
  server.resetHandlers();
});
afterAll(() => server.close());

describe('resultado de un vídeo generado', () => {
  it('entra en la biblioteca una sola vez, con las escenas del guion y la línea aprobada', () => {
    const scope = pimStore.scope(SKU);
    seed({ productInfo: { name: 'Make It Possible by Uonify', sku: SKU }, videoStudio: { ...SAMPLE_STUDIO, project: projectFrom({ project: projectAt(SIM, T0) }, { destination: 'listing' }) } });
    applyProject(scope, SIM.id, { project: projectAt(SIM, T0 + QUEUE_MS + SHOT_MS + 1) });
    expect(readLibraryFrom(scope).videos).toHaveLength(0);
    applyProject(scope, SIM.id, { project: projectAt(SIM, DONE_AT) });
    applyProject(scope, SIM.id, { project: projectAt(SIM, DONE_AT + 5000) });
    const library = readLibraryFrom(scope);
    expect(library.videos).toHaveLength(1);
    const video = library.videos[0];
    expect(video.id).toBe(`video-${SIM.id}-1`);
    expect(video.title).toBe('Make It Possible by Uonify');
    expect(video.name).toBe(`${SKU}-ficha.mp4`);
    expect(video.chapters?.map(chapter => chapter.title)).toEqual(SAMPLE_STUDIO.plans.listing?.shots.map(shot => shot.text));
    expect(video.chapters?.map(chapter => chapter.time)).toEqual([0, 7, 14, 21]);
    expect(nbsp(resultLine(video.generation))).toBe('Generado con Veo 3.1 (Gemini API) · con audio · 17,92 € de saldo');
    expect(readStudio(scope.get('videoStudio')).project?.announced).toBe(true);
  });

  it('el estudio enseña el vídeo listo y «Ver en Vídeos del producto» lo elige', async () => {
    const done = projectFrom({ project: projectAt(SIM, DONE_AT) }, { destination: 'listing' });
    seed({
      videoView: 'create',
      videoStudio: { ...SAMPLE_STUDIO, project: done },
      video: { videos: [{ id: `video-${SIM.id}-1`, name: `${SKU}-ficha.mp4`, url: done?.result?.url, poster: '', size: 1, type: 'video/mp4', duration: 26.8, width: 1920, height: 1080, title: 'Vídeo IA', source: 'ai', destination: 'listing', generation: done?.result?.generation }], selectedId: null },
    });
    renderTab();
    expect(screen.getByRole('heading', { name: 'Tu vídeo está listo' })).toBeInTheDocument();
    expect(nbsp(screen.getAllByText(/Generado con Veo 3.1/)[0].textContent)).toBe('Generado con Veo 3.1 (Gemini API) · con audio · 17,92 € de saldo');
    // Con el vídeo listo se puede rehacer cada plano.
    expect(screen.getAllByRole('button', { name: 'Rehacer plano' })).toHaveLength(4);
    await userEvent.click(screen.getByRole('button', { name: 'Ver en Vídeos del producto' }));
    expect(screen.getByRole('tab', { name: 'Vídeos del producto' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { level: 3, name: 'Vídeo IA' })).toBeInTheDocument();
    expect(nbsp(screen.getByText(/Generado con Veo 3.1/).textContent)).toContain('17,92 € de saldo');
  });

  it('cerrar el resultado devuelve el foco a «Generar vídeo»', async () => {
    seed({ videoView: 'create', videoStudio: { ...SAMPLE_STUDIO, project: projectFrom({ project: projectAt(SIM, DONE_AT) }, { destination: 'listing' }) } });
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar el resultado' }));
    expect(screen.queryByRole('heading', { name: 'Tu vídeo está listo' })).toBeNull();
    await screen.findByRole('button', { name: 'Generar vídeo' });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(screen.getByRole('button', { name: 'Generar vídeo' })).toHaveFocus();
  });
});
