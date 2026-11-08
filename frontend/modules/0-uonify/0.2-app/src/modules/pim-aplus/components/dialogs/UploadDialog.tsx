import { useRef, useState } from 'react';
import clsx from 'clsx';
import { Dialog, Icon } from '@/shared/ui';
import { useAplusController } from '../../hooks/aplusContext';
import { FI, IMAGE_ACCEPT, SP, TO } from '../../model/constants';
import type { AplusModule } from '../../model/types';

/** «Cargar imagen» de cada hueco (E31 / E41 / E48). */
function uploadCopy(module: AplusModule, index: number | null) {
  if (module.type === 'text-overlay') return { title: 'Cargar imagen de fondo', min: [TO.minW, TO.minH], requirements: 'Requisitos:' };
  if (module.type === 'specifications') return { title: 'Cargar imagen de especificaciones', min: [SP.minW, SP.minH], requirements: 'Requisitos:' };
  return { title: `Cargar imagen para sección ${(index ?? 0) + 1}`, min: [FI.minW, FI.minH], requirements: 'Requisitos por imagen:' };
}

export interface UploadDialogProps {
  module: AplusModule;
  index: number | null;
  onClose: () => void;
}

export function UploadDialog({ module, index, onClose }: UploadDialogProps) {
  const controller = useAplusController();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const copy = uploadCopy(module, index);

  // Se cierra solo si la imagen quedó colocada; con un error sigue abierto.
  const select = async (file: File) => {
    if (await controller.uploadImage(module.id, index, file)) onClose();
  };

  return (
    <Dialog open onClose={onClose} size="md" className="pim-aplus-dialog" title={<span className="pim-aplus-dlg-title">{copy.title}</span>}>
      <div className="pim-aplus-dlg">
        <div className="pim-aplus-upload">
          <div
            className={clsx('pim-dropzone pim-aplus-upload-zone', over && 'pim-aplus-drop-over')}
            onDragOver={event => {
              event.preventDefault();
              setOver(true);
            }}
            onDragLeave={event => {
              event.preventDefault();
              setOver(false);
            }}
            onDrop={event => {
              event.preventDefault();
              setOver(false);
              const file = event.dataTransfer?.files?.[0];
              if (file) void select(file);
            }}
          >
            <Icon name="upload" size={24} />
            <p className="pim-aplus-upload-title">Arrastra tu imagen aquí</p>
            <p className="pim-aplus-upload-sub">o selecciona un archivo</p>
            <button type="button" className="pim-btn pim-btn-primary" onClick={() => inputRef.current?.click()}>
              Seleccionar archivo
            </button>
            <input
              ref={inputRef}
              type="file"
              accept={IMAGE_ACCEPT}
              hidden
              tabIndex={-1}
              aria-hidden="true"
              data-file=""
              onChange={event => {
                const file = event.target.files?.[0];
                // E31/E41/E48: se vacía tras cada elección para poder repetir el mismo archivo.
                event.target.value = '';
                if (file) void select(file);
              }}
            />
          </div>
          <div className="pim-aplus-req">
            <p>
              <strong>{copy.requirements}</strong>
            </p>
            <ul>
              <li>
                Formatos: <span className="pim-mono">.jpg, .png, .bmp</span> (solo RGB)
              </li>
              <li>
                Tamaño máximo: <span className="pim-mono">2MB</span>
              </li>
              <li>
                Dimensiones mínimas: <span className="pim-mono">{`${copy.min[0]} × ${copy.min[1]}`}</span> píxeles
              </li>
              <li>
                Resolución mínima: <span className="pim-mono">72 ppp</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
