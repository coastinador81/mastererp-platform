import { Button } from '@/shared/ui';
import { useAplusController } from '../../hooks/aplusContext';
import { FI } from '../../model/constants';
import { str } from '../../model/content';
import { CounterRow, invalidProps, LabelText, Limit } from '../FieldParts';
import { ImageDropzone, ImagePanel, ImageSlot } from '../ImageParts';
import type { EditorProps } from './editorTypes';

/** Cuatro imágenes y texto estándares (FourImagesModule, E44-E50): cuadrícula 2×2. */
export function FourImagesEditor({ module, dom: d, dialogs }: EditorProps<'four-images'>) {
  const controller = useAplusController();
  const { id, content } = module;
  const general = str(content.generalHeadline);

  return (
    <div className="pim-aplus-editor">
      <div className="pim-field">
        <label className="pim-label" htmlFor={`${d}-general`}>
          <LabelText>Titular general</LabelText> <Limit>{`Máx. ${FI.general}`}</Limit>
        </label>
        <input
          id={`${d}-general`}
          {...invalidProps(general.length > FI.general, 'pim-input')}
          value={general}
          onChange={event => controller.setField(id, 'generalHeadline', 0, event.target.value)}
          placeholder="Escribe un titular que unifique las cuatro secciones..."
          maxLength={FI.general + 10}
          aria-describedby={`${d}-general-count`}
          autoComplete="off"
        />
        <CounterRow id={`${d}-general-count`} length={general.length} max={FI.general} suffix=" caracteres" />
      </div>
      <div className="pim-aplus-group">
        <div className="pim-aplus-group-head">
          <span className="pim-aplus-group-title">Cuatro secciones con imagen y texto</span>
          <Limit>Cuadrícula 2×2</Limit>
        </div>
        <div className="pim-aplus-sections">
          {(content.sections || []).map((section, index) => {
            const headline = str(section.headline);
            const bodyText = str(section.bodyText);
            const n = index + 1;
            return (
              <section className="pim-aplus-section" aria-labelledby={`${d}-s${index}-title`} key={index}>
                <h4 className="pim-aplus-section-title" id={`${d}-s${index}-title`}>{`Sección ${n}`}</h4>
                <div className="pim-field">
                  <label className="pim-label" htmlFor={`${d}-s${index}-h`}>
                    <LabelText>Titular</LabelText> <Limit>{`Máx. ${FI.headline}`}</Limit>
                  </label>
                  <input
                    id={`${d}-s${index}-h`}
                    {...invalidProps(headline.length > FI.headline, 'pim-input')}
                    value={headline}
                    onChange={event => controller.setField(id, 'section.headline', index, event.target.value)}
                    placeholder={`Titular para sección ${n}...`}
                    maxLength={FI.headline + 10}
                    aria-describedby={`${d}-s${index}-h-count`}
                    autoComplete="off"
                  />
                  <CounterRow id={`${d}-s${index}-h-count`} length={headline.length} max={FI.headline} iconOnly />
                </div>
                <div className="pim-field">
                  <label className="pim-label" htmlFor={`${d}-s${index}-b`}>
                    <LabelText>Texto</LabelText> <Limit>{`Máx. ${FI.body}`}</Limit>
                  </label>
                  <textarea
                    id={`${d}-s${index}-b`}
                    {...invalidProps(bodyText.length > FI.body, 'pim-textarea', 'pim-aplus-textarea-80')}
                    value={bodyText}
                    onChange={event => controller.setField(id, 'section.bodyText', index, event.target.value)}
                    placeholder={`Describe los detalles para la sección ${n}...`}
                    maxLength={FI.body + 10}
                    aria-describedby={`${d}-s${index}-b-count`}
                  />
                  <CounterRow id={`${d}-s${index}-b-count`} length={bodyText.length} max={FI.body} iconOnly />
                </div>
                <div className="pim-field">
                  <span className="pim-label">
                    <LabelText>Imagen</LabelText> <Limit mono>{`Min. ${FI.minW}×${FI.minH}px`}</Limit>
                  </span>
                  <ImageSlot hasImage={Boolean(section.image)}>
                    {section.image ? (
                      <ImagePanel
                        image={section.image}
                        focusKey={`${d}-fi-img-${index}`}
                        index={index}
                        compact
                        labels={['OK', 'Error']}
                        onPreview={dialogs.openPreview}
                        onRemove={() => controller.removeImage(id, index)}
                      />
                    ) : (
                      <ImageDropzone
                        title={`Añadir imagen ${n}`}
                        text="Arrastra o haz clic"
                        focusKey={`${d}-fi-img-${index}`}
                        compact
                        onOpen={() => dialogs.openUpload(index)}
                        onFile={file => void controller.uploadImage(id, index, file)}
                      />
                    )}
                  </ImageSlot>
                </div>
              </section>
            );
          })}
        </div>
      </div>
      <div className="pim-aplus-editor-foot">
        <Button size="sm" icon="eye" data-focus-key={`${d}-preview-four`} onClick={dialogs.openPreview}>
          Vista previa del módulo
        </Button>
      </div>
    </div>
  );
}
