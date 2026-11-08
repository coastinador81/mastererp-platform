import { useEffect, useId, useRef, useState } from 'react';
import clsx from 'clsx';
import { Icon } from '@/shared/ui';
import { LOCALE_LABELS } from '@/shared/i18n';
import { LANGUAGE_OPTIONS } from '../../model/account';
import type { LanguageCode } from '../../model/types';

/**
 * Selector de idioma «mundito»: un globo con el idioma actual que despliega la
 * lista (Configuración → Cuenta). Español por defecto; el inglés aparece como
 * «próximamente» y no se puede elegir hasta que exista la traducción de la app
 * (ver `LANGUAGE_OPTIONS`). El selector nunca va en la cabecera del chat.
 */
export function LanguageGlobe({ value, onChange }: { value: LanguageCode; onChange: (value: LanguageCode) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); root.current?.querySelector<HTMLButtonElement>('.uset-lang-trigger')?.focus(); } };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const pick = (next: LanguageCode) => { onChange(next); setOpen(false); };

  return (
    <div className="uset-lang" ref={root}>
      <button type="button" className="uset-lang-trigger" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(value2 => !value2)}>
        <Icon name="globe" size={18} className="uset-lang-globe" />
        <span className="uset-lang-current">{LOCALE_LABELS[value]}</span>
        <Icon name="chevron-down" size={16} className="uset-lang-caret" />
      </button>
      {open && (
        <ul className="uset-lang-menu" role="listbox" id={listId} aria-label="Idioma" aria-activedescendant={`${listId}-${value}`}>
          {LANGUAGE_OPTIONS.map(option => {
            const selected = option.value === value;
            const disabled = Boolean(option.disabled);
            return (
              <li
                key={option.value}
                id={`${listId}-${option.value}`}
                role="option"
                aria-selected={selected}
                aria-disabled={disabled || undefined}
                tabIndex={disabled ? -1 : 0}
                className={clsx('uset-lang-option', selected && 'is-selected', disabled && 'is-disabled')}
                onClick={() => { if (!disabled) pick(option.value); }}
                onKeyDown={event => { if (!disabled && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); pick(option.value); } }}
              >
                <span className="uset-lang-label">{option.label}</span>
                {selected ? <Icon name="check" size={16} className="uset-lang-check" /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
