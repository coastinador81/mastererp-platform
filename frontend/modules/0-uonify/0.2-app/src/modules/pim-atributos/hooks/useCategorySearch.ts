import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import type { PimTabContext } from '@/shared/pim';
import { productTypesOf, searchProductTypes } from '../api/atributosApi';
import { categoryDisplay } from '../model/productValues';
import type { CategoryOption } from '../model/types';
import { memory, useAtributosMemory } from './atributosMemory';

/**
 * Buscador de categorías de Amazon (prototipo: pim/atributos.js, E07/E23).
 * Acortar el texto, elegir o cerrar la lista invalida la petición en curso (ya
 * no reabre la lista ni deja el spinner). El término se recuerda por producto.
 */
export function useCategorySearch(
  ctx: PimTabContext,
  category: string | number,
  optionId: (index: number) => string,
  inputRef: RefObject<HTMLInputElement | null>,
) {
  const { key, isNew } = ctx;
  const { categoryTerm } = useAtributosMemory(key);
  const [results, setResults] = useState<CategoryOption[]>([]);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);
  const alive = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      reqId.current += 1;
    };
  }, []);

  useEffect(() => {
    if (active >= 0) document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
  }, [active, optionId]);

  const showResults = (list: CategoryOption[]) => {
    setResults(list);
    setActive(-1);
  };

  const close = () => {
    reqId.current += 1; // clearCategories también descarta la respuesta en curso
    showResults([]);
    setLoading(false);
  };

  const search = async (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      close();
      return;
    }
    const requestId = ++reqId.current;
    const current = () => alive.current && reqId.current === requestId;
    setLoading(true);
    try {
      const response = typeof ctx.categorySearch === 'function' ? await ctx.categorySearch(trimmed) : await searchProductTypes(trimmed);
      if (current()) showResults(productTypesOf(response));
    } catch {
      if (current()) showResults([]);
    } finally {
      if (current()) setLoading(false);
    }
  };

  const onInput = (value: string) => {
    // creación: setNewProduct({ category }) · edición: término + updateEditedData({ category })
    memory.patch(key, { categoryTerm: { term: value, forCategory: value } });
    ctx.edit({ category: value });
    void search(value);
  };

  const select = (index: number) => {
    const cat = results[index];
    if (!cat) return;
    if (isNew) ctx.edit({ category: cat.name });
    else ctx.edit({ category: cat.name, productType: cat.name });
    memory.patch(key, { categoryTerm: { term: cat.displayName || cat.name, forCategory: cat.name } });
    close();
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = results.length;
    if (!count) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((active + 1) % count);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((active - 1 + count) % count);
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      select(active);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  // Mantiene el foco en el campo mientras se pulsa una opción.
  const onOptionMouseDown = (event: MouseEvent) => event.preventDefault();

  return {
    value: categoryDisplay(category, categoryTerm),
    results,
    active,
    loading,
    open: results.length > 0,
    onInput,
    select,
    onKeyDown,
    onOptionMouseDown,
  };
}
