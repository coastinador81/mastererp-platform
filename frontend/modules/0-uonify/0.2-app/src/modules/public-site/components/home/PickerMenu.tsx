import { forwardRef, type KeyboardEvent } from 'react';

export interface PickerOption { id: string; label: string; detail?: string; hidden?: boolean }

interface PickerMenuProps {
  id: string;
  className: string;
  optionClassName: string;
  /** Atributo de datos de cada opción (data-model-id o data-effort-id), como el PROTO. */
  optionData: 'data-model-id' | 'data-effort-id';
  title: string;
  options: readonly PickerOption[];
  selected: string;
  open: boolean;
  onPick: (id: string) => void;
  onClose: () => void;
}

/**
 * Menú de opciones con una elegida (role="menu" + menuitemradio): flechas, Inicio y
 * Fin se mueven dentro; Tab sale y cierra. Las opciones no están en el orden de
 * tabulación (tabIndex -1), igual que en composer-tools.js.
 */
export const PickerMenu = forwardRef<HTMLDivElement, PickerMenuProps>(function PickerMenu(
  { id, className, optionClassName, optionData, title, options, selected, open, onPick, onClose }, ref,
) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') { onClose(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(`[${optionData}]`)].filter(item => !item.hidden);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };
  return (
    <div ref={ref} className={className} id={id} role="menu" aria-label={title} hidden={!open} onKeyDown={onKeyDown}>
      <div className="composer-picker-title">{title}</div>
      {options.map(option => (
        <button
          key={option.id}
          type="button"
          className={optionClassName}
          {...{ [optionData]: option.id }}
          tabIndex={-1}
          role="menuitemradio"
          aria-checked={option.id === selected}
          hidden={option.hidden}
          onClick={() => onPick(option.id)}
        >
          <span className="composer-model-copy"><strong>{option.label}</strong>{option.detail ? <small>{option.detail}</small> : null}</span>
          <span className="composer-option-check" aria-hidden="true">✓</span>
        </button>
      ))}
    </div>
  );
});
