import { describe, expect, it } from 'vitest';
import { normalizeSpecs } from '../model/content';
import type { AplusImage, FourImagesContent, SpecsContent, TextOverlayContent } from '../model/types';
import { hasExternalLink, hasPriceReference, validateFourImages, validateSpecs, validateTextOverlay } from '../model/validation';

const image = (overrides: Partial<AplusImage> = {}): AplusImage => ({
  id: 'img-1',
  url: 'blob:x',
  altText: 'Imagen',
  dimensions: { width: 1940, height: 648 },
  size: 300_000,
  format: 'image/jpeg',
  isValid: true,
  validationErrors: [],
  ...overrides,
});

describe('reglas de contenido A+ (A11)', () => {
  it('«precio» como palabra salta; «aprecio» o «precioso» no', () => {
    expect(hasPriceReference('Mejor precio garantizado')).toBe(true);
    expect(hasPriceReference('PRECIOS bajos')).toBe(true);
    expect(hasPriceReference('Te aprecio')).toBe(false);
    expect(hasPriceReference('Un diseño precioso')).toBe(false);
    expect(hasPriceReference('Solo 20 €')).toBe(true);
    expect(hasPriceReference('Solo $20')).toBe(true);
  });

  it('los enlaces externos se detectan con http(s):// y con www.', () => {
    expect(hasExternalLink('Visita https://uonify.com')).toBe(true);
    expect(hasExternalLink('Visita www.uonify.com')).toBe(true);
    expect(hasExternalLink('Visita uonify')).toBe(false);
  });
});

describe('superposición de texto', () => {
  const valid: TextOverlayContent = { headline: 'Todo empieza jugando.', bodyText: 'Veinticinco piezas de madera.', backgroundImage: image() };

  it('un módulo completo es válido', () => {
    expect(validateTextOverlay(valid)).toEqual([]);
  });

  it('pide titular, cuerpo e imagen', () => {
    expect(validateTextOverlay({ headline: ' ', bodyText: '', backgroundImage: null })).toEqual([
      'El titular es obligatorio',
      'El texto del cuerpo es obligatorio',
      'La imagen de fondo es obligatoria',
    ]);
  });

  it('respeta los límites 70/300 y suma los errores de la imagen', () => {
    const errors = validateTextOverlay({
      headline: 'x'.repeat(71),
      bodyText: 'y'.repeat(301),
      backgroundImage: image({ isValid: false, validationErrors: ['Imagen muy pequeña. Mínimo: 970x300px (actual: 500x200px)'] }),
    });
    expect(errors).toEqual([
      'El titular excede 70 caracteres',
      'El texto del cuerpo excede 300 caracteres',
      'Imagen muy pequeña. Mínimo: 970x300px (actual: 500x200px)',
    ]);
  });

  it('no permite precios ni enlaces en el texto', () => {
    expect(validateTextOverlay({ ...valid, bodyText: 'Por solo 9 € en www.tienda.es' })).toEqual([
      'No se permiten enlaces externos en el texto',
      'No se permiten referencias a precios',
    ]);
  });
});

describe('especificaciones', () => {
  const base = (): SpecsContent => ({
    mainHeadline: 'Dentro de la caja',
    blocks: [{ headline: 'Tres personajes', subtitle: 'Productos, ERP y Agentes', body: 'Cada personaje tiene su hueco.' }],
    specificationHeadline: 'Especificaciones',
    bulletPoints: ['25 piezas de madera', '   '],
    image: image(),
  });

  it('un módulo completo es válido (las viñetas vacías no cuentan)', () => {
    expect(validateSpecs(base())).toEqual([]);
  });

  it('comprueba titular, bloques, titular de especificaciones, viñetas e imagen', () => {
    const content = base();
    content.mainHeadline = '';
    content.blocks = [{ headline: 'h'.repeat(101), subtitle: 's'.repeat(81), body: 'b'.repeat(501) }];
    content.specificationHeadline = 'z'.repeat(101);
    content.bulletPoints = ['v'.repeat(121)];
    content.image = null;
    expect(validateSpecs(content)).toEqual([
      'El titular principal es obligatorio',
      'Bloque 1 headline excede 100 caracteres',
      'Bloque 1 subtitle excede 80 caracteres',
      'Bloque 1 body excede 500 caracteres',
      'Specification headline excede 100 caracteres',
      'Viñeta 1 excede 120 caracteres',
      'La imagen es obligatoria',
    ]);
  });

  it('A10: sin bloques deja uno vacío y sin viñetas deja una editable', () => {
    expect(normalizeSpecs({ mainHeadline: 'Hola', bulletPoints: [] })).toEqual({
      mainHeadline: 'Hola',
      blocks: [{ headline: '', subtitle: '', body: '' }],
      specificationHeadline: '',
      bulletPoints: [''],
      image: null,
    });
    const complete = base();
    expect(normalizeSpecs(complete)).toBe(complete);
  });
});

describe('cuatro imágenes', () => {
  const section = (n: number) => ({ headline: `Sección ${n}`, bodyText: `Texto ${n}`, image: image({ id: `img-${n}` }) });

  it('un módulo completo es válido', () => {
    expect(validateFourImages({ generalHeadline: 'Una caja. Muchas maneras de jugar.', sections: [1, 2, 3, 4].map(section) })).toEqual([]);
  });

  it('numera los errores por sección', () => {
    const content: FourImagesContent = {
      generalHeadline: '',
      sections: [
        { headline: '', bodyText: '', image: null },
        { headline: 'h'.repeat(81), bodyText: 'b'.repeat(201), image: image({ isValid: false, validationErrors: ['El archivo excede 2MB (actual: 2.5MB)'] }) },
        section(3),
        section(4),
      ],
    };
    expect(validateFourImages(content)).toEqual([
      'El titular general es obligatorio',
      'El titular de la sección 1 es obligatorio',
      'El texto de la sección 1 es obligatorio',
      'La imagen de la sección 1 es obligatoria',
      'El titular de la sección 2 excede 80 caracteres',
      'El texto de la sección 2 excede 200 caracteres',
      'Sección 2: El archivo excede 2MB (actual: 2.5MB)',
    ]);
  });
});
