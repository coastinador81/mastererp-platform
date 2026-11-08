import type { HelpArticle } from '../model/types';

/**
 * Artículo tal como se escribe en el repositorio (formato de Rentprivé: Markdown con
 * `## Pregunta` + respuesta, y su ficha de metadatos). content/index.ts completa el resto.
 */
export type ArticleSeed = Pick<HelpArticle, 'slug' | 'title' | 'summary' | 'body' | 'keywords' | 'assistantNotes' | 'order' | 'views'> & {
  collection: string;
  topic: string;
};
