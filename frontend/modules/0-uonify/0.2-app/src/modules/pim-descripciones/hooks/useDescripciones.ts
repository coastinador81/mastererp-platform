import { USE_MOCKS } from '@/shared/api/config';
import { askProductAssistant } from '@/shared/pim';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { usePimScope, usePimSlice, useTabContext, type PimEdited } from '@/shared/pim';
import { useLatest } from '@/shared/hooks';
import { toast } from '@/shared/ui';
import { generateContent, type ContentField } from '../api/descripcionesApi';
import {
  bulletRows,
  changeBullet,
  clearBullet,
  codeValue,
  displayBulletPoints,
  filledBullets,
  keywordsValue,
  previewHtml,
} from '../model/content';
import { asKeywords, cell, textToHtml } from '../model/text';
import { handleAiGenerate } from './aiActivity';

/**
 * Datos y acciones de la pestaña Descripciones (prototipo: pim/descripciones.js).
 * - `edited` (description, keywords) se escribe con ctx.edit mientras la pestaña
 *   está montada; si una respuesta llega después, directamente en el almacén.
 * - `bullets` son seis posiciones de texto.
 * - Cada varita tiene su spinner (E06/E10/E14) y un resultado de Uony solo toca
 *   su propio campo sobre el estado actual (las ediciones de la espera se respetan).
 */
export function useDescripciones(rootRef: RefObject<HTMLElement | null>) {
  const ctx = useTabContext();
  const product = ctx.product;
  const scope = usePimScope();
  const [edited] = usePimSlice<PimEdited>('edited', {});
  const [storedBullets] = usePimSlice<unknown>('bullets', undefined);
  const [generating, setGenerating] = useState<ReadonlySet<string>>(() => new Set());
  const mounted = useRef(false);
  const latest = useLatest(ctx);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const current = edited || {};
  const readBullets = () => scope.get<unknown>('bullets');

  const patchEdited = (patch: PimEdited) => {
    if (mounted.current) latest.current.edit(patch);
    else scope.update<PimEdited>('edited', prev => ({ ...(prev || {}), ...patch }), {});
  };
  const setBullet = (index: number, value: string) => scope.set('bullets', changeBullet(readBullets(), product, index, value));

  const markGenerating = (field: string, on: boolean) => {
    if (!mounted.current) return;
    setGenerating(prev => {
      const next = new Set(prev);
      if (on) next.add(field);
      else next.delete(field);
      return next;
    });
  };

  /** handleGenerateAI (DescriptionsTab.tsx). */
  async function generate(field: ContentField) {
    if (!product) {
      toast.error('Selecciona un producto primero');
      return;
    }
    if (!USE_MOCKS) {
      const label = field === 'description' ? 'la descripción' : field === 'keywords' ? 'las palabras clave' : `la viñeta ${Number(field.split('-')[1]) + 1}`;
      askProductAssistant(`Redacta y guarda ${label} del producto ${product.sku} con los datos confirmados de la ficha. No inventes características.`);
      return;
    }
    markGenerating(field, true);
    handleAiGenerate(field);
    try {
      const existingBullets = displayBulletPoints(readBullets(), product).filter(bullet => cell(bullet).trim());
      const caracteristicas = Array.isArray(product.caracteristicas) ? product.caracteristicas : [];
      const result = await generateContent({
        ...product,
        bulletPoints: existingBullets,
        caracteristicas: [...caracteristicas, ...existingBullets],
        existing_bullets: existingBullets,
      }, field);
      if (field === 'description') {
        patchEdited({ description: textToHtml(result.description || result.bullet_points || '') });
        toast.success('Descripción generada');
      } else if (field === 'keywords') {
        if (result.keywords) {
          patchEdited({ keywords: asKeywords(result.keywords) });
          toast.success('Keywords generadas');
        }
      } else {
        const index = parseInt(field.split('-')[1], 10);
        if (Array.isArray(result.bullets_array) && result.bullets_array.length > 0) {
          setBullet(index, cell(result.bullets_array[0]).replace(/^• /, '').trim());
          toast.success(`Viñeta ${index + 1} generada`);
        } else if (result.bullet_points) {
          setBullet(index, cell(result.bullet_points).trim());
          toast.success(`Viñeta ${index + 1} generada`);
        }
      }
    } catch (error) {
      toast.error((error instanceof Error && error.message) || 'Error al generar contenido');
    } finally {
      markGenerating(field, false);
    }
  }

  /** «Añadir Viñeta» (E12): lleva a la siguiente fila vacía de las seis. */
  function addBullet() {
    const index = bulletRows(readBullets(), product).findIndex(bullet => !bullet.trim());
    if (index === -1) {
      toast.info('Todas las viñetas ya están visibles (máximo 6)');
      return;
    }
    const input = rootRef.current?.querySelector<HTMLTextAreaElement>(`[data-bullet="${index}"]`);
    if (!input) return;
    input.focus({ preventScroll: true });
    const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    input.scrollIntoView?.({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  return {
    hasProduct: Boolean(product),
    previewHtml: previewHtml(current, product),
    codeValue: codeValue(current, product),
    keywords: keywordsValue(current, product),
    rows: bulletRows(storedBullets, product),
    filled: filledBullets(storedBullets, product),
    isGenerating: (field: string) => generating.has(field),
    generate: (field: ContentField) => void generate(field),
    setDescription: (value: string) => patchEdited({ description: value }),
    setKeywords: (value: string) => patchEdited({ keywords: value }),
    setBullet,
    clearBullet: (index: number) => scope.set('bullets', clearBullet(readBullets(), product, index)),
    addBullet,
  };
}
