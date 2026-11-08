import { FI, MODULE_TITLES, SP, TO } from './constants';
import type {
  AplusImage,
  AplusModule,
  ContentByType,
  EditableModuleType,
  ModuleContent,
  ModuleType,
  SpecBlock,
  SpecsContent,
} from './types';

/**
 * Contenido de los módulos: valores iniciales, normalización y cambios puros
 * (APlusContentInterface.tsx y los tres editores del original).
 */
export const str = (value: unknown): string => (typeof value === 'string' ? value : value == null ? '' : String(value));

const emptyBlock = (): SpecBlock => ({ headline: '', subtitle: '', body: '' });

// APlusContentInterface.tsx 151-185
const INITIAL: { [T in ModuleType]: () => ContentByType[T] } = {
  'text-overlay': () => ({ headline: '', bodyText: '', backgroundImage: null }),
  specifications: () => ({ mainHeadline: '', blocks: [emptyBlock()], specificationHeadline: '', bulletPoints: [''], image: null }),
  'four-images': () => ({ generalHeadline: '', sections: [0, 1, 2, 3].map(() => ({ headline: '', bodyText: '', image: null })) }),
  'header-image': () => ({ headline: '', image: null }),
};

export function getInitialContentForType<T extends ModuleType>(type: T): ContentByType[T] {
  return INITIAL[type]();
}

/** SpecificationsModule.tsx 51-59: contenido sin bloques → un bloque vacío. A10: sin viñetas → una editable. */
export function normalizeSpecs(content: Partial<SpecsContent> | null | undefined): SpecsContent {
  let next = content as SpecsContent | null | undefined;
  if (!next || !next.blocks) {
    next = {
      mainHeadline: next?.mainHeadline || '',
      blocks: [emptyBlock()],
      specificationHeadline: '',
      bulletPoints: next?.bulletPoints || [''],
      image: next?.image || null,
    };
  }
  if (!Array.isArray(next.bulletPoints) || next.bulletPoints.length === 0) next = { ...next, bulletPoints: [''] };
  return next;
}

/** Deja el módulo listo para editar (el original normalizaba las especificaciones al pintarlas). */
export function normalizeModule(module: AplusModule): AplusModule {
  if (module.type !== 'specifications') return module;
  const content = normalizeSpecs(module.content);
  return content === module.content ? module : { ...module, content };
}

export function createModule(type: EditableModuleType, id: string): AplusModule {
  return {
    id,
    type,
    title: MODULE_TITLES[type],
    content: getInitialContentForType(type),
    isValid: false,
    validationErrors: [],
  } as AplusModule;
}

/** Campos editables (data-field del original). */
export type FieldPath =
  | 'headline'
  | 'mainHeadline'
  | 'specificationHeadline'
  | 'generalHeadline'
  | 'block.headline'
  | 'block.subtitle'
  | 'block.body'
  | 'bullet'
  | 'section.headline'
  | 'section.bodyText';

/** applyField del original: devuelve el contenido con el campo cambiado. */
export function applyField<C extends ModuleContent>(content: C, field: FieldPath, index: number, value: string): C {
  const c = content as unknown as Record<string, unknown>;
  if (field === 'block.headline' || field === 'block.subtitle' || field === 'block.body') {
    const key = field.slice(6);
    const blocks = [...((c.blocks as SpecBlock[] | undefined) || [])];
    blocks[index] = { ...blocks[index], [key]: value };
    return { ...c, blocks } as unknown as C;
  }
  if (field === 'bullet') {
    const bulletPoints = [...((c.bulletPoints as string[] | undefined) || [])];
    bulletPoints[index] = value;
    return { ...c, bulletPoints } as unknown as C;
  }
  if (field === 'section.headline' || field === 'section.bodyText') {
    const key = field.slice(8);
    const sections = [...((c.sections as Record<string, unknown>[] | undefined) || [])];
    sections[index] = { ...sections[index], [key]: value };
    return { ...c, sections } as unknown as C;
  }
  return { ...c, [field]: value } as unknown as C;
}

export function addBlock(content: SpecsContent): SpecsContent | null {
  const blocks = content.blocks || [];
  if (blocks.length >= SP.maxBlocks) return null;
  return { ...content, blocks: [...blocks, emptyBlock()] };
}

export function removeBlock(content: SpecsContent, index: number): SpecsContent | null {
  const blocks = content.blocks || [];
  if (blocks.length <= 1) return null;
  return { ...content, blocks: blocks.filter((_, i) => i !== index) };
}

export function addBullet(content: SpecsContent): SpecsContent | null {
  const bullets = content.bulletPoints || [];
  if (bullets.length >= SP.maxBullets) return null;
  return { ...content, bulletPoints: [...bullets, ''] };
}

export function removeBullet(content: SpecsContent, index: number): SpecsContent | null {
  const bullets = content.bulletPoints || [];
  if (bullets.length <= 1) return null;
  return { ...content, bulletPoints: bullets.filter((_, i) => i !== index) };
}

/** Imagen de un hueco: la del módulo o la de la sección `index` (cuatro imágenes). */
export function getModuleImage(module: AplusModule, index: number | null): AplusImage | null {
  switch (module.type) {
    case 'text-overlay':
      return module.content.backgroundImage;
    case 'specifications':
    case 'header-image':
      return module.content.image;
    case 'four-images':
      return index === null ? null : module.content.sections?.[index]?.image ?? null;
    default:
      return null;
  }
}

/** Contenido con la imagen del hueco sustituida (null = quitarla). */
export function withModuleImage(module: AplusModule, index: number | null, image: AplusImage | null): ModuleContent | null {
  switch (module.type) {
    case 'text-overlay':
      return { ...module.content, backgroundImage: image };
    case 'specifications':
      return { ...module.content, image };
    case 'four-images': {
      if (index === null || Number.isNaN(index)) return null;
      const sections = [...(module.content.sections || [])];
      sections[index] = { ...sections[index], image };
      return { ...module.content, sections };
    }
    default:
      return null;
  }
}

/** Medidas mínimas y texto alternativo de una subida (handleFileSelect de los tres editores). */
export function uploadTarget(module: AplusModule, index: number | null): { minW: number; minH: number; altText: string } | null {
  switch (module.type) {
    case 'text-overlay':
      return { minW: TO.minW, minH: TO.minH, altText: `Imagen de fondo para ${module.content.headline || 'módulo de superposición'}` };
    case 'specifications':
      return {
        minW: SP.minW,
        minH: SP.minH,
        altText: `Imagen de especificaciones para ${module.content.mainHeadline || 'módulo de especificaciones'}`,
      };
    case 'four-images':
      if (index === null || Number.isNaN(index)) return null;
      return {
        minW: FI.minW,
        minH: FI.minH,
        altText: `Imagen para ${module.content.sections?.[index]?.headline || `sección ${index + 1}`}`,
      };
    default:
      return null;
  }
}

/** Suelta la URL local de una imagen subida (solo al quitarla o sustituirla: A03). */
export function releaseBlob(image: AplusImage | null | undefined): void {
  if (typeof image?.url === 'string' && image.url.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(image.url);
  }
}
