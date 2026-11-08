import { useRef } from 'react';
import { Button, IconButton } from '@/shared/ui';
import { useAplusController } from '../../hooks/aplusContext';
import { SP } from '../../model/constants';
import { str } from '../../model/content';
import type { ModuleOf } from '../../model/types';
import { CounterRow, invalidProps, LabelText, Limit } from '../FieldParts';
import { rescueFocus } from '../focus';

/** Bloques de descripción y viñetas del módulo de especificaciones (E35-E43). */
interface ListProps {
  module: ModuleOf<'specifications'>;
  dom: string;
}

export function SpecsBlocks({ module, dom: d }: ListProps) {
  const controller = useAplusController();
  const ref = useRef<HTMLDivElement>(null);
  const blocks = module.content.blocks || [];
  // Si el control con el foco desaparece, el foco pasa al primero del grupo.
  const rescue = () => rescueFocus(ref.current);

  return (
    <div className="pim-aplus-stack" ref={ref}>
      {blocks.map((block, index) => {
        const headline = str(block.headline);
        const subtitle = str(block.subtitle);
        const body = str(block.body);
        return (
          <div className="pim-aplus-block" key={index}>
            <div className="pim-aplus-block-head">
              <span className="pim-aplus-block-title">{`Bloque ${index + 1}`}</span>
              {blocks.length > 1 ? (
                <IconButton
                  icon="x"
                  label={`Eliminar bloque ${index + 1}`}
                  tooltipAlign="end"
                  className="pim-aplus-delete"
                  data-focus-key={`${d}-block-x-${index}`}
                  onClick={() => {
                    controller.removeBlock(module.id, index);
                    rescue();
                  }}
                />
              ) : null}
            </div>
            {index === 0 ? (
              <div className="pim-field">
                <label className="pim-label" htmlFor={`${d}-b${index}-h`}>
                  <LabelText>Headline</LabelText> <Limit>{`Máx. ${SP.blockHeadline}`}</Limit>
                </label>
                <input
                  id={`${d}-b${index}-h`}
                  {...invalidProps(headline.length > SP.blockHeadline, 'pim-input')}
                  value={headline}
                  onChange={event => controller.setField(module.id, 'block.headline', index, event.target.value)}
                  placeholder="Titular del bloque..."
                  autoComplete="off"
                />
              </div>
            ) : null}
            <div className="pim-field">
              <label className="pim-label" htmlFor={`${d}-b${index}-s`}>
                <LabelText>Subtitle</LabelText> <Limit>{`Máx. ${SP.subtitle}`}</Limit>
              </label>
              <input
                id={`${d}-b${index}-s`}
                {...invalidProps(subtitle.length > SP.subtitle, 'pim-input')}
                value={subtitle}
                onChange={event => controller.setField(module.id, 'block.subtitle', index, event.target.value)}
                placeholder="Subtítulo..."
                autoComplete="off"
              />
            </div>
            <div className="pim-field">
              <label className="pim-label" htmlFor={`${d}-b${index}-b`}>
                <LabelText>Body</LabelText> <Limit>{`Máx. ${SP.body}`}</Limit>
              </label>
              <textarea
                id={`${d}-b${index}-b`}
                {...invalidProps(body.length > SP.body, 'pim-textarea', 'pim-aplus-textarea-100')}
                value={body}
                onChange={event => controller.setField(module.id, 'block.body', index, event.target.value)}
                placeholder="Texto del cuerpo..."
                aria-describedby={`${d}-b${index}-b-count`}
              />
              <CounterRow id={`${d}-b${index}-b-count`} length={body.length} max={SP.body} noWarn />
            </div>
          </div>
        );
      })}
      {blocks.length < SP.maxBlocks ? (
        <Button
          size="sm"
          icon="plus"
          className="pim-aplus-add-inline"
          data-focus-key={`${d}-add-block`}
          onClick={() => {
            controller.addBlock(module.id);
            rescue();
          }}
        >
          Añadir bloque
        </Button>
      ) : null}
    </div>
  );
}

export function SpecsBullets({ module, dom: d }: ListProps) {
  const controller = useAplusController();
  const ref = useRef<HTMLDivElement>(null);
  const bullets = module.content.bulletPoints || [];
  const full = bullets.length >= SP.maxBullets;
  const rescue = () => rescueFocus(ref.current);

  return (
    <div className="pim-aplus-stack pim-aplus-stack-tight" ref={ref}>
      <div className="pim-aplus-bullets-head">
        <span className="pim-label pim-aplus-label-inline" id={`${d}-bullets-label`}>
          Viñetas <Limit>{`Máx. ${SP.bullet}`}</Limit>
        </span>
        <Button size="sm" icon="plus" data-focus-key={`${d}-add-bullet`} disabled={full} onClick={() => controller.addBullet(module.id)}>
          Añadir
        </Button>
      </div>
      {bullets.map((bullet, index) => {
        const value = str(bullet);
        return (
          <div className="pim-aplus-bullet" key={index}>
            <input
              {...invalidProps(value.length > SP.bullet, 'pim-input')}
              data-focus-key={`${d}-bullet-${index}`}
              value={value}
              onChange={event => controller.setField(module.id, 'bullet', index, event.target.value)}
              placeholder={`• Punto ${index + 1}...`}
              maxLength={SP.bullet + 10}
              aria-label={`Viñeta ${index + 1}`}
              autoComplete="off"
            />
            {bullets.length > 1 ? (
              <IconButton
                icon="x"
                label={`Eliminar viñeta ${index + 1}`}
                tooltipAlign="end"
                className="pim-aplus-delete"
                data-focus-key={`${d}-bullet-x-${index}`}
                onClick={() => {
                  controller.removeBullet(module.id, index);
                  rescue();
                }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
