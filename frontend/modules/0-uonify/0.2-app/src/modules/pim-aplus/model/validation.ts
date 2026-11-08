import { FI, SP, TO } from './constants';
import { str } from './content';
import type { AplusModule, FourImagesContent, SpecsContent, TextOverlayContent } from './types';

/**
 * Reglas de contenido de los tres editores (TextOverlayModule, SpecificationsModule y
 * FourImagesModule). A11: «precio(s)» como palabra, no como subcadena («aprecio» o
 * «precioso» no saltan); los enlaces se detectan con http://, https:// o www.
 */
const PRICE_WORD = /(?<![\p{L}\p{N}])precios?(?![\p{L}\p{N}])/iu;

export const hasExternalLink = (text: string): boolean => /https?:\/\/|www\./i.test(text);
export const hasPriceReference = (text: string): boolean => text.includes('€') || text.includes('$') || PRICE_WORD.test(text);

function contentRules(text: string, errors: string[]): void {
  if (hasExternalLink(text)) errors.push('No se permiten enlaces externos en el texto');
  if (hasPriceReference(text)) errors.push('No se permiten referencias a precios');
}

// TextOverlayModule.tsx 125-163
export function validateTextOverlay(content: TextOverlayContent): string[] {
  const errors: string[] = [];
  const headline = str(content.headline);
  const bodyText = str(content.bodyText);
  if (!headline.trim()) errors.push('El titular es obligatorio');
  else if (headline.length > TO.headline) errors.push(`El titular excede ${TO.headline} caracteres`);
  if (!bodyText.trim()) errors.push('El texto del cuerpo es obligatorio');
  else if (bodyText.length > TO.body) errors.push(`El texto del cuerpo excede ${TO.body} caracteres`);
  if (!content.backgroundImage) errors.push('La imagen de fondo es obligatoria');
  else if (!content.backgroundImage.isValid) errors.push(...(content.backgroundImage.validationErrors || []));
  contentRules(`${headline} ${bodyText}`, errors);
  return errors;
}

// SpecificationsModule.tsx 111-173
export function validateSpecs(content: SpecsContent): string[] {
  const errors: string[] = [];
  const mainHeadline = str(content.mainHeadline);
  const blocks = content.blocks || [];
  const bullets = content.bulletPoints || [];
  if (!mainHeadline.trim()) errors.push('El titular principal es obligatorio');
  else if (mainHeadline.length > SP.main) errors.push(`El titular principal excede ${SP.main} caracteres`);
  blocks.forEach((block, index) => {
    if (str(block.headline).length > SP.blockHeadline) errors.push(`Bloque ${index + 1} headline excede ${SP.blockHeadline} caracteres`);
    if (str(block.subtitle).length > SP.subtitle) errors.push(`Bloque ${index + 1} subtitle excede ${SP.subtitle} caracteres`);
    if (str(block.body).length > SP.body) errors.push(`Bloque ${index + 1} body excede ${SP.body} caracteres`);
  });
  if (str(content.specificationHeadline).length > SP.blockHeadline) {
    errors.push(`Specification headline excede ${SP.blockHeadline} caracteres`);
  }
  bullets.forEach((bullet, index) => {
    const value = str(bullet);
    if (value.trim() && value.length > SP.bullet) errors.push(`Viñeta ${index + 1} excede ${SP.bullet} caracteres`);
  });
  if (!content.image) errors.push('La imagen es obligatoria');
  else if (!content.image.isValid) errors.push(...(content.image.validationErrors || []));
  const allText = [
    mainHeadline,
    ...blocks.map(block => `${str(block.headline)} ${str(block.subtitle)} ${str(block.body)}`),
    str(content.specificationHeadline),
    ...bullets.map(str),
  ].join(' ');
  contentRules(allText, errors);
  return errors;
}

// FourImagesModule.tsx 95-145
export function validateFourImages(content: FourImagesContent): string[] {
  const errors: string[] = [];
  const general = str(content.generalHeadline);
  const sections = content.sections || [];
  if (!general.trim()) errors.push('El titular general es obligatorio');
  else if (general.length > FI.general) errors.push(`El titular general excede ${FI.general} caracteres`);
  sections.forEach((section, index) => {
    const n = index + 1;
    const headline = str(section.headline);
    const bodyText = str(section.bodyText);
    if (!headline.trim()) errors.push(`El titular de la sección ${n} es obligatorio`);
    else if (headline.length > FI.headline) errors.push(`El titular de la sección ${n} excede ${FI.headline} caracteres`);
    if (!bodyText.trim()) errors.push(`El texto de la sección ${n} es obligatorio`);
    else if (bodyText.length > FI.body) errors.push(`El texto de la sección ${n} excede ${FI.body} caracteres`);
    if (!section.image) errors.push(`La imagen de la sección ${n} es obligatoria`);
    else if (!section.image.isValid) errors.push(...(section.image.validationErrors || []).map(error => `Sección ${n}: ${error}`));
  });
  const allText = `${general} ${sections.map(section => `${str(section.headline)} ${str(section.bodyText)}`).join(' ')}`;
  contentRules(allText, errors);
  return errors;
}

/** Errores del módulo, o null si su tipo no tiene validador (imagen de encabezado). */
export function validateModule(module: AplusModule): string[] | null {
  switch (module.type) {
    case 'text-overlay':
      return validateTextOverlay(module.content);
    case 'specifications':
      return validateSpecs(module.content);
    case 'four-images':
      return validateFourImages(module.content);
    default:
      return null;
  }
}
