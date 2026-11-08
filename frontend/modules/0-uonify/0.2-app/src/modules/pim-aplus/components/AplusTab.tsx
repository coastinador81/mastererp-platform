import { useRef, useState } from 'react';
import { Icon } from '@/shared/ui';
import { AplusControllerContext, useAplus, useAplusController, useAplusSetup } from '../hooks/aplusContext';
import type { EditableModuleType } from '../model/types';
import '../styles/aplus.css';
import '../styles/aplus-editors.css';
import '../styles/aplus-dialogs.css';
import { AplusActions } from './AplusActions';
import { AplusHeader } from './AplusHeader';
import { AplusNotes } from './AplusNotes';
import { ModulePickerDialog } from './dialogs/ModulePickerDialog';
import { focusSoon } from './focus';
import { ModuleCard } from './ModuleCard';

/**
 * Pestaña A+ (Contenido A+) de la ficha de producto. Anatomía del prototipo:
 * cabecera (título, documento y Recargar; datos y estados) → notas compactas →
 * módulos → barra de guardado con una única acción sólida.
 */
function AplusView() {
  const controller = useAplusController();
  const modules = useAplus(state => state.modules);
  const [picker, setPicker] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  // Tras eliminar, el foco pasa al módulo que ocupa su lugar o a «Añadir módulo».
  const deleteModule = (id: string) => {
    const nextId = controller.deleteModule(id);
    focusSoon(() => {
      if (!nextId) return addRef.current;
      const card = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-module-id]') ?? []).find(node => node.dataset.moduleId === nextId);
      return card?.querySelector<HTMLElement>('[data-action="delete-module"]');
    });
  };
  const pick = (type: EditableModuleType) => {
    setPicker(false);
    controller.addModule(type);
  };

  const count = modules.length;
  return (
    <div className="pim-aplus" ref={rootRef}>
      <AplusHeader />
      <AplusNotes asin={controller.asin} />
      <div className="pim-aplus-body">
        <div className="pim-aplus-list" hidden={count === 0}>
          {modules.map((module, index) => (
            <ModuleCard key={module.id} id={module.id} index={index} onDelete={deleteModule} />
          ))}
        </div>
        <div className="pim-empty pim-aplus-empty" hidden={count > 0}>
          <span className="pim-aplus-empty-icon">
            <Icon name="layers" size={20} />
          </span>
          <h3>Comienza creando tu primer módulo</h3>
          <p>Crea contenido premium que destaque tus productos con módulos personalizables de texto e imágenes</p>
        </div>
        <AplusActions onAdd={() => setPicker(true)} addRef={addRef} />
      </div>
      {picker ? <ModulePickerDialog onPick={pick} onClose={() => setPicker(false)} /> : null}
    </div>
  );
}

export function AplusTab() {
  const controller = useAplusSetup();
  return (
    <AplusControllerContext.Provider value={controller}>
      <AplusView />
    </AplusControllerContext.Provider>
  );
}
