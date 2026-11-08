import type { PimProduct } from '../context/types';

/**
 * Lista inicial de campos personalizados (prototipo: `UonifyPIM.defaultCustomFields`,
 * que registra Atributos). La ficha (catalog) la siembra en la porción
 * `customFields` la primera vez que se abre un producto, para que Atributos y
 * Auditoría IA compartan la misma lista.
 */
export type DefaultCustomFields = (product: PimProduct | null, key: string) => unknown[];

let provider: DefaultCustomFields | null = null;

export function registerDefaultCustomFields(fn: DefaultCustomFields): () => void {
  provider = fn;
  return () => {
    if (provider === fn) provider = null;
  };
}

/** La función registrada, o null si Atributos aún no la ha dado. */
export function getDefaultCustomFields(): DefaultCustomFields | null {
  return provider;
}
