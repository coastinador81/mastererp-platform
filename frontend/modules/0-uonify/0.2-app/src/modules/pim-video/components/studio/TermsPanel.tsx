import { dialog, type DialogAction } from '@/shared/ui';
import { TERMS_TEXT, TERMS_TITLE } from '../../model/constants';

/**
 * Condiciones de los modelos de IA (prototipo: pim/video.js, askTerms). Texto
 * aprobado por el abogado del dueño, tal cual. «Aceptar y generar» se activa al
 * marcar la casilla; se aceptan una vez, antes del primer vídeo.
 */
function TermsPanel({ onChange }: { onChange: (checked: boolean) => void }) {
  return (
    <div className="pim-video-terms">
      <p><strong>{TERMS_TITLE}</strong> {TERMS_TEXT}</p>
      <label className="pim-video-terms-check">
        <input type="checkbox" className="pim-check" data-autofocus onChange={event => onChange(event.currentTarget.checked)} /> He leído y acepto estas condiciones.
      </label>
    </div>
  );
}

const termsActions = (checked: boolean): DialogAction[] => [
  { label: 'Cancelar', variant: 'outline', value: false },
  { label: 'Aceptar y generar', icon: 'uony', variant: 'primary', value: true, disabled: !checked },
];

/** Pide la aceptación; resuelve true solo con «Aceptar y generar». */
export function askTerms(): Promise<boolean> {
  return new Promise(resolve => {
    dialog.open({
      title: 'Condiciones de los modelos de IA',
      description: 'Se aceptan una vez, antes de tu primer vídeo.',
      size: 'md',
      body: ({ update }) => <TermsPanel onChange={checked => update({ actions: termsActions(checked) })} />,
      actions: termsActions(false),
      onClose: result => resolve(result === true),
    });
  });
}
