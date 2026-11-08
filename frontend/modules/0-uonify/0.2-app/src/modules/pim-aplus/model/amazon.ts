import { str } from './content';
import type { AmazonContentModule, AmazonContentRecord, AmazonTextList } from './amazonTypes';
import type { AplusImage, AplusModule, FourSection, ImageDimensions, SpecBlock } from './types';

/**
 * Traducción del contenido A+ de Amazon a los módulos de la pestaña
 * (APlusContentInterface.tsx 305-465: createImageObject y mapAmazonModulesToUI).
 */
export type ImageDownloader = (uploadDestinationId: string | undefined) => Promise<string | null>;

// createImageObject (APlusContentInterface.tsx 305-332)
export function createImageObject(
  imageUrl: string | null,
  uploadDestId: string | undefined,
  timestamp: number,
  idx: number,
  blockIdx?: number,
  dimensions: ImageDimensions = { width: 300, height: 300 },
  altText = 'Imagen A+',
): AplusImage {
  const id = blockIdx ? `img-${timestamp}-${idx}-${blockIdx}` : `img-${timestamp}-${idx}`;
  const placeholderText = blockIdx ? `Imagen+${blockIdx}` : 'Imagen+A%2B';
  const base = { id, file: null, dimensions, size: 0, format: 'image/jpeg', isValid: true, validationErrors: [], uploadDestinationId: uploadDestId };
  return imageUrl
    ? { ...base, url: imageUrl, altText }
    : {
        ...base,
        url: `https://placehold.co/${dimensions.width}x${dimensions.height}/e5e7eb/6b7280?text=${placeholderText}`,
        altText: `${altText} (placeholder)`,
      };
}

function joinText(list: AmazonTextList['textList'], separator: string, filterEmpty = false): string {
  const values = (list || []).map(item => item?.value);
  return (filterEmpty ? values.filter(Boolean) : values).join(separator) || '';
}

// mapAmazonModulesToUI (APlusContentInterface.tsx 335-465)
export async function mapAmazonModulesToUI(
  contentModuleList: AmazonContentModule[],
  download: ImageDownloader,
  timestamp = Date.now(),
): Promise<AplusModule[]> {
  const mapped: AplusModule[] = [];
  for (let idx = 0; idx < contentModuleList.length; idx++) {
    const cm = contentModuleList[idx] || {};
    const type = cm.contentModuleType;
    const id = `module-${timestamp}-${idx}`;
    if (type === 'STANDARD_IMAGE_TEXT_OVERLAY') {
      const overlay = cm.standardImageTextOverlay?.block || {};
      const uploadDestId = overlay.image?.uploadDestinationId;
      const imageUrl = await download(uploadDestId);
      mapped.push({
        id,
        type: 'text-overlay',
        title: 'Superposición de texto oscuro e imagen estándar',
        content: {
          headline: overlay.headline?.value || '',
          bodyText: joinText(overlay.body?.textList, ' '),
          backgroundImage: createImageObject(imageUrl, uploadDestId, timestamp, idx, undefined, { width: 970, height: 300 }, overlay.image?.altText || 'Imagen A+'),
        },
        isValid: true,
        validationErrors: [],
      });
    }
    if (type === 'STANDARD_SINGLE_IMAGE_SPECS_DETAIL') {
      const detail = cm.standardSingleImageSpecsDetail || {};
      const uploadDestId = detail.image?.uploadDestinationId;
      const imageUrl = await download(uploadDestId);
      const blocks: SpecBlock[] = [];
      const block1Body = joinText(detail.descriptionBlock1?.body?.textList, '\n\n', true);
      if (detail.descriptionHeadline?.value || detail.descriptionBlock1?.headline?.value || block1Body) {
        blocks.push({ headline: detail.descriptionHeadline?.value || '', subtitle: detail.descriptionBlock1?.headline?.value || '', body: block1Body });
      }
      const block2Body = joinText(detail.descriptionBlock2?.body?.textList, '\n\n', true);
      if (detail.descriptionBlock2?.headline?.value || block2Body) {
        blocks.push({ headline: '', subtitle: detail.descriptionBlock2?.headline?.value || '', body: block2Body });
      }
      if (blocks.length === 0) blocks.push({ headline: '', subtitle: '', body: '' });
      const bullets = (detail.specificationListBlock?.block?.textList || [])
        .map(item => item?.text?.value || item?.value)
        .filter((value): value is string => Boolean(value));
      mapped.push({
        id,
        type: 'specifications',
        title: 'Detalles de especificaciones y una sola imagen estándar',
        content: {
          mainHeadline: detail.headline?.value || '',
          blocks,
          specificationHeadline: detail.specificationHeadline?.value || '',
          bulletPoints: bullets.length ? bullets : [''],
          image: createImageObject(imageUrl, uploadDestId, timestamp, idx, undefined, { width: 300, height: 300 }, detail.image?.altText || 'Imagen A+'),
        },
        isValid: true,
        validationErrors: [],
      });
    }
    if (type === 'STANDARD_FOUR_IMAGE_TEXT') {
      const four = cm.standardFourImageText || {};
      const sections: FourSection[] = [];
      for (let blockIdx = 1; blockIdx <= 4; blockIdx++) {
        const block = four[`block${blockIdx}` as 'block1'];
        const uploadDestId = block?.image?.uploadDestinationId;
        const imageUrl = await download(uploadDestId);
        sections.push({
          headline: block?.headline?.value || '',
          bodyText: joinText(block?.body?.textList, '\n'),
          image: createImageObject(imageUrl, uploadDestId, timestamp, idx, blockIdx, { width: 220, height: 220 }, block?.image?.altText || `Imagen ${blockIdx}`),
        });
      }
      mapped.push({
        id,
        type: 'four-images',
        title: 'Cuatro imágenes y texto estándares',
        content: { generalHeadline: four.headline?.value || '', sections },
        isValid: true,
        validationErrors: [],
      });
    }
    if (type === 'STANDARD_HEADER_IMAGE_TEXT') {
      const header = cm.standardHeaderImageText?.block || {};
      const uploadDestId = header.image?.uploadDestinationId;
      const imageUrl = await download(uploadDestId);
      mapped.push({
        id,
        type: 'header-image',
        title: 'Imagen de encabezado estándar',
        content: {
          headline: header.headline?.value || '',
          image: createImageObject(imageUrl, uploadDestId, timestamp, idx, undefined, { width: 970, height: 300 }, header.image?.altText || 'Imagen de encabezado'),
        },
        isValid: true,
        validationErrors: [],
      });
    }
  }
  return mapped;
}

/** Imágenes descargadas de Amazon (data:) entre los módulos cargados. */
export function countDownloadedImages(modules: AplusModule[]): number {
  const downloaded = (image: AplusImage | null | undefined) => str(image?.url).startsWith('data:');
  return modules.reduce((count, module) => {
    if (module.type === 'text-overlay' && downloaded(module.content.backgroundImage)) count += 1;
    if ((module.type === 'specifications' || module.type === 'header-image') && downloaded(module.content.image)) count += 1;
    if (module.type === 'four-images') count += (module.content.sections || []).filter(section => downloaded(section.image)).length;
    return count;
  }, 0);
}

/** contentRecord de /detail en cualquiera de sus envoltorios (payload, directo o body). */
export function contentRecordOf(data: unknown): AmazonContentRecord | undefined {
  const value = data as { payload?: { contentRecord?: AmazonContentRecord }; contentRecord?: AmazonContentRecord; body?: { contentRecord?: AmazonContentRecord } } | null;
  return value?.payload?.contentRecord || value?.contentRecord || value?.body?.contentRecord;
}
