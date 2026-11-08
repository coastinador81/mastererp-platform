import type { Dimensions, StyleConfig } from './types';

/**
 * Prompt y dimensiones de la generación con IA (prototipo: AIImageGeneratorService
 * de pim/imagenes.js, desde aiImageGeneratorService.ts). Se mandan al backend.
 */

const STYLE_DESCRIPTIONS: Record<string, string> = {
  professional: 'fotografía profesional de producto con iluminación de estudio',
  lifestyle: 'fotografía lifestyle en ambiente natural y cotidiano',
  minimalist: 'fotografía minimalista con diseño limpio y simple',
  vintage: 'fotografía vintage con tonos cálidos y estética retro',
  modern: 'fotografía moderna con elementos contemporáneos',
  artistic: 'fotografía artística con composición creativa',
};

const BACKGROUND_DESCRIPTIONS: Record<string, string> = {
  white: 'sobre fondo blanco limpio y puro',
  transparent: 'con fondo transparente para recorte',
  gradient: 'con degradado suave y elegante',
  contextual: 'en contexto de uso realista y natural',
};

const LIGHTING_DESCRIPTIONS: Record<string, string> = {
  natural: 'con luz natural suave y difusa',
  studio: 'con iluminación de estudio profesional',
  soft: 'con luz suave y envolvente',
  dramatic: 'con iluminación dramática y contrastada',
};

const MOOD_DESCRIPTIONS: Record<string, string> = {
  neutral: 'con tono neutral y equilibrado',
  warm: 'con ambiente cálido y acogedor',
  cool: 'con ambiente frío y moderno',
  vibrant: 'con colores vibrantes y energéticos',
};

export interface PromptProductData {
  brand?: unknown;
}

export function buildPrompt(productName: string, productData: PromptProductData | null | undefined, styleConfig: StyleConfig): string {
  const styleDesc = STYLE_DESCRIPTIONS[styleConfig.style] || 'fotografía profesional';
  const bgDesc = BACKGROUND_DESCRIPTIONS[styleConfig.background] || 'fondo blanco';
  const lightDesc = LIGHTING_DESCRIPTIONS[styleConfig.lighting] || 'luz natural';
  const moodDesc = MOOD_DESCRIPTIONS[styleConfig.mood] || 'tono neutral';
  const productInfo = productData?.brand ? `${String(productData.brand)} ${productName}` : productName;
  const qualityDesc = styleConfig.quality === 'high'
    ? 'ultra alta definición'
    : styleConfig.quality === 'medium' ? 'alta definición' : 'definición estándar';
  return `${productInfo}, ${styleDesc}, ${bgDesc}, ${lightDesc}, ${moodDesc}, ${qualityDesc}, fotografía comercial de alta calidad`;
}

export function getDimensions(aspectRatio: string): Dimensions {
  switch (aspectRatio) {
    case 'horizontal': return { width: 1920, height: 1080 };
    case 'vertical': return { width: 1080, height: 1920 };
    case 'square':
    default: return { width: 1500, height: 1500 };
  }
}
