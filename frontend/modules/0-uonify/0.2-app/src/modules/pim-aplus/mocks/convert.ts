import type { AmazonContentDocument, AmazonContentModule, AmazonImage, AmazonText } from '../model/amazonTypes';
import type { BackendModule } from '../model/types';

/**
 * Lo que haría el backend con los módulos que envía el frontend: convertirlos en
 * un contentDocument de Amazon (SP-API A+ Content) para crear o actualizar.
 */
const text = (value: string): AmazonText => ({ value });
const image = (uploadDestinationId: string, altText: string, width: number, height: number): AmazonImage => ({
  uploadDestinationId,
  altText,
  imageCropSpecification: { size: { width: { value: width, units: 'pixels' }, height: { value: height, units: 'pixels' } } },
});

export function toContentModule(module: BackendModule): AmazonContentModule {
  switch (module.type) {
    case 'STANDARD_IMAGE_TEXT_OVERLAY': {
      const f = module.fields;
      return {
        contentModuleType: module.type,
        standardImageTextOverlay: {
          overlayColorType: 'DARK',
          block: { image: image(f.uploadDestinationId, f.altText, f.width_px, f.height_px), headline: text(f.headline), body: { textList: [text(f.subheadline)] } },
        },
      };
    }
    case 'STANDARD_SINGLE_IMAGE_SPECS_DETAIL': {
      const f = module.fields;
      return {
        contentModuleType: module.type,
        standardSingleImageSpecsDetail: {
          headline: text(f.headline),
          image: image(f.uploadDestinationId, f.altText, 300, 300),
          specificationListBlock: { block: { textList: f.specs.map((spec, index) => ({ position: index + 1, text: text(spec.label) })) } },
        },
      };
    }
    default: {
      const f = module.fields;
      const block = (index: number) => ({ image: image(f.images[index] || 'dummy-image-id', 'Imagen', 220, 220), headline: text(f.texts[index] || '') });
      return {
        contentModuleType: 'STANDARD_FOUR_IMAGE_TEXT',
        standardFourImageText: { block1: block(0), block2: block(1), block3: block(2), block4: block(3) },
      };
    }
  }
}

export function toContentDocument(asin: string, modules: BackendModule[]): AmazonContentDocument {
  return { name: asin, contentType: 'EBC', contentSubType: 'STANDARD', locale: 'es-ES', contentModuleList: modules.map(toContentModule) };
}

const KNOWN = new Set(['STANDARD_IMAGE_TEXT_OVERLAY', 'STANDARD_SINGLE_IMAGE_SPECS_DETAIL', 'STANDARD_FOUR_IMAGE_TEXT']);

/** Módulos válidos del cuerpo (tipo conocido y campos presentes). */
export function readModules(value: unknown): BackendModule[] | null {
  if (!Array.isArray(value)) return null;
  const valid = value.every(item => item && typeof item === 'object' && KNOWN.has((item as BackendModule).type) && typeof (item as BackendModule).fields === 'object');
  return valid ? (value as BackendModule[]) : null;
}
