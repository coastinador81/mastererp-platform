import { download } from '@/shared/lib';
import { POSTER_WIDTH } from '../model/constants';
import { crossOrigin, isServerURL } from '../model/format';

/**
 * Vídeo en el navegador (prototipo: pim/video.js): archivos de esta carga de la
 * página, lectura de metadatos y fotogramas, y descargas. No habla con el backend:
 * los archivos multimedia se piden directamente a su URL.
 */

/** blob: creadas en esta carga de la página (tras recargar ya no existen). */
const liveBlobs = new Set<string>();

export function trackBlob(url: string): string {
  liveBlobs.add(url);
  return url;
}

export function releaseBlob(url: string): void {
  if (!url.startsWith('blob:')) return;
  URL.revokeObjectURL(url);
  liveBlobs.delete(url);
}

/** Si el navegador aún puede abrir la URL. */
export const alive = (url: unknown): boolean =>
  typeof url === 'string' && url !== '' && (!url.startsWith('blob:') || liveBlobs.has(url));

/** Espera un evento del elemento (o su error / el tiempo máximo). */
export function once(target: HTMLMediaElement, type: string, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (ok: boolean) => () => {
      clearTimeout(timer);
      target.removeEventListener(type, onOk);
      target.removeEventListener('error', onError);
      if (ok) resolve();
      else reject(new Error('No se pudo leer el vídeo.'));
    };
    const onOk = done(true);
    const onError = done(false);
    const timer = setTimeout(done(false), timeout);
    target.addEventListener(type, onOk);
    target.addEventListener('error', onError);
  });
}

/** Salta a un momento y espera al fotograma (máx. 1,5 s). */
export function seek(element: HTMLMediaElement, time: number): Promise<void> {
  return new Promise(resolve => {
    const done = () => {
      clearTimeout(timer);
      element.removeEventListener('seeked', done);
      resolve();
    };
    const timer = setTimeout(done, 1500);
    element.addEventListener('seeked', done);
    element.currentTime = time;
  });
}

// Saltar dentro del vídeo (escenas, fotogramas) exige que el servidor sirva partes
// del archivo (HTTP Range). Si no lo hace, el vídeo se carga entero una vez y se
// reproduce desde memoria.
const wholeFiles = new Map<string, Promise<string>>();

export const cannotSeek = (element: HTMLMediaElement): boolean =>
  !element.seekable.length || element.seekable.end(element.seekable.length - 1) < element.duration - 0.5;

export function wholeFile(url: string): Promise<string> {
  if (/^(blob|data):/.test(url)) return Promise.resolve(url);
  let promise = wholeFiles.get(url);
  if (!promise) {
    promise = fetch(url)
      .then(response => {
        if (!response.ok) throw new Error('No se pudo descargar el vídeo.');
        return response.blob();
      })
      .then(blob => trackBlob(URL.createObjectURL(blob)));
    promise.catch(() => wholeFiles.delete(url));
    wholeFiles.set(url, promise);
  }
  return promise;
}

/** <video> oculto para leer metadatos y fotogramas. */
export function probeVideo(url: string): HTMLVideoElement {
  const probe = document.createElement('video');
  probe.muted = true;
  probe.playsInline = true;
  probe.preload = 'auto';
  if (crossOrigin(url)) probe.crossOrigin = 'anonymous'; // para poder leer fotogramas
  probe.src = url;
  return probe;
}

export async function seekableProbe(url: string): Promise<HTMLVideoElement> {
  const probe = probeVideo(url);
  await once(probe, 'loadeddata', 20000);
  if (!cannotSeek(probe)) return probe;
  probe.src = await wholeFile(url);
  await once(probe, 'loadeddata', 20000);
  return probe;
}

export function disposeProbe(probe: HTMLVideoElement): void {
  probe.removeAttribute('src');
  probe.load();
}

/** Fotograma actual como JPEG (miniaturas y escenas). */
export function frameToDataURL(source: HTMLVideoElement, width: number, quality = 0.82): string {
  const ratio = source.videoWidth && source.videoHeight ? source.videoHeight / source.videoWidth : 9 / 16;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  canvas.height = Math.round(width * ratio);
  canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

/** Imagen JPG/PNG elegida como miniatura, reducida y en JPEG. */
export async function imageFileToDataURL(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const width = Math.min(POSTER_WIDTH * 1.33, image.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width);
    canvas.height = Math.round(width * image.naturalHeight / image.naturalWidth);
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Metadatos de un vídeo recién elegido y su miniatura (fotograma cercano al segundo 1). */
export async function readVideoFile(url: string): Promise<{ duration: number; width: number; height: number; poster: string }> {
  const probe = probeVideo(url);
  try {
    await once(probe, 'loadeddata', 20000);
    const info = { duration: Math.round(probe.duration * 10) / 10, width: probe.videoWidth, height: probe.videoHeight };
    await seek(probe, Math.min(1, probe.duration / 10));
    return { ...info, poster: frameToDataURL(probe, POSTER_WIDTH) };
  } finally {
    disposeProbe(probe);
  }
}

/**
 * Descarga sin salir de la aplicación: un archivo de otro origen se trae como blob
 * (el atributo download no vale entre orígenes); si no se puede, se abre aparte.
 */
export async function saveFile(url: string, name: string): Promise<void> {
  if (!url) return;
  if (!/^(blob|data):/.test(url) && !isServerURL(url)) return;
  if (!crossOrigin(url)) {
    download(url, name);
    return;
  }
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('download');
    const local = URL.createObjectURL(await response.blob());
    download(local, name);
    setTimeout(() => URL.revokeObjectURL(local), 1000);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

/** Movimiento reducido (sistema o cuenta), para desplazar sin animación. */
export const prefersStill = (): boolean =>
  (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  || document.documentElement.dataset.reduceMotion === 'true';

/** Lleva el foco a un elemento y lo centra en pantalla. */
export function focusAndReveal(element: HTMLElement | null | undefined): void {
  if (!element) return;
  element.focus({ preventScroll: true });
  element.scrollIntoView?.({ behavior: prefersStill() ? 'auto' : 'smooth', block: 'center' });
}
