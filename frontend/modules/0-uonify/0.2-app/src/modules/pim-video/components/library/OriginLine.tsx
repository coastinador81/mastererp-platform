import { Icon } from '@/shared/ui';
import { fallbackLine, resultLine } from '../../model/project';
import type { Generation } from '../../model/types';

/** Origen de un vídeo creado con IA: modelo, audio y saldo, y el respaldo si lo hubo (textos aprobados). */
export function OriginLine({ generation }: { generation: Generation | null | undefined }) {
  if (!generation) return null;
  const fallback = fallbackLine(generation);
  return (
    <p className="pim-video-origin">
      <Icon name="sparkles" size={14} />
      <span>{resultLine(generation)}{fallback ? <small>{fallback}</small> : null}</span>
    </p>
  );
}
