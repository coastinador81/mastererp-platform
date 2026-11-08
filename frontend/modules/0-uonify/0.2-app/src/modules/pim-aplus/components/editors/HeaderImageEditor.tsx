import { useAplusController } from '../../hooks/aplusContext';
import { str } from '../../model/content';
import { LabelText } from '../FieldParts';
import { FallbackImg } from '../ImageParts';
import type { EditorProps } from './editorTypes';

/** Imagen de encabezado estándar (E23): llega de Amazon; solo su título es editable. */
export function HeaderImageEditor({ module, dom: d }: EditorProps<'header-image'>) {
  const controller = useAplusController();
  const { id, content } = module;
  return (
    <div className="pim-aplus-editor">
      <div className="pim-field">
        <label className="pim-label" htmlFor={`${d}-header-title`}>Título (opcional)</label>
        <input
          id={`${d}-header-title`}
          className="pim-input"
          value={str(content.headline)}
          onChange={event => controller.setField(id, 'headline', 0, event.target.value)}
          placeholder="Título del encabezado"
          autoComplete="off"
        />
      </div>
      <div className="pim-field">
        <span className="pim-label">
          <LabelText>Imagen de encabezado</LabelText> <span className="pim-aplus-limit pim-mono">(970x300px)</span>
        </span>
        {content.image?.url ? <FallbackImg image={content.image} className="pim-aplus-header-img" alt={content.image.altText || 'Imagen de encabezado'} /> : null}
      </div>
    </div>
  );
}
