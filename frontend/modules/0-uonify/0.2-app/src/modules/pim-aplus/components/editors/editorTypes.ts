import type { ModuleOf, ModuleType } from '../../model/types';

/** Diálogos que abre un editor (los pinta la tarjeta del módulo). */
export interface EditorDialogs {
  /** «Cargar imagen» del hueco (sección `index` en cuatro imágenes). */
  openUpload: (index: number | null) => void;
  /** Vista previa del módulo. */
  openPreview: () => void;
  /** Generador de contenido de Uony (superposición de texto). */
  openAi: () => void;
}

export interface EditorProps<T extends ModuleType> {
  module: ModuleOf<T>;
  /** Prefijo de ids del módulo (etiquetas, contadores, descripciones). */
  dom: string;
  dialogs: EditorDialogs;
}
