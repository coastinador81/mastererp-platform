import { SubTabs, type SubTabOption } from '@/shared/ui';

/**
 * Control segmentado de opción única con su etiqueta (prototipo: pim/video.js,
 * segmentedHTML): `.pim-subtabs.pim-video-seg` como radiogroup; una opción apagada
 * lleva el motivo en tooltip y descripción accesible.
 */
interface VideoSegmentedProps<V extends string> {
  labelId: string;
  label: string;
  value: V;
  options: SubTabOption<V>[];
  onChange: (value: V) => void;
}

export function VideoSegmented<V extends string>({ labelId, label, value, options, onChange }: VideoSegmentedProps<V>) {
  return (
    <div className="pim-field">
      <span className="pim-label" id={labelId}>{label}</span>
      <SubTabs mode="radio" className="pim-video-seg" aria-labelledby={labelId} value={value} options={options} onChange={onChange} />
    </div>
  );
}
