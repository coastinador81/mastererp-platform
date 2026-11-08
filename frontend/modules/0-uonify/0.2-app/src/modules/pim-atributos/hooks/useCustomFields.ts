import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { usePimScope, usePimSlice, type PimTabContext } from '@/shared/pim';
import { defaultCustomFields } from '../model/customFields';
import { createField, parseOptions } from '../model/fields';
import { attrSelector } from '../model/sheet';
import type { CustomField } from '../model/types';

/**
 * Campos personalizados de la pestaña (prototipo: pim/atributos.js, getFields,
 * addCustomField, removeCustomField, confirmCustomField, editCustomField).
 * Una sola lista en la porción `customFields`, compartida con Auditoría IA (E31).
 * Tras cada acción el foco va donde lo dejaba el prototipo.
 */
export function useCustomFields(ctx: PimTabContext, rootRef: RefObject<HTMLElement | null>) {
  const { isNew, product, key } = ctx;
  const [stored] = usePimSlice<CustomField[] | undefined>('customFields', undefined);
  const scope = usePimScope();
  // null = toda la lista entra con animación (primer pintado); si no, solo esos ids.
  const [entering, setEntering] = useState<ReadonlySet<string> | null>(null);
  const focusTarget = useRef<string | null>(null);

  const fields = useMemo<CustomField[]>(() => {
    if (Array.isArray(stored)) return stored;
    return isNew ? [] : defaultCustomFields(product, key);
  }, [stored, isNew, product, key]);

  useLayoutEffect(() => {
    const selector = focusTarget.current;
    if (!selector) return;
    focusTarget.current = null;
    rootRef.current?.querySelector<HTMLElement>(selector)?.focus();
  });

  // Lectura en el momento (respuestas que llegan tarde) y escritura por el ámbito del producto.
  const read = (): CustomField[] => {
    const current = scope.get<CustomField[] | undefined>('customFields');
    if (Array.isArray(current)) return current;
    return isNew ? [] : defaultCustomFields(product, key);
  };
  const write = (next: CustomField[]) => scope.set('customFields', next);
  const updateField = (id: string, patch: Partial<CustomField>) => write(read().map(field => (field.id === id ? { ...field, ...patch } : field)));
  const nameSelector = (id: string) => attrSelector('data-field-id', id, '[data-field-name]');

  return {
    fields,
    isEntering: (id: string) => entering === null || entering.has(id),
    read,
    updateField,
    add() {
      const list = read();
      const field = createField(list);
      write([...list, field]);
      setEntering(new Set([field.id]));
      focusTarget.current = nameSelector(field.id);
    },
    remove(id: string) {
      write(read().filter(field => field.id !== id));
      focusTarget.current = '[data-action="add-field"]';
    },
    confirm(id: string) {
      updateField(id, { isConfirmed: true });
      focusTarget.current = attrSelector('data-field-id', id, '[data-action="edit-field"]');
    },
    edit(id: string) {
      updateField(id, { isConfirmed: false });
      focusTarget.current = nameSelector(id);
    },
    rename: (id: string, name: string) => updateField(id, { name }),
    changeType: (id: string, type: string) => updateField(id, { type, value: type === 'checkbox' ? false : '' }),
    setOptionsText: (id: string, text: string) => updateField(id, { options: parseOptions(text) }),
    setValue: (id: string, value: CustomField['value']) => updateField(id, { value }),
  };
}

export type CustomFieldsApi = ReturnType<typeof useCustomFields>;
