import { Dialog, Icon } from '@/shared/ui';
import { MODULE_TYPES } from '../../model/constants';
import type { EditableModuleType } from '../../model/types';

/** «Selecciona el tipo de módulo» (E19): una opción por tipo con sus requisitos. */
export function ModulePickerDialog({ onPick, onClose }: { onPick: (type: EditableModuleType) => void; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} size="lg" className="pim-aplus-dialog" title={<span className="pim-aplus-dlg-title">Selecciona el tipo de módulo</span>}>
      <div className="pim-aplus-dlg">
        <div className="pim-aplus-picker">
          {MODULE_TYPES.map(type => (
            <button key={type.id} type="button" className="pim-option pim-aplus-type" data-type={type.id} onClick={() => onPick(type.id)}>
              <span className="pim-aplus-type-icon">
                <Icon name={type.icon} size={18} />
              </span>
              <span className="pim-aplus-type-title">{type.title}</span>
              <span className="pim-aplus-type-desc">{type.description}</span>
              <span className="pim-aplus-type-req">
                <strong>Requisitos:</strong>
                <br />
                <span className="pim-mono">{type.requirements}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
