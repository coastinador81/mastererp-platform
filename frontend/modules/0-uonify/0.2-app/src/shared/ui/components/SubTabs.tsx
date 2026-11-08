import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/registry';
import { tooltipAttrs } from './Button';

/**
 * Subpestañas dentro de una pestaña (prototipo: .pim-subtabs). Tres usos del PROTO:
 * - `tabs`   (tablist, p. ej. «Vídeos del producto | Crear con IA» en Vídeo o la vista AR de 3D)
 * - `radio`  (radiogroup segmentado, p. ej. destino y formato en Vídeo)
 * - `toggle` (conmutador con aria-pressed, p. ej. «Vista | HTML» en Descripciones)
 * En `tabs` y `radio` las flechas, Inicio y Fin mueven la selección (tabindex itinerante).
 */
export type SubTabsMode = 'tabs' | 'radio' | 'toggle';

export interface SubTabOption<V extends string = string> {
  value: V;
  label: ReactNode;
  icon?: IconName;
  /** Motivo por el que no se puede elegir (tooltip y descripción accesible). */
  disabled?: string | boolean;
  /** id del botón (p. ej. para aria-labelledby del panel). */
  id?: string;
  /** id del panel que controla (solo `tabs`). */
  controls?: string;
}

export interface SubTabsProps<V extends string = string> {
  options: SubTabOption<V>[];
  value: V;
  onChange: (value: V) => void;
  mode?: SubTabsMode;
  className?: string;
  iconSize?: number;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

export function SubTabs<V extends string = string>({
  options,
  value,
  onChange,
  mode = 'tabs',
  className,
  iconSize = 14,
  ...aria
}: SubTabsProps<V>) {
  const base = useId();
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const roving = mode !== 'toggle';
  const enabled = options.filter(option => !option.disabled);
  const selectedEnabled = enabled.some(option => option.value === value);

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!roving || !enabled.length) return;
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const current = enabled.findIndex(option => option.value === value);
    const last = enabled.length - 1;
    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = current >= last ? 0 : current + 1;
    else next = current <= 0 ? last : current - 1;
    const target = enabled[next];
    if (!target) return;
    refs.current.get(target.value)?.focus();
    if (target.value !== value) onChange(target.value);
  };

  const role = mode === 'tabs' ? 'tablist' : mode === 'radio' ? 'radiogroup' : undefined;
  return (
    <div className={clsx('pim-subtabs', className)} role={role} onKeyDown={move} {...aria}>
      {options.map((option, index) => {
        const selected = option.value === value;
        const reason = typeof option.disabled === 'string' ? option.disabled : '';
        const reasonId = reason ? `${base}-why-${index}` : undefined;
        const focusable = selected || (!selectedEnabled && enabled[0]?.value === option.value);
        const state = mode === 'tabs'
          ? { role: 'tab' as const, 'aria-selected': selected, 'aria-controls': option.controls }
          : mode === 'radio'
            ? { role: 'radio' as const, 'aria-checked': selected }
            : { 'aria-pressed': selected };
        return (
          <button
            key={option.value}
            ref={node => {
              if (node) refs.current.set(option.value, node);
              else refs.current.delete(option.value);
            }}
            type="button"
            id={option.id}
            tabIndex={roving ? (focusable ? 0 : -1) : undefined}
            aria-disabled={option.disabled ? true : undefined}
            aria-describedby={reasonId}
            {...state}
            {...tooltipAttrs({ tooltip: reason || undefined })}
            onClick={() => {
              if (option.disabled || selected) return;
              onChange(option.value);
            }}
          >
            {option.icon ? <Icon name={option.icon} size={iconSize} /> : null}
            {option.label}
            {reason ? <span className="pim-sr-only" id={reasonId}>{reason}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Alias con el nombre habitual del control segmentado (modo `radio` por defecto). */
export function Segmented<V extends string = string>(props: SubTabsProps<V>) {
  return <SubTabs mode="radio" {...props} />;
}
