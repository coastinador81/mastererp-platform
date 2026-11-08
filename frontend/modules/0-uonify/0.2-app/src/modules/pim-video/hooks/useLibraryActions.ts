import { useCallback, type RefObject } from 'react';
import { usePimScope } from '@/shared/pim';
import { dialog, toast } from '@/shared/ui';
import { uid } from '@/shared/lib';
import { sendAdsAsset, uploadFile } from '../api/videoApi';
import { focusSoon } from '../lib/focus';
import { focusAndReveal, frameToDataURL, imageFileToDataURL, readVideoFile, releaseBlob, saveFile, trackBlob } from '../lib/media';
import { detectScenes } from '../lib/scenes';
import { AMAZON_ADS_CONNECTED, LISTING_MAX_BYTES, POSTER_WIDTH } from '../model/constants';
import { asArray, formatTime, isVideoFile } from '../model/format';
import { reason } from '../model/project';
import { missingRequirements, missingSummary, requirements } from '../model/requirements';
import type { RequirementRow, VideoItem, VideoLibrary } from '../model/types';
import { cancelDetection, detectionFor, endDetection, isBusy, setDetectionProgress, startDetection, startTask } from '../jobs/jobsStore';
import { exists, writeLibraryTo } from '../jobs/scope';
import { openSellerCentralDialog } from '../components/library/SellerCentralPanel';
import type { LibraryApi } from './useVideoData';
import type { ProductView } from './useProductData';

/**
 * Acciones de «Vídeos del producto» (prototipo: pim/video.js, «acciones: biblioteca»).
 */
interface Options {
  root: RefObject<HTMLElement | null>;
  player: RefObject<HTMLVideoElement | null>;
  library: LibraryApi;
  productView: ProductView;
  checksHeadingId: string;
}

export const fileNameOf = (video: Pick<VideoItem, 'name'>, sku: string): string => video.name || `${sku || 'video'}.mp4`;

export function useLibraryActions({ root, player, library, productView, checksHeadingId }: Options) {
  const scope = usePimScope();
  const { savedSku, asin, isNew, pendingSku } = productView;
  const { current, write, patchVideo } = library;

  const addVideo = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (!isVideoFile(file)) { toast.error('Formato no admitido', { description: 'Sube un vídeo MP4 o MOV.' }); return; }
    if (file.size > LISTING_MAX_BYTES) { toast.error('El vídeo supera los 5 GB que admite Amazon.'); return; }
    const target = scope;
    const url = trackBlob(URL.createObjectURL(file));
    const toastId = toast.loading('Preparando el vídeo…');
    const video: VideoItem = {
      id: uid('video'), name: file.name, url, poster: '', size: file.size,
      type: file.type || (/\.mov$/i.test(file.name) ? 'video/quicktime' : 'video/mp4'),
      duration: 0, width: 0, height: 0,
      title: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim(),
      source: 'upload', destination: 'listing', language: 'es', chapters: [],
    };
    let readable = true;
    try {
      Object.assign(video, await readVideoFile(url));
    } catch {
      readable = false;
      video.unreadable = true;
    }
    // El producto se eliminó mientras se leía: no hay dónde guardarlo.
    if (!exists(target)) { releaseBlob(url); toast.dismiss(toastId); return; }
    // Se guarda aunque se haya cambiado de pestaña: el aviso ya lo da por añadido.
    writeLibraryTo(target, state => ({ ...state, videos: [...state.videos, video], selectedId: video.id }));
    target.set('videoView', 'library');
    if (readable) toast.success('Vídeo añadido', { id: toastId, description: `${formatTime(video.duration)} · ${video.width} × ${video.height}` });
    else toast.warning('Vídeo añadido sin vista previa', { id: toastId, description: 'El navegador no puede leer este archivo, así que no se puede comprobar su resolución para Amazon. Prueba con un MP4 (H.264).' });
  }, [scope]);

  const deleteVideo = useCallback(async (id: string) => {
    const video = library.videos.find(item => item.id === id);
    if (!video) return;
    const ok = await dialog.confirm({ title: '¿Eliminar este vídeo?', description: video.name, confirmLabel: 'Eliminar', destructive: true });
    if (!ok) return;
    cancelDetection(scope.key, id);
    write(state => {
      const videos = state.videos.filter(item => item.id !== id);
      return { videos, selectedId: state.selectedId === id ? videos[0]?.id || null : state.selectedId };
    });
    releaseBlob(video.url);
    toast.success('Vídeo eliminado');
    focusSoon(root, ['[data-action="upload"]', '[data-action="generate"]', '.pim-video-views [aria-selected="true"]']);
  }, [library.videos, scope, write, root]);

  const runDetection = useCallback(async () => {
    const video = current;
    if (!video) return;
    const running = detectionFor(scope.key);
    if (running) {
      if (running.videoId !== video.id) toast.info('Ya se están detectando las escenas de otro vídeo', { description: 'Cuando termine, podrás detectar las de este.' });
      return;
    }
    if (asArray(video.chapters).length) {
      const ok = await dialog.confirm({ title: '¿Volver a detectar las escenas?', description: 'Se sustituyen las escenas actuales; las que coincidan en el tiempo conservan su título.', confirmLabel: 'Detectar escenas' });
      if (!ok) return;
    }
    const job = startDetection(scope, video.id);
    try {
      const result = await detectScenes(video, { cancelled: () => job.control.cancelled, onProgress: value => setDetectionProgress(job.id, value) });
      // El vídeo (o el producto) se eliminó mientras tanto: no hay dónde guardar.
      const stillThere = asArray<VideoItem>(job.scope.get<VideoLibrary | null>('video', null)?.videos).some(item => item.id === video.id);
      if (!result || !exists(job.scope) || !stillThere) return;
      job.scope.update<VideoLibrary | null>('video', saved => ({ ...(saved || { selectedId: null }), videos: asArray<VideoItem>(saved?.videos).map(item => (item.id === video.id ? { ...item, chapters: result.chapters } : item)) }), null);
      const n = result.chapters.length;
      toast.success(`${n} escena${n === 1 ? '' : 's'} detectada${n === 1 ? '' : 's'}`);
    } catch (error) {
      toast.error('No se pudieron detectar las escenas', { description: reason(error) });
    } finally {
      endDetection(job.id);
    }
  }, [current, scope]);

  const posterFromFrame = useCallback(() => {
    const element = player.current;
    if (!current || !element) return;
    if (element.readyState < 2) { toast.info('Reproduce el vídeo o elige una escena para capturar su fotograma.'); return; }
    try {
      const poster = frameToDataURL(element, POSTER_WIDTH);
      patchVideo(current.id, { poster });
      toast.success('Miniatura actualizada', { description: `Fotograma de ${formatTime(element.currentTime)}` });
    } catch (error) {
      toast.error('No se pudo capturar el fotograma.', { description: (error as Error)?.name === 'SecurityError' ? reason(error) : undefined });
    }
  }, [current, player, patchVideo]);

  const posterFromFile = useCallback(async (file: File | undefined) => {
    if (!current || !file) return;
    if (!/^image\/(jpeg|png)$/.test(file.type)) { toast.error('Formato no admitido', { description: 'Usa una imagen JPG o PNG.' }); return; }
    try {
      const poster = await imageFileToDataURL(file);
      patchVideo(current.id, { poster });
      toast.success('Miniatura actualizada');
    } catch {
      toast.error('No se pudo leer la imagen.');
    }
  }, [current, patchVideo]);

  const focusChecks = useCallback((missing: RequirementRow[]) => {
    toast.warning('Revisa los requisitos de Amazon', { description: missingSummary(missing) });
    focusAndReveal(root.current?.querySelector<HTMLElement>(`[id="${checksHeadingId}"]`));
  }, [root, checksHeadingId]);

  const download = useCallback(() => {
    if (current) void saveFile(current.url, fileNameOf(current, savedSku));
  }, [current, savedSku]);

  const openSellerCentral = useCallback(() => {
    if (!current) return;
    const missing = missingRequirements(requirements(current, asin));
    if (missing.length) { focusChecks(missing); return; }
    openSellerCentralDialog({ video: current, asin, fileName: fileNameOf(current, savedSku) });
  }, [current, asin, savedSku, focusChecks]);

  const sendToAds = useCallback(async () => {
    const video = current;
    if (!video) return;
    const missing = missingRequirements(requirements(video));
    if (missing.length) { focusChecks(missing); return; }
    if (isNew || !savedSku) { toast.info('Guarda el producto antes de enviar su vídeo.'); return; }
    if (pendingSku) { toast.info('Guarda el producto antes de enviar su vídeo.', { description: 'Has cambiado el SKU y aún no está guardado.' }); return; }
    const tag = `ads:${video.id}`;
    if (isBusy(scope.key, item => item === tag)) return;
    const done = startTask(scope, tag);
    const toastId = toast.loading('Enviando el vídeo a Amazon Ads…');
    try {
      // Un vídeo que solo existe en el navegador se sube antes y viaja su URL.
      const videoUrl = /^(blob|data):/.test(video.url) ? await uploadFile(video.url, fileNameOf(video, savedSku), video.type) : new URL(video.url, location.href).href;
      await sendAdsAsset({ sku: savedSku, name: String(video.title || video.name).trim(), file_name: fileNameOf(video, savedSku), content_type: video.type, file_size: video.size, duration: video.duration, width: video.width, height: video.height, video_url: videoUrl });
      toast.success('Vídeo enviado a Amazon Ads', { id: toastId, description: 'Amazon lo revisa antes de usarlo en tus anuncios: hasta 3 días hábiles.' });
    } catch (error) {
      toast.error('No se pudo enviar el vídeo', { id: toastId, description: reason(error) });
    } finally {
      done();
    }
  }, [current, focusChecks, isNew, savedSku, pendingSku, scope]);

  // Decisión del dueño: sin conexión con Amazon Ads, se descarga listo para subirlo allí.
  const downloadForAds = useCallback(() => {
    const video = current;
    if (!video) return;
    const missing = missingRequirements(requirements(video));
    if (missing.length) { focusChecks(missing); return; }
    void saveFile(video.url, fileNameOf(video, savedSku));
    toast.success('Vídeo listo para Amazon Ads', { description: 'Súbelo a tu biblioteca de recursos de Amazon Ads. Amazon lo revisa antes de usarlo en tus anuncios: hasta 3 días hábiles.' });
  }, [current, focusChecks, savedSku]);

  return {
    addVideo,
    deleteVideo,
    runDetection,
    posterFromFrame,
    posterFromFile,
    download,
    openSellerCentral,
    adsAction: AMAZON_ADS_CONNECTED ? sendToAds : downloadForAds,
  };
}
