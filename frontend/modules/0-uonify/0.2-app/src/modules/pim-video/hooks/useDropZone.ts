import { useState, type DragEvent } from 'react';
import { isVideoFile } from '../model/format';

/**
 * Arrastrar un vídeo al estado vacío o a la lista de vídeos (prototipo: [data-drop]
 * con la clase «is-over» mientras se arrastra un archivo encima).
 */
export function useDropZone(onFile: (file: File | undefined) => void) {
  const [over, setOver] = useState(false);
  const props = {
    'data-drop': '',
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
      event.preventDefault();
      setOver(true);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      setOver(false);
      const files = [...(event.dataTransfer?.files || [])];
      onFile(files.find(isVideoFile) || files[0]);
    },
  };
  return { over, props };
}
