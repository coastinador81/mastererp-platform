import { str } from './content';
import type { AplusImage, AplusModule, BackendModule } from './types';

/**
 * APlusContentInterface.tsx 607-647 (E22): el mismo payload que el original
 * (decisión 1), con altText constante 'Imagen' y solo sus campos; los módulos
 * header-image no se envían. Única diferencia: las viñetas de solo espacios no se
 * envían (A10). Es el contrato de POST /amazon/aplus/create y compañía.
 */
const destination = (image: AplusImage | null | undefined): string => image?.uploadDestinationId || 'dummy-image-id';

export function mapModulesToBackend(modules: AplusModule[]): BackendModule[] {
  return modules.flatMap((module): BackendModule[] => {
    if (module.type === 'text-overlay') {
      const content = module.content;
      return [{
        type: 'STANDARD_IMAGE_TEXT_OVERLAY',
        fields: {
          uploadDestinationId: destination(content.backgroundImage),
          altText: 'Imagen',
          headline: content.headline || '',
          subheadline: content.bodyText || '',
          width_px: 970,
          height_px: 300,
        },
      }];
    }
    if (module.type === 'specifications') {
      const content = module.content;
      return [{
        type: 'STANDARD_SINGLE_IMAGE_SPECS_DETAIL',
        fields: {
          uploadDestinationId: destination(content.image),
          altText: 'Imagen',
          headline: content.mainHeadline || '',
          specs: (content.bulletPoints || []).filter(bullet => str(bullet).trim()).map(bullet => ({ label: bullet })),
        },
      }];
    }
    if (module.type === 'four-images') {
      const sections = module.content.sections || [];
      return [{
        type: 'STANDARD_FOUR_IMAGE_TEXT',
        fields: {
          images: sections.map(section => destination(section.image)),
          texts: sections.map(section => section.headline || ''),
        },
      }];
    }
    return [];
  });
}

/** Si algún módulo va sin imagen subida a Amazon (se enviaría 'dummy-image-id'). */
export function countMissingImages(modules: BackendModule[]): number {
  return modules.filter(module => {
    if (module.type === 'STANDARD_FOUR_IMAGE_TEXT') return module.fields.images.some(id => id.includes('dummy'));
    return module.fields.uploadDestinationId.includes('dummy');
  }).length;
}
