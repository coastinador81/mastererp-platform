import { useAplusController } from '../../hooks/aplusContext';
import { SP } from '../../model/constants';
import { str } from '../../model/content';
import { CounterRow, invalidProps, LabelText, Limit } from '../FieldParts';
import { ImageDropzone, ImagePanel, ImageSlot } from '../ImageParts';
import type { EditorProps } from './editorTypes';
import { SpecsBlocks, SpecsBullets } from './SpecsLists';

/** Detalles de especificaciones y una sola imagen estándar (SpecificationsModule, E35-E43). */
export function SpecsEditor({ module, dom: d, dialogs }: EditorProps<'specifications'>) {
  const controller = useAplusController();
  const { id, content } = module;
  const main = str(content.mainHeadline);
  const specHeadline = str(content.specificationHeadline);
  const image = content.image;

  return (
    <div className="pim-aplus-editor pim-aplus-editor-specs">
      <div className="pim-field">
        <label className="pim-label" htmlFor={`${d}-main`}>
          <LabelText>Titular principal</LabelText> <Limit>{`Máx. ${SP.main}`}</Limit>
        </label>
        <input
          id={`${d}-main`}
          {...invalidProps(main.length > SP.main, 'pim-input')}
          value={main}
          onChange={event => controller.setField(id, 'mainHeadline', 0, event.target.value)}
          placeholder="Título principal de las especificaciones..."
          maxLength={SP.main + 10}
          aria-describedby={`${d}-main-count`}
          autoComplete="off"
        />
        <CounterRow id={`${d}-main-count`} length={main.length} max={SP.main} suffix=" caracteres" />
      </div>
      <div className="pim-aplus-cols">
        <div className="pim-field">
          <span className="pim-label">
            <LabelText>Imagen de especificaciones</LabelText> <Limit mono>{`Min. ${SP.minW}x${SP.minH}px`}</Limit>
          </span>
          <ImageSlot hasImage={Boolean(image)}>
            {image ? (
              <ImagePanel image={image} focusKey={`${d}-sp-img`} onPreview={dialogs.openPreview} onRemove={() => controller.removeImage(id, null)} />
            ) : (
              <ImageDropzone
                title="Añadir imagen"
                text="Arrastra y suelta o haz clic para seleccionar"
                hint={`.jpg, .png, .bmp • <2MB • Mín. ${SP.minW}×${SP.minH}px`}
                focusKey={`${d}-sp-img`}
                onOpen={() => dialogs.openUpload(null)}
                onFile={file => void controller.uploadImage(id, null, file)}
              />
            )}
          </ImageSlot>
        </div>
        <div className="pim-aplus-stack">
          <SpecsBlocks module={module} dom={d} />
          <div className="pim-field pim-aplus-divided">
            <label className="pim-label" htmlFor={`${d}-spec`}>
              <LabelText>Specification Headline</LabelText> <Limit>{`Máx. ${SP.blockHeadline}`}</Limit>
            </label>
            <input
              id={`${d}-spec`}
              {...invalidProps(specHeadline.length > SP.blockHeadline, 'pim-input')}
              value={specHeadline}
              onChange={event => controller.setField(id, 'specificationHeadline', 0, event.target.value)}
              placeholder="Titular de especificaciones..."
              autoComplete="off"
            />
          </div>
          <SpecsBullets module={module} dom={d} />
        </div>
      </div>
    </div>
  );
}
