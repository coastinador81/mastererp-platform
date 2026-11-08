import { useCallback, useRef, type RefObject } from 'react';
import { usePimScope, useTabContext } from '@/shared/pim';
import { toast } from '@/shared/ui';
import { proposePlan as requestPlan, retryShot as requestRetry, uploadFile, type ShotPayload } from '../api/videoApi';
import { attr, focusSoon } from '../lib/focus';
import { focusAndReveal, saveFile } from '../lib/media';
import { DESTINATIONS } from '../model/constants';
import { absoluteURL, asArray, isServerURL, stripHTML } from '../model/format';
import { lintShot } from '../model/lint';
import { imageRef, planFromResponse, resolvePlan, resolveImage } from '../model/plan';
import { insufficient, locked, reason, resultVideoId } from '../model/project';
import { effectiveFormat } from '../model/studio';
import type { DestinationSpec } from '../model/constants';
import type { ImageRef, Issue, Shot, StudioState } from '../model/types';
import { noBalance, refreshBalance } from '../jobs/balance';
import { isBusy, startTask } from '../jobs/jobsStore';
import { applyProject, startPolling } from '../jobs/polling';
import { exists, readStudioFrom, writeStudioTo } from '../jobs/scope';
import { openImagePicker } from '../components/studio/ImagePicker';
import { useGenerate } from './useGenerate';
import type { LibraryApi, StudioApi } from './useVideoData';
import type { ProductView } from './useProductData';

/**
 * Acciones de «Crear con Uony» (prototipo: pim/video.js, «acciones: estudio»).
 */
interface Options {
  root: RefObject<HTMLElement | null>;
  studio: StudioApi;
  library: LibraryApi;
  productView: ProductView;
  setView: (view: 'library' | 'create') => void;
}

/** Selector del campo de un aviso del guion. */
export function issueSelector(issue: Issue): string {
  if (issue.shot === 'closing') return '[data-closing-field="tagline"]';
  if (issue.field === 'image') return `[data-action="pick-image"][data-shot="${attr(issue.shot || '')}"]`;
  return `[data-shot-field="${issue.field}"][data-shot="${attr(issue.shot || '')}"]`;
}

export function useStudioActions({ root, studio, library, productView, setView }: Options) {
  const ctx = useTabContext();
  const scope = usePimScope();
  const { state, write, planFor, patchShot } = studio;
  const { product, images, savedSku } = productView;

  const focusIssue = useCallback((issue: Issue) => {
    focusAndReveal(root.current?.querySelector<HTMLElement>(issueSelector(issue)));
  }, [root]);

  // La foto del plano viaja como URL: si solo existe en el navegador, se sube antes.
  const uploaded = useRef(new Map<string, Promise<string>>());
  const remoteImage = useCallback(async (image: ImageRef): Promise<string> => {
    if (isServerURL(image.url)) return absoluteURL(image.url);
    let pending = uploaded.current.get(image.url);
    if (!pending) {
      const type = (image.url.match(/^data:([^;,]+)/) || [])[1] || 'image/jpeg';
      pending = uploadFile(image.url, image.name || 'foto.jpg', type).catch(error => {
        uploaded.current.delete(image.url);
        throw error;
      });
      uploaded.current.set(image.url, pending);
    }
    return pending;
  }, []);
  const shotPayload = useCallback(async (shot: Shot, index: number, spec: DestinationSpec): Promise<ShotPayload> => ({
    id: shot.id,
    position: index + 1,
    image_url: shot.image?.url ? await remoteImage(shot.image) : '',
    image_name: shot.image?.name || '',
    action: String(shot.action || '').trim(),
    camera: shot.camera,
    text: String(shot.text || '').trim(),
    start: index * spec.shotSeconds,
    end: (index + 1) * spec.shotSeconds,
  }), [remoteImage]);

  const setStudio = useCallback((patch: Partial<StudioState>) => {
    if (locked(readStudioFrom(scope))) return;
    write(current => ({ ...current, ...patch }));
  }, [scope, write]);

  const pickImage = useCallback((shotId: string) => {
    if (locked(state)) return;
    const plan = planFor();
    const index = plan.shots.findIndex(shot => shot.id === shotId);
    if (index < 0) return;
    const destination = state.destination;
    openImagePicker({
      shotNumber: index + 1,
      images,
      format: effectiveFormat(state),
      selectedUrl: resolveImage(plan.shots[index].image, images)?.url || '',
      onGoImages: () => ctx.switchTab('imagenes'),
      onPick: image => {
        if (!exists(scope) || locked(readStudioFrom(scope))) return;
        patchShot(destination, shotId, { image: imageRef(image) });
      },
    });
  }, [state, planFor, images, ctx, scope, patchShot]);

  const proposePlan = useCallback(async () => {
    if (locked(state) || isBusy(scope.key, tag => tag === 'propose')) return;
    const target = scope;
    const destination = state.destination;
    const done = startTask(target, 'propose');
    try {
      const data = await requestPlan({
        sku: savedSku || null,
        destination,
        format: effectiveFormat(state),
        language: 'es',
        product: { name: product.name || '', brand: product.brand || '', category: String(product.category || ''), description: stripHTML(product.description).slice(0, 2000), bullets: asArray(product.bullets), keywords: String(product.keywords || '') },
        // Las fotos solo del navegador van por nombre y medidas, sin su contenido.
        images: images.map(({ id, url, name, width, height, source }) => ({ id, name, width, height, source, url: isServerURL(url) ? absoluteURL(url) : null })),
      });
      const plan = planFromResponse(data, destination, images);
      if (!plan) throw new Error('La propuesta no tiene el formato esperado.');
      if (!exists(target) || locked(readStudioFrom(target))) return;
      writeStudioTo(target, current => ({ ...current, plans: { ...current.plans, [destination]: plan } }));
      toast.success('Guion propuesto por Uony', { description: 'Revísalo y ajusta lo que quieras antes de generar.' });
    } catch (error) {
      toast.error('No se pudo proponer el guion', { description: reason(error) });
    } finally {
      done();
    }
  }, [state, scope, savedSku, product, images]);

  const generate = useGenerate({ root, studio, productView, shotPayload, focusIssue });

  const retryShot = useCallback(async (shotId: string) => {
    const project = state.project;
    if (!project || locked(state)) return;
    const tag = `retry:${shotId}`;
    if (isBusy(scope.key, item => item === tag || item === 'generate')) return;
    if (noBalance()) { toast.warning('No tienes saldo', { description: 'Recarga tu saldo para rehacer el plano.' }); return; }
    const plan = resolvePlan(planFor(project.destination), images);
    const index = plan.shots.findIndex(shot => shot.id === shotId);
    if (index < 0) return;
    const blocking = lintShot(plan.shots[index]).filter(issue => issue.level === 'error');
    if (blocking.length) {
      toast.warning('Revisa el plano antes de rehacerlo', { description: blocking[0].message });
      focusIssue({ ...blocking[0], shot: shotId });
      return;
    }
    const target = scope;
    const done = startTask(target, tag);
    try {
      const shot = await shotPayload(plan.shots[index], index, DESTINATIONS[project.destination]);
      const data = await requestRetry(project.id, shotId, { shot, audio: project.audio });
      if (!exists(target)) return;
      applyProject(target, project.id, data);
      startPolling(target, project.id);
      toast.info(`Rehaciendo el plano ${index + 1}`);
      void refreshBalance(true);
    } catch (error) {
      if (insufficient(error)) toast.warning('Saldo insuficiente', { description: 'Recarga tu saldo para rehacer este plano.' });
      else toast.error('No se pudo rehacer el plano', { description: reason(error) });
    } finally {
      done();
    }
  }, [state, scope, planFor, images, focusIssue, shotPayload]);

  const openResult = useCallback(() => {
    const project = state.project;
    if (!project?.result) return;
    const id = resultVideoId(project);
    if (library.videos.some(video => video.id === id)) library.select(id);
    setView('library');
  }, [state.project, library, setView]);

  const downloadResult = useCallback(() => {
    const result = state.project?.result;
    if (result) void saveFile(result.url, result.fileName || `${savedSku || 'video'}.mp4`);
  }, [state.project, savedSku]);

  const dismissProject = useCallback(() => {
    const project = state.project;
    if (!project || locked(state)) return;
    write(current => ({ ...current, project: null }));
    focusSoon(root, ['[data-action="generate"]']);
  }, [state, write, root]);

  /** Ir al destino del vídeo en curso (desde el aviso «Ir a …»). */
  const goToDestination = useCallback((destination: StudioState['destination']) => {
    if (state.destination !== destination) setStudio({ destination });
  }, [state.destination, setStudio]);

  return { setStudio, pickImage, proposePlan, generate, retryShot, openResult, downloadResult, dismissProject, goToDestination, focusIssue };
}

export type StudioActions = ReturnType<typeof useStudioActions>;
