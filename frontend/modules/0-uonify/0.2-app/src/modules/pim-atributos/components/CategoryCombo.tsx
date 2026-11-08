import { useCallback, useRef } from 'react';
import clsx from 'clsx';
import { useTabContext } from '@/shared/pim';
import { Icon } from '@/shared/ui';
import { useCategorySearch } from '../hooks/useCategorySearch';

/**
 * «Categoría»: buscador de categorías (product types) de Amazon con lista
 * flotante (combobox con aria-activedescendant, como el prototipo).
 */
export function CategoryCombo({ uid, category }: { uid: string; category: string | number }) {
  const ctx = useTabContext();
  const optionId = useCallback((index: number) => `${uid}-cat-${index}`, [uid]);
  const inputRef = useRef<HTMLInputElement>(null);
  const combo = useCategorySearch(ctx, category, optionId, inputRef);
  const listId = `${uid}-category-list`;
  return (
    <div className="pim-atributos-combo">
      <span className="pim-atributos-combo-icon" aria-hidden="true">
        <Icon name="search" size={14} />
      </span>
      <input
        ref={inputRef}
        id={`${uid}-category`}
        className={clsx('pim-input', combo.loading && 'is-loading')}
        type="text"
        data-category-input=""
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={combo.open}
        aria-controls={listId}
        aria-activedescendant={combo.open && combo.active >= 0 ? optionId(combo.active) : undefined}
        autoComplete="off"
        placeholder="Buscar categoría de Amazon..."
        value={combo.value}
        onChange={event => combo.onInput(event.target.value)}
        onKeyDown={combo.onKeyDown}
      />
      <span className="pim-atributos-combo-spinner" data-category-spinner="" hidden={!combo.loading} aria-hidden="true" />
      <ul className="pim-atributos-combo-list" id={listId} role="listbox" aria-labelledby={`${uid}-category-label`} data-category-list="" hidden={!combo.open}>
        {combo.results.map((cat, index) => (
          <li
            key={`${cat.name}-${index}`}
            className={clsx('pim-atributos-combo-option', index === combo.active && 'is-active')}
            role="option"
            id={optionId(index)}
            data-category-option=""
            aria-selected={index === combo.active}
            onMouseDown={combo.onOptionMouseDown}
            onClick={() => combo.select(index)}
          >
            <strong>{cat.displayName || cat.name}</strong>
            <small>{cat.name}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
