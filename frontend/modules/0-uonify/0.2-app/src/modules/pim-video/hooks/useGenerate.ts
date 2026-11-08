import { useCallback, type RefObject } from 'react';
import { usePimScope } from '@/shared/pim';
import { toast } from '@/shared/ui';
import { createProject, type ShotPayload } from '../api/videoApi';
import { acceptTerms, termsRecord } from '../lib/terms';
import { DESTINATIONS, type DestinationSpec } from '../model/constants';
import { planIssues } from '../model/lint';
import { validPlan } from '../model/plan';
import { insufficient, locked, projectFrom, reason } from '../model/project';
import { effectiveFormat } from '../model/studio';
import type { Issue, Shot } from '../model/types';
import { noBalance, refreshBalance } from '../jobs/balance';
import { isBusy, generatingTag, startTask } from '../jobs/jobsStore';
import { startPolling } from '../jobs/polling';
import { exists, writeStudioTo } from '../jobs/scope';
import { askTerms } from '../components/studio/TermsPanel';
import type { StudioApi } from './useVideoData';
import type { ProductView } from './useProductData';

/**
 * «Generar vídeo» (prototipo: pim/video.js, generate) → POST /video/projects. Sin
 * paso de aprobación: el cliente paga con su saldo. La primera vez cada cuenta
 * acepta las condiciones de los modelos de IA; se envían su versión y su fecha.
 */
interface Options {
  root: RefObject<HTMLElement | null>;
  studio: StudioApi;
  productView: ProductView;
  shotPayload: (shot: Shot, index: number, spec: DestinationSpec) => Promise<ShotPayload>;
  focusIssue: (issue: Issue) => void;
}

export function useGenerate({ root, studio, productView, shotPayload, focusIssue }: Options) {
  const scope = usePimScope();
  const { state, resolved, planFor } = studio;
  const { product, savedSku, isNew, pendingSku } = productView;

  return useCallback(async () => {
    if (locked(state) || isBusy(scope.key, generatingTag)) return;
    const plan = resolved;
    const blocking = planIssues(plan).filter(issue => issue.level === 'error');
    if (blocking.length) {
      toast.warning('Revisa el guion antes de generar', { description: blocking[0].message });
      focusIssue(blocking[0]);
      return;
    }
    if (isNew || !savedSku) { toast.info('Guarda el producto antes de generar su vídeo.'); return; }
    if (pendingSku) { toast.info('Guarda el producto antes de generar su vídeo.', { description: 'Has cambiado el SKU y aún no está guardado.' }); return; }
    if (noBalance()) { toast.warning('No tienes saldo', { description: 'Recarga tu saldo para generar vídeos.' }); return; }
    let terms = termsRecord();
    if (!terms) {
      const ok = await askTerms();
      if (!ok) return;
      terms = acceptTerms();
    }
    const target = scope;
    const destination = state.destination;
    const spec = DESTINATIONS[destination];
    const format = effectiveFormat(state);
    const total = spec.shots * spec.shotSeconds + spec.closingSeconds;
    target.set('productInfo', { name: product.name || '', sku: savedSku });
    // El guion con que se genera queda guardado (referencias, no imágenes): el
    // resultado lo usa para las escenas y para rehacer planos.
    const draft = planFor(destination);
    writeStudioTo(target, current => (validPlan(current.plans[destination], destination) ? current : { ...current, plans: { ...current.plans, [destination]: draft } }));
    const done = startTask(target, 'generate');
    try {
      const shots = await Promise.all(plan.shots.map((shot, index) => shotPayload(shot, index, spec)));
      const data = await createProject({
        sku: savedSku,
        destination,
        format,
        audio: state.audio,
        resolution: '1080p',
        shot_seconds: 8,
        final_seconds: total,
        terms_version: terms.version,
        terms_accepted_at: terms.acceptedAt,
        product: { name: product.name || '', brand: product.brand || '' },
        shots,
        closing: { tagline: String(plan.closing?.tagline || '').trim(), brand: product.brand || '', start: spec.shots * spec.shotSeconds, end: total },
      });
      if (!exists(target)) return;
      const project = projectFrom(data, { destination, format, audio: state.audio, createdAt: new Date().toISOString() });
      if (!project) throw new Error('El servicio de vídeo no ha devuelto el vídeo en curso.');
      writeStudioTo(target, current => ({ ...current, project }));
      startPolling(target, project.id);
      toast.success('Generando tu vídeo', { description: 'Puedes seguir trabajando: te avisamos cuando esté listo.' });
      void refreshBalance(true);
    } catch (error) {
      if (insufficient(error)) toast.warning('Saldo insuficiente', { description: 'Recarga tu saldo para generar este vídeo.' });
      else toast.error('No se pudo generar el vídeo', { description: reason(error) });
    } finally {
      done();
      // El botón vuelve a tener el foco si el diálogo o el envío se lo quitaron.
      const button = root.current?.querySelector<HTMLElement>('[data-action="generate"]');
      if (button && root.current && !root.current.contains(document.activeElement)) button.focus({ preventScroll: true });
    }
  }, [state, scope, resolved, planFor, focusIssue, isNew, savedSku, pendingSku, product, shotPayload, root]);
}
