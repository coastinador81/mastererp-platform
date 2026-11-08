import { describe, expect, it } from 'vitest';
import { containRect, kilobytes, megabytes, navigateIndex, validateImageFile } from '../model/files';
import { DEFAULT_STYLE, MESSAGES, sourceBadge, sourceEmoji, sourceText, statusInfo, styleLabel } from '../model/labels';
import { buildPrompt, getDimensions } from '../model/prompt';
import { buildImageProxyUrl, isImageProxyUrl, proxyTarget } from '../model/proxy';

describe('textos de la pestaña', () => {
  it('insignias, fuentes y estados como el original', () => {
    expect(['upload', 'scrape', 'amazon', 'ai-generated', 'x'].map(sourceBadge)).toEqual(['Subida', 'Scrapeada', 'Amazon', 'IA', 'Otro']);
    expect(['upload', 'scrape', 'amazon', 'ai-generated', undefined].map(sourceText)).toEqual(['Upload', 'Scraped', 'Amazon', 'AI Generated', 'Otro']);
    expect(sourceEmoji('ai-generated')).toBe('🤖');
    expect(statusInfo('processed')).toMatchObject({ text: 'Procesado ✓', tone: 'green' });
    expect(statusInfo('generated')).toMatchObject({ text: 'Generando...', tone: 'purple' });
    expect(statusInfo('pending')).toMatchObject({ text: 'Listo', badge: '⏳' });
    expect(styleLabel('professional')).toBe('Profesional');
    expect(styleLabel('otro')).toBe('otro');
  });

  it('IMG-07: el aviso de «Eliminar» cuenta las imágenes eliminadas', () => {
    expect(MESSAGES.deleted(1)).toBe('🗑️ 1 imagen eliminada');
    expect(MESSAGES.deleted(3)).toBe('🗑️ 3 imágenes eliminadas');
    expect(MESSAGES.resized(1)).toBe('✅ 1 imagen redimensionada a 1500px');
    expect(MESSAGES.resized(2)).toBe('✅ 2 imágenes redimensionadas a 1500px');
    expect(MESSAGES.failed(2)).toBe('❌ 2 imágenes fallaron');
    expect(MESSAGES.failed(1)).toBe('❌ 1 imagen falló');
    expect(MESSAGES.generated(3, 'professional')).toBe('🎨 3 imágenes generadas con estilo Profesional');
  });
});

describe('archivos', () => {
  it('valida formato y tamaño (JPG, PNG, WEBP · 10 MB)', () => {
    expect(validateImageFile({ type: 'image/png', size: 1000 })).toEqual({ isValid: true });
    expect(validateImageFile({ type: 'image/gif', size: 1000 })).toEqual({ isValid: false, error: 'Formato no soportado. Use JPG, PNG o WEBP.' });
    expect(validateImageFile({ type: 'image/webp', size: 10 * 1024 * 1024 + 1 })).toEqual({ isValid: false, error: 'Archivo muy grande. Máximo 10MB.' });
  });

  it('redimensiona con «contain» centrado en 1500 × 1500', () => {
    expect(containRect({ width: 3000, height: 1500 })).toEqual({ x: 0, y: 375, width: 1500, height: 750 });
    expect(containRect({ width: 500, height: 1000 })).toEqual({ x: 375, y: 0, width: 750, height: 1500 });
  });

  it('la vista previa da la vuelta en los extremos', () => {
    expect(navigateIndex(0, 3, 'prev')).toBe(2);
    expect(navigateIndex(2, 3, 'next')).toBe(0);
    expect(navigateIndex(1, 3, 'next')).toBe(2);
    expect(navigateIndex(0, 0, 'next')).toBe(0);
  });

  it('tamaños como el original', () => {
    expect(kilobytes(2048)).toBe('2KB');
    expect(megabytes(351930)).toBe('0.34 MB');
  });
});

describe('prompt de Uony', () => {
  it('estilo predeterminado: profesional, alta calidad, 1:1, luz natural, fondo blanco', () => {
    expect(buildPrompt('Make It Possible', { brand: 'Uonify' }, DEFAULT_STYLE)).toBe(
      'Uonify Make It Possible, fotografía profesional de producto con iluminación de estudio, sobre fondo blanco limpio y puro, '
      + 'con luz natural suave y difusa, con tono neutral y equilibrado, ultra alta definición, fotografía comercial de alta calidad',
    );
    expect(buildPrompt('X', null, { ...DEFAULT_STYLE, style: 'raro', quality: 'medium' })).toMatch(/^X, fotografía profesional, .*alta definición,/);
  });

  it('dimensiones por proporción', () => {
    expect(getDimensions('square')).toEqual({ width: 1500, height: 1500 });
    expect(getDimensions('horizontal')).toEqual({ width: 1920, height: 1080 });
    expect(getDimensions('vertical')).toEqual({ width: 1080, height: 1920 });
    expect(getDimensions('otra')).toEqual({ width: 1500, height: 1500 });
  });
});

describe('image-proxy', () => {
  it('envuelve solo URLs absolutas y nunca dos veces (IMG-19)', () => {
    const wrapped = buildImageProxyUrl('https://tienda.test/a b.jpg');
    expect(wrapped).toBe('/api/amazon/aplus/image-proxy?url=https%3A%2F%2Ftienda.test%2Fa%20b.jpg');
    expect(isImageProxyUrl(wrapped)).toBe(true);
    expect(buildImageProxyUrl(wrapped)).toBe(wrapped);
    expect(buildImageProxyUrl('data:image/png;base64,AA')).toBe('data:image/png;base64,AA');
    expect(buildImageProxyUrl('/assets/a.jpg')).toBe('/assets/a.jpg');
    expect(proxyTarget(wrapped)).toBe('https://tienda.test/a b.jpg');
    expect(proxyTarget('/assets/a.jpg')).toBeNull();
  });
});
