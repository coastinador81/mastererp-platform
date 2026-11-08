/**
 * Artículos iniciales del centro de ayuda. Son la semilla del servidor simulado y
 * el contenido que el centro público pinta al instante (y en el prerender) mientras
 * llega la versión del servidor, que admin puede editar.
 */
import type { HelpArticle } from '../model/types';
import { AMAZON } from './articles/amazon';
import { CUENTA } from './articles/cuenta';
import { DRIVE } from './articles/drive';
import { ESTUDIO } from './articles/estudio';
import { PLANES } from './articles/planes';
import { PRIMEROS_PASOS } from './articles/primeros-pasos';
import { PROYECTO_GOOGLE } from './articles/proyecto-google';
import { UONY } from './articles/uony';
import type { ArticleSeed } from './types';

export { SEED_COLLECTIONS } from './collections';

/** Fecha de la última revisión de los artículos iniciales. */
export const CONTENT_UPDATED_AT = '2026-10-23';

function toArticle(seed: ArticleSeed): HelpArticle {
  const { collection, topic, body, ...rest } = seed;
  return {
    ...rest,
    body: body.trim(),
    metadata: { collection, audience: 'seller', topic, plan: 'all', status: 'published', updatedAt: CONTENT_UPDATED_AT },
    helpful: 0,
    notHelpful: 0,
  };
}

export const SEED_ARTICLES: HelpArticle[] = [
  ...PRIMEROS_PASOS, ...UONY, ...DRIVE, ...PROYECTO_GOOGLE, ...ESTUDIO, ...AMAZON, ...PLANES, ...CUENTA,
].map(toArticle);
