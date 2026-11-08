import { ACTION_DRAFTS, ACTION_MAX, CAMERAS, CAMERA_DRAFTS, DESTINATIONS, TEXT_MAX } from './constants';
import { asArray, clip, isServerURL } from './format';
import type { Destination, ImageRef, Plan, ProductData, Shot } from './types';

/**
 * Guion por planos (prototipo: pim/video.js): referencias a las fotos, borrador desde
 * la ficha y lectura de la propuesta de Uony (POST /video/plans).
 */

interface ImageLike {
  id?: unknown;
  url?: unknown;
  name?: unknown;
  width?: unknown;
  height?: unknown;
  source?: unknown;
}

/**
 * Lo que un plano guarda de su foto: una referencia (nunca una data: URL, que
 * llenaría el almacén de la sesión). La foto se resuelve con las de la ficha.
 */
export function imageRef(image: ImageLike | null | undefined): ImageRef | null {
  if (!image) return null;
  return {
    id: String(image.id || image.url || ''),
    url: isServerURL(image.url) ? String(image.url) : '',
    name: String(image.name || ''),
    width: Number(image.width) || 0,
    height: Number(image.height) || 0,
    source: image.source === 'ai-generated' ? 'ai-generated' : 'upload',
  };
}

export function resolveImage(ref: ImageRef | null | undefined, images: ImageRef[]): ImageRef | null {
  if (!ref) return null;
  const found = images.find(image => image.id === ref.id) || (ref.url ? images.find(image => image.url === ref.url) : undefined);
  if (found) return found;
  return ref.url ? { ...ref } : null;
}

export const resolveShot = (shot: Shot, images: ImageRef[]): Shot => ({ ...shot, image: resolveImage(shot.image, images) });

export const resolvePlan = (plan: Plan, images: ImageRef[]): Plan => ({ ...plan, shots: plan.shots.map(shot => resolveShot(shot, images)) });

/**
 * Fotos de la ficha para el guion: galería (subidas, procesadas y de IA) y la imagen
 * del catálogo si la galería no la trae ya. Solo https, rutas de este origen o
 * data:image (las blob: no sobreviven a una recarga).
 */
export function collectProductImages(product: ProductData, slices: { images?: unknown; processedImages?: unknown; aiImages?: unknown }): ImageRef[] {
  const seen = new Set<string>();
  const list: ImageRef[] = [...asArray<Record<string, unknown>>(slices.images), ...asArray<Record<string, unknown>>(slices.processedImages), ...asArray<Record<string, unknown>>(slices.aiImages)]
    .map(image => {
      const dimensions = (image?.dimensions ?? {}) as { width?: unknown; height?: unknown };
      return {
        id: String(image?.id || image?.url || ''),
        url: String(image?.url || ''),
        name: String(image?.name || ''),
        width: Number(dimensions.width) || 0,
        height: Number(dimensions.height) || 0,
        source: image?.source === 'ai-generated' ? 'ai-generated' : 'upload',
      } satisfies ImageRef;
    });
  if (product.image) list.push({ id: String(product.image), url: String(product.image), name: 'Imagen principal', width: 0, height: 0, source: 'upload' });
  return list.filter(image => {
    if (!(isServerURL(image.url) || /^data:image\//.test(image.url)) || seen.has(image.url)) return false;
    seen.add(image.url);
    return true;
  });
}

/**
 * Borrador del guion con los datos de la ficha (sin IA): una foto por plano, los
 * textos salen de las viñetas y el cierre lleva la marca.
 */
export function draftPlan(destination: Destination, product: ProductData = {}, images: ImageLike[] = []): Plan {
  const spec = DESTINATIONS[destination] || DESTINATIONS.listing;
  const seen = new Set<unknown>();
  const pool = [images[0], ...images.filter(image => image?.source === 'ai-generated'), ...images.slice(1)]
    .filter((image): image is ImageLike => {
      if (!image?.url || seen.has(image.url)) return false;
      seen.add(image.url);
      return true;
    });
  // Corta en «:» o al final de una frase, nunca en «10.000 mAh» ni en «1.5 pulgadas».
  const bullets = asArray(product.bullets).map(bullet => String(bullet || '').split(/:\s|:$|\.\s+(?=\p{Lu})|\.$/u)[0]).filter(Boolean);
  const texts = (bullets.length ? bullets : [product.name || '']).map(text => clip(text, TEXT_MAX));
  const drafts = ACTION_DRAFTS[destination] || ACTION_DRAFTS.listing;
  return {
    origin: 'ficha',
    destination,
    shots: Array.from({ length: spec.shots }, (_, index) => ({
      id: `shot-${index + 1}`,
      image: pool.length ? imageRef(pool[index % pool.length]) : null,
      action: drafts[index] || drafts[0],
      camera: CAMERA_DRAFTS[index % CAMERA_DRAFTS.length],
      text: texts[index] || '',
    })),
    closing: { tagline: clip(product.brand || '', TEXT_MAX) },
  };
}

export function validPlan(plan: unknown, destination: Destination): plan is Plan {
  const candidate = plan as Partial<Plan> | null | undefined;
  return Boolean(candidate && Array.isArray(candidate.shots)
    && candidate.shots.length === (DESTINATIONS[destination] || DESTINATIONS.listing).shots
    && candidate.shots.every(shot => shot && shot.id));
}

interface RawShot {
  image_id?: unknown;
  image_url?: unknown;
  action?: unknown;
  camera?: unknown;
  text?: unknown;
}

/** Lo que devuelve «Proponer con Uony» (POST /video/plans), en el formato del guion. */
export function planFromResponse(data: unknown, destination: Destination, images: ImageRef[]): Plan | null {
  const wrapper = data as { plan?: unknown } | null | undefined;
  const source = (wrapper?.plan || data) as { shots?: unknown; closing?: { tagline?: unknown } } | null | undefined;
  const spec = DESTINATIONS[destination];
  if (!source || !Array.isArray(source.shots) || source.shots.length < spec.shots) return null;
  return {
    origin: 'ia',
    destination,
    shots: (source.shots as RawShot[]).slice(0, spec.shots).map((shot, index) => {
      const found = images.find(image => (shot?.image_id && image.id === String(shot.image_id)) || (shot?.image_url && image.url === shot.image_url));
      return {
        id: `shot-${index + 1}`,
        image: found ? imageRef(found) : isServerURL(shot?.image_url) ? imageRef({ url: shot.image_url }) : null,
        action: String(shot?.action || '').slice(0, ACTION_MAX),
        camera: CAMERAS.some(([id]) => id === shot?.camera) ? String(shot.camera) : CAMERA_DRAFTS[index % CAMERA_DRAFTS.length],
        text: clip(shot?.text || '', TEXT_MAX),
      };
    }),
    closing: { tagline: clip(source.closing?.tagline || '', TEXT_MAX) },
  };
}

/** Duración total del guion (planos + cierre). */
export const planSeconds = (destination: Destination): number => {
  const spec = DESTINATIONS[destination];
  return spec.shots * spec.shotSeconds + spec.closingSeconds;
};
