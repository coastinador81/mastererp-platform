import { http } from 'msw';
import { API_BASE } from '@/shared/api/config';
import { collection, record } from '@/shared/mocks/db';
import { HttpResponse, fail, latency, mock } from '@/shared/mocks/utils';
import { uid } from '@/shared/lib';
import { PATHS } from '../model/constants';
import { INITIAL_BALANCE } from './fixtures/sampleVideo';
import { proposePlan } from './fixtures/proposal';
import { projectAt, projectCost, retryDoneAt, shotPrice, spentBy, type SimProject } from './simulation';

/**
 * Simulación MSW del servidor de vídeo (contrato para el backend). Éxito por defecto,
 * con latencia y progreso: cada vídeo avanza con el tiempo (mocks/simulation.ts) y
 * devuelve el vídeo de muestra del producto de ejemplo. Datos en sessionStorage.
 *
 * GET  /billing/balance lo simula ahora el módulo billing (mismo contrato { amount, currency }).
 * POST /video/plans                             → { plan: { shots[], closing }, model }
 * POST /video/projects                           → { project } (402 si no hay saldo)
 * GET  /video/projects/:id                       → { project }
 * POST /video/projects/:id/shots/:shot/retry     → { project }
 * POST /uploads                                  → { upload_url, url } (URL firmada)
 * PUT  /uploads/:id/file · GET /uploads/:id      → subida y descarga del archivo
 * POST /amazon/ads/assets                        → { asset_id, status: 'PENDING_REVIEW' }
 */

const projects = collection<SimProject>('video-projects');
const ledger = record<{ topUps: number }>('video-balance', () => ({ topUps: 0 }));
const assets = collection<{ id: string; sku: string; name: string; video_url: string; createdAt: string }>('amazon-ads-assets');
/** Archivos subidos en esta carga de la página (los blobs no caben en sessionStorage). */
const files = new Map<string, Blob>();

function balanceAt(now: number): number {
  const spent = projects.all().reduce((total, sim) => total + spentBy(sim, now), 0);
  return Math.round((INITIAL_BALANCE + ledger.get().topUps - spent) * 100) / 100;
}

/** Saldo que ya está comprometido por vídeos en curso (aún sin descontar). */
function reservedAt(now: number): number {
  return projects.all().reduce((total, sim) => {
    const pending = sim.retries.filter(retry => now < retryDoneAt(retry)).length * shotPrice(sim.audio);
    return total + pending + (spentBy(sim, now) === 0 ? projectCost(sim.shots.length, sim.audio) : 0);
  }, 0);
}

interface ProjectBody {
  sku?: string;
  destination?: string;
  format?: string;
  audio?: boolean;
  shots?: { id?: string }[];
  terms_version?: string;
  terms_accepted_at?: string;
}

const origin = () => (typeof location === 'undefined' ? 'http://localhost' : location.origin);

export const handlers = [
  http.post(mock(PATHS.plans), async ({ request }) => {
    const body = (await request.json()) as Parameters<typeof proposePlan>[0];
    // El modelo de texto tarda unos segundos en proponer el guion.
    await latency(2200);
    return HttpResponse.json(proposePlan(body));
  }),

  http.post(mock(PATHS.projects), async ({ request }) => {
    const body = (await request.json()) as ProjectBody;
    await latency(900);
    if (!body.terms_version || !body.terms_accepted_at) return fail(400, 'Acepta las condiciones de los modelos de IA para generar vídeos.', 'terms_required');
    const shots = (body.shots || []).filter(shot => shot?.id).map(shot => ({ id: String(shot.id) }));
    if (!shots.length) return fail(400, 'El guion no tiene planos.', 'invalid_plan');
    const audio = body.audio !== false;
    const now = Date.now();
    if (balanceAt(now) - reservedAt(now) < projectCost(shots.length, audio)) {
      return fail(402, 'No tienes saldo suficiente para generar este vídeo.', 'insufficient_balance');
    }
    const sim: SimProject = {
      id: uid('vp'),
      createdAt: now,
      sku: String(body.sku || ''),
      destination: body.destination === 'ads' ? 'ads' : 'listing',
      format: body.format === '9:16' ? '9:16' : '16:9',
      audio,
      shots,
      retries: [],
    };
    projects.upsert(sim);
    return HttpResponse.json({ project: projectAt(sim, now) }, { status: 201 });
  }),

  http.get(mock(`${PATHS.projects}/:id`), async ({ params }) => {
    await latency(250);
    const sim = projects.get(String(params.id));
    if (!sim) return fail(404, 'Este vídeo ya no existe.', 'not_found');
    return HttpResponse.json({ project: projectAt(sim, Date.now()) });
  }),

  http.post(mock(`${PATHS.projects}/:id/shots/:shot/retry`), async ({ params }) => {
    await latency(700);
    const sim = projects.get(String(params.id));
    if (!sim) return fail(404, 'Este vídeo ya no existe.', 'not_found');
    const shotId = String(params.shot);
    if (!sim.shots.some(shot => shot.id === shotId)) return fail(404, 'Ese plano no existe.', 'not_found');
    const now = Date.now();
    const current = projectAt(sim, now);
    if (current.status !== 'done') return fail(409, 'Espera a que termine el vídeo en curso.', 'busy');
    if (balanceAt(now) - reservedAt(now) < shotPrice(sim.audio)) {
      return fail(402, 'No tienes saldo suficiente para rehacer este plano.', 'insufficient_balance');
    }
    const next = projects.patch(sim.id, { retries: [...sim.retries, { shotId, startedAt: now }] }) || sim;
    return HttpResponse.json({ project: projectAt(next, now) });
  }),

  http.post(mock(PATHS.uploads), async ({ request }) => {
    const body = (await request.json()) as { file_name?: string; content_type?: string; size?: number };
    await latency(350);
    if (!body.file_name || !body.size) return fail(400, 'Falta el archivo que quieres subir.', 'invalid_upload');
    const id = uid('up');
    return HttpResponse.json({
      upload_url: `${origin()}${API_BASE}${PATHS.uploads}/${id}/file`,
      url: `${origin()}${API_BASE}${PATHS.uploads}/${id}`,
      expires_in: 900,
    });
  }),

  http.put(mock(`${PATHS.uploads}/:id/file`), async ({ params, request }) => {
    const blob = await request.blob();
    await latency(600);
    files.set(String(params.id), blob);
    return new HttpResponse(null, { status: 200 });
  }),

  http.get(mock(`${PATHS.uploads}/:id`), ({ params }) => {
    const blob = files.get(String(params.id));
    if (!blob) return fail(404, 'Este archivo ya no está disponible.', 'not_found');
    return new HttpResponse(blob, { headers: { 'Content-Type': blob.type || 'application/octet-stream' } });
  }),

  http.post(mock(PATHS.adsAssets), async ({ request }) => {
    const body = (await request.json()) as { sku?: string; name?: string; video_url?: string };
    await latency(1200);
    if (!body.video_url) return fail(400, 'Falta la URL del vídeo.', 'invalid_asset');
    const asset = { id: uid('ads-asset'), sku: String(body.sku || ''), name: String(body.name || ''), video_url: body.video_url, createdAt: new Date().toISOString() };
    assets.upsert(asset);
    return HttpResponse.json({ asset_id: asset.id, status: 'PENDING_REVIEW' }, { status: 201 });
  }),
];
