import type { EditableModuleType, ModuleType } from './types';

/** Imagen de respaldo mientras una imagen no carga (APlusImageWithFallback). */
export const PROCESSING_PLACEHOLDER = 'https://placehold.co/300x300/e5e7eb/6b7280?text=Procesando...';
/** useAplusCache: 30 minutos para el contenido de Amazon. */
export const CACHE_TTL = 1000 * 60 * 30;
/** useAplusCache: escritura diferida de 1 segundo. */
export const DEBOUNCE_DELAY = 1000;
/** apiService: tiempo máximo de cada petición A+. */
export const REQUEST_TIMEOUT = 300000;
export const LOAD_TOAST_ID = 'load-aplus-toast';

/** Límites de cada editor (constantes de validación de los tres módulos). */
export const TO = { headline: 70, body: 300, minW: 970, minH: 300 } as const;
export const SP = {
  main: 200,
  blockHeadline: 100,
  subtitle: 80,
  body: 500,
  bullet: 120,
  minW: 300,
  minH: 300,
  maxBlocks: 2,
  maxBullets: 8,
} as const;
export const FI = { general: 160, headline: 80, body: 200, minW: 220, minH: 220 } as const;

/** Normas de imagen de Amazon A+ (utils/aplusImageUpload.ts). */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const ALLOWED_IMAGE_FORMATS: readonly string[] = ['image/jpeg', 'image/jpg', 'image/png', 'image/bmp'];
export const IMAGE_ACCEPT = 'image/jpeg,image/jpg,image/png,image/bmp';

export interface ModuleTypeInfo {
  id: EditableModuleType;
  title: string;
  description: string;
  icon: string;
  tone: string;
  requirements: string;
}

// APlusContentInterface.tsx 123-148
export const MODULE_TYPES: readonly ModuleTypeInfo[] = [
  {
    id: 'text-overlay',
    title: 'Superposición de texto oscuro e imagen estándar',
    description: 'Superposición de texto (titular y cuerpo) sobre una imagen de fondo',
    icon: 'type',
    tone: 'sky',
    requirements: 'Imagen: min 970x300px, Titular: max 70 caracteres',
  },
  {
    id: 'specifications',
    title: 'Detalles de especificaciones y una sola imagen estándar',
    description: 'Imagen con texto estructurado (titular, subtítulos, viñetas, cuerpo)',
    icon: 'file-text',
    tone: 'emerald',
    requirements: 'Imagen: min 300x300px, Titular: max 200 caracteres',
  },
  {
    id: 'four-images',
    title: 'Cuatro imágenes y texto estándares',
    description: 'Cuatro imágenes con texto asociado en cuadrícula 2x2',
    icon: 'image',
    tone: 'cyan',
    requirements: 'Imágenes: min 220x220px c/u, Titular: max 160 caracteres',
  },
];

export const MODULE_TITLES: Record<ModuleType, string> = {
  'text-overlay': 'Superposición de texto oscuro e imagen estándar',
  specifications: 'Detalles de especificaciones y una sola imagen estándar',
  'four-images': 'Cuatro imágenes y texto estándares',
  'header-image': 'Imagen de encabezado estándar',
};

/** text-overlay valida con espera de 500 ms; los otros dos, 100 ms tras el cambio. */
export const VALIDATION_DELAY: Partial<Record<ModuleType, number>> = {
  'text-overlay': 500,
  specifications: 100,
  'four-images': 100,
};

/** Dimensiones mínimas de imagen por tipo de módulo. */
export const IMAGE_MIN: Record<EditableModuleType, readonly [number, number]> = {
  'text-overlay': [TO.minW, TO.minH],
  specifications: [SP.minW, SP.minH],
  'four-images': [FI.minW, FI.minH],
};
