import { Dialog } from '@/shared/ui';
import { str } from '../../model/content';
import type { AplusModule } from '../../model/types';
import { FallbackImg } from '../ImageParts';

/** Vistas previas (E32 / E42 / E49): el módulo tal como se verá en Amazon. */
export function canPreview(module: AplusModule): boolean {
  if (module.type === 'text-overlay') return Boolean(module.content.backgroundImage);
  if (module.type === 'specifications') return Boolean(module.content.image);
  return module.type === 'four-images';
}

export function AplusPreviewBody({ module }: { module: AplusModule }) {
  if (module.type === 'text-overlay') {
    const c = module.content;
    return (
      <div className="pim-aplus-pv-overlay">
        <FallbackImg image={c.backgroundImage} className="pim-aplus-pv-overlay-img" />
        <div className="pim-aplus-pv-shade">
          <h2>{c.headline || 'Tu titular aparecerá aquí'}</h2>
          <p>{c.bodyText || 'El texto del cuerpo aparecerá aquí'}</p>
        </div>
      </div>
    );
  }
  if (module.type === 'specifications') {
    const c = module.content;
    const bullets = (c.bulletPoints || []).filter(bullet => str(bullet).trim());
    return (
      <div className="pim-aplus-pv-specs">
        <div>
          <FallbackImg image={c.image} className="pim-aplus-pv-specs-img" />
        </div>
        <div className="pim-aplus-pv-specs-text">
          <h2>{c.mainHeadline || 'Titular principal aparecerá aquí'}</h2>
          {(c.blocks || []).map((block, i) => (
            <div className="pim-aplus-pv-block" key={i}>
              {block.headline ? <h3>{block.headline}</h3> : null}
              {block.subtitle ? <h4>{block.subtitle}</h4> : null}
              {block.body ? <p>{block.body}</p> : null}
            </div>
          ))}
          {c.specificationHeadline ? <h3>{c.specificationHeadline}</h3> : null}
          {bullets.length ? (
            <ul>
              {bullets.map((bullet, i) => <li key={i}>{bullet}</li>)}
            </ul>
          ) : null}
        </div>
      </div>
    );
  }
  if (module.type === 'four-images') {
    const c = module.content;
    return (
      <div className="pim-aplus-pv-four">
        <h2>{c.generalHeadline || 'Tu titular general aparecerá aquí'}</h2>
        <div className="pim-aplus-pv-four-grid">
          {(c.sections || []).map((section, index) => (
            <div className="pim-aplus-pv-four-item" key={index}>
              {section.image ? (
                <FallbackImg image={section.image} className="pim-aplus-pv-four-img" />
              ) : (
                <div className="pim-aplus-pv-four-empty">
                  <span>{`Imagen ${index + 1}`}</span>
                </div>
              )}
              <h3>{section.headline || `Titular ${index + 1}`}</h3>
              <p>{section.bodyText || `Texto de la sección ${index + 1}`}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
}

const TITLES: Partial<Record<AplusModule['type'], string>> = {
  'text-overlay': 'Vista previa del módulo',
  specifications: 'Vista previa del módulo de especificaciones',
  'four-images': 'Vista previa del módulo - Cuatro imágenes con texto',
};

export function PreviewDialog({ module, onClose }: { module: AplusModule; onClose: () => void }) {
  if (!canPreview(module)) return null;
  return (
    <Dialog open onClose={onClose} size="lg" className="pim-aplus-dialog" title={<span className="pim-aplus-dlg-title">{TITLES[module.type]}</span>}>
      <div className="pim-aplus-dlg">
        <AplusPreviewBody module={module} />
      </div>
    </Dialog>
  );
}
