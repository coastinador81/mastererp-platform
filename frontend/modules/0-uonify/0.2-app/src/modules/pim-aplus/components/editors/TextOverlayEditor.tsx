import { useCallback } from 'react';
import { Badge, Icon } from '@/shared/ui';
import { useAplusController } from '../../hooks/aplusContext';
import { TO } from '../../model/constants';
import { str } from '../../model/content';
import { CounterRow, invalidProps, LabelText, Limit } from '../FieldParts';
import { ImageDropzone, ImagePanel, ImageSlot } from '../ImageParts';
import type { EditorProps } from './editorTypes';
import { RichTextEditor } from './RichTextEditor';

/** Superposición de texto oscuro e imagen estándar (TextOverlayModule, E25-E34). */
export function TextOverlayEditor({ module, dom: d, dialogs }: EditorProps<'text-overlay'>) {
  const controller = useAplusController();
  const { id, content } = module;
  const headline = str(content.headline);
  const bodyText = str(content.bodyText);
  const image = content.backgroundImage;
  const onBodyChange = useCallback((text: string) => controller.setBodyText(id, text), [controller, id]);

  return (
    <div className="pim-aplus-editor">
      <div className="pim-aplus-ai">
        <button type="button" className="pim-btn pim-btn-ai" data-focus-key={`${d}-ai`} onClick={dialogs.openAi}>
          <Icon name="uony" size={16} />
          Generar con Uony
        </button>
        <p className="pim-hint">Conectado automáticamente con atributos e imágenes del producto • O completa manualmente</p>
      </div>
      <div className="pim-aplus-cols">
        <div className="pim-field">
          <label className="pim-label" htmlFor={`${d}-headline`}>
            <LabelText>Titular</LabelText> <Limit>{`Máx. ${TO.headline}`}</Limit>
          </label>
          <input
            id={`${d}-headline`}
            {...invalidProps(headline.length > TO.headline, 'pim-input')}
            value={headline}
            onChange={event => controller.setField(id, 'headline', 0, event.target.value)}
            placeholder="Escribe un titular impactante..."
            maxLength={TO.headline + 10}
            aria-describedby={`${d}-headline-count`}
            autoComplete="off"
          />
          <CounterRow id={`${d}-headline-count`} length={headline.length} max={TO.headline} suffix=" caracteres" />
        </div>
        <div className="pim-field">
          <span className="pim-label" id={`${d}-body-label`}>
            <LabelText>Texto del cuerpo</LabelText>{' '}
            <span className="pim-aplus-label-end">
              <Limit>{`Máx. ${TO.body}`}</Limit> <Badge>Editor enriquecido</Badge>
            </span>
          </span>
          <RichTextEditor
            id={`${d}-body`}
            labelledBy={`${d}-body-label`}
            describedBy={`${d}-body-count`}
            formatNoteId={`${d}-fmt`}
            value={bodyText}
            invalid={bodyText.length > TO.body}
            onChange={onBodyChange}
          />
          <CounterRow id={`${d}-body-count`} length={bodyText.length} max={TO.body} suffix=" caracteres" />
        </div>
      </div>
      <div className="pim-field">
        <span className="pim-label">
          <LabelText>Imagen de fondo</LabelText> <Limit mono>{`Min. ${TO.minW}x${TO.minH}px`}</Limit>
        </span>
        <ImageSlot hasImage={Boolean(image)}>
          {image ? (
            <ImagePanel image={image} focusKey={`${d}-to-img`} onPreview={dialogs.openPreview} onRemove={() => controller.removeImage(id, null)} />
          ) : (
            <>
              <ImageDropzone
                title="Añadir imagen de fondo"
                text="Arrastra y suelta o haz clic para seleccionar"
                hint={`.jpg, .png, .bmp • <2MB • Mín. ${TO.minW}×${TO.minH}px`}
                focusKey={`${d}-to-img`}
                onOpen={() => dialogs.openUpload(null)}
                onFile={file => void controller.uploadImage(id, null, file)}
              />
              <div className="pim-aplus-slot-actions">
                <button type="button" className="pim-btn pim-btn-ai pim-btn-sm" data-focus-key={`${d}-suggest`} onClick={() => controller.suggestImage(id)}>
                  <Icon name="uony" size={14} />
                  Sugerir desde galería del producto
                </button>
              </div>
            </>
          )}
        </ImageSlot>
      </div>
    </div>
  );
}
