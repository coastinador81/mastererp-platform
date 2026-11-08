import type { Ref } from 'react';
import clsx from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import { Icon } from '@/shared/ui';
import { useAplus, useAplusController } from '../hooks/aplusContext';
import type { SaveOperation } from '../model/types';

const SAVE_BUTTONS: { operation: SaveOperation; className: string; icon: string; label: string; busy: string }[] = [
  { operation: 'draft', className: 'pim-btn pim-btn-outline', icon: 'save', label: 'Guardar borrador', busy: 'Guardando...' },
  { operation: 'link', className: 'pim-btn pim-btn-outline', icon: 'link', label: 'Guardar y enlazar', busy: 'Guardando y enlazando...' },
  { operation: 'publish', className: 'pim-btn pim-btn-primary', icon: 'upload-cloud', label: 'Publicar en Amazon', busy: 'Publicando...' },
];

/**
 * Barra de acciones con una sola acción sólida: «Añadir módulo» mientras no hay
 * módulos; después, «Publicar en Amazon» (Añadir módulo pasa a secundaria).
 */
export function AplusActions({ onAdd, addRef }: { onAdd: () => void; addRef: Ref<HTMLButtonElement> }) {
  const controller = useAplusController();
  const { hasModules, publishing, blocked } = useAplus(useShallow(state => ({
    hasModules: state.modules.length > 0,
    publishing: state.publishing,
    blocked: state.publishing || state.loading,
  })));

  return (
    <div className={clsx('pim-aplus-actions', !hasModules && 'is-empty')}>
      <button ref={addRef} type="button" className={clsx('pim-btn', hasModules ? 'pim-btn-outline' : 'pim-btn-primary', 'pim-aplus-add')} onClick={onAdd}>
        <Icon name="plus" size={16} />
        Añadir módulo
      </button>
      <div className="pim-aplus-save">
        {SAVE_BUTTONS.map(button => (
          <button
            key={button.operation}
            type="button"
            className={button.className}
            data-action={`save-${button.operation}`}
            hidden={!hasModules}
            aria-disabled={blocked}
            onClick={() => {
              if (!blocked) void controller.save(button.operation);
            }}
          >
            {publishing ? <Icon name="loader" size={16} className="pim-spin" /> : <Icon name={button.icon} size={16} />}
            {publishing ? button.busy : button.label}
          </button>
        ))}
      </div>
    </div>
  );
}
