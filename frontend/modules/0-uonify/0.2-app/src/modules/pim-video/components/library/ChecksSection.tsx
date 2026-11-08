import { Icon } from '@/shared/ui';
import { AMAZON_ADS_CONNECTED } from '../../model/constants';
import { destinationOf } from '../../model/format';
import { missingRequirements, requirements, rowState } from '../../model/requirements';
import type { VideoItem } from '../../model/types';

/**
 * Requisitos de Amazon según el destino (prototipo: checksHTML): filas con estado;
 * el color solo dice si cumple. El título recibe el foco cuando falta algo.
 */
export function ChecksSection({ video, asin, headingId }: { video: VideoItem; asin: string; headingId: string }) {
  const rows = requirements(video, asin);
  const missing = missingRequirements(rows).length;
  const ads = destinationOf(video) === 'ads';
  // Sin conexión con Amazon Ads, el anuncio se descarga (decisión del dueño).
  const ready = ads ? (AMAZON_ADS_CONNECTED ? 'Listo para enviar' : 'Listo para descargar') : 'Listo para subir';
  return (
    <section className="pim-section is-divided" aria-labelledby={headingId}>
      <div className="pim-section-head">
        <h3 className="pim-section-title" id={headingId} tabIndex={-1}>{ads ? 'Requisitos de Amazon Ads' : 'Requisitos de la ficha de Amazon'}</h3>
        <span className={`pim-badge ${missing ? 'pim-badge-amber' : 'pim-badge-green'}`}>
          <Icon name={missing ? 'alert-triangle' : 'check-circle'} size={12} />
          {missing ? `${missing} por revisar` : ready}
        </span>
      </div>
      <ul className="pim-video-checks">
        {rows.map(row => {
          const tone = row.ok ? 'is-ok' : row.required ? 'is-warn' : 'is-optional';
          const mark = row.ok ? 'check-circle-2' : row.required ? 'alert-triangle' : 'info';
          return (
            <li key={row.id} className={`pim-video-check ${tone}`}>
              <span className="pim-video-check-mark" aria-hidden="true"><Icon name={mark} size={16} /></span>
              <span className="pim-video-check-text"><strong>{row.label}</strong><small>{row.need}</small></span>
              <span className={`pim-video-check-value${row.text ? '' : ' pim-mono'}`}>{row.value}<span className="pim-sr-only"> · {rowState(row)}</span></span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
