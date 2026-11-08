import { Badge, Icon, LinkButton } from '@/shared/ui';
import type { Channel } from '@/shared/pim';
import {
  TAB_NAMES,
  plural,
  resultKey,
  sendState,
  type PublishPhase,
  type PublishResults,
  type Review,
} from '../../model/publishReview';
import type { PublishItem } from '../../model/types';

export interface PublishProductRowProps {
  item: PublishItem;
  review: Review;
  phase: PublishPhase;
  chosen: string[];
  results: PublishResults;
  lookup: (id: string) => Channel | null;
  /** «Completar en …»: cierra el diálogo y abre la ficha en esa pestaña. */
  onComplete?: (sku: string, tab: string) => void;
}

function StatusBadge({ item, review, phase, chosen, results }: PublishProductRowProps) {
  if (phase !== 'review') {
    const state = sendState(item, chosen, results, review.ready);
    if (state === 'skipped') return <Badge>No se envía</Badge>;
    if (state === 'pending') return <Badge tone="blue"><Icon name="loader" size={12} className="pim-spin" />Publicando…</Badge>;
    if (state === 'sent') return <Badge tone="green" icon="check-circle">Enviado</Badge>;
    return <Badge tone="red" icon="x-circle">No publicado</Badge>;
  }
  if (!chosen.length) return <Badge>Elige un canal</Badge>;
  if (review.ready) return <Badge tone="green" icon="check-circle">Listo</Badge>;
  return <Badge tone="amber" icon="alert-triangle">{plural(review.missing.length, 'dato por completar', 'datos por completar')}</Badge>;
}

function Detail({ item, review, phase, chosen, results, lookup, onComplete }: PublishProductRowProps) {
  if (phase !== 'review') {
    const rows = chosen.flatMap(id => {
      const channel = lookup(id);
      const state = results[resultKey(item.sku, id)];
      return channel && state && state.state !== 'pending' ? [{ channel, state }] : [];
    });
    if (!rows.length) {
      return review.ready ? null : <p className="pim-publish-note">No se envía: falta {review.missing.map(row => row.label).join(', ')}.</p>;
    }
    return (
      <ul className="pim-publish-results">
        {rows.map(({ channel, state }) => (
          <li key={channel.id} className={state.state === 'done' ? 'is-ok' : 'is-error'}>
            <Icon name={state.state === 'done' ? 'check-circle-2' : 'x-circle'} size={14} />
            <span><strong>{channel.label}:</strong> {state.message}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (!chosen.length) return null;
  if (!review.missing.length && !review.advice.length) {
    const names = chosen.map(id => lookup(id)?.label ?? id).join(' y ');
    return <p className="pim-publish-note is-ok"><Icon name="check-circle-2" size={14} />Cumple todo lo que pide {names}.</p>;
  }
  return (
    <ul className="pim-publish-checks">
      {review.missing.map(row => (
        <li key={`missing-${row.channel}-${row.label}`} className="is-missing">
          <Icon name="alert-triangle" size={14} />
          <span><strong>{row.label}</strong> · {row.hint}</span>
          {onComplete ? (
            <LinkButton data-open={item.sku} data-tab={row.tab} onClick={() => onComplete(item.sku, row.tab)}>
              Completar en {TAB_NAMES[row.tab] || 'la ficha'}
            </LinkButton>
          ) : null}
        </li>
      ))}
      {review.advice.map(row => (
        <li key={`advice-${row.channel}-${row.label}`} className="is-advice">
          <Icon name="info" size={14} />
          <span><strong>{row.label}</strong> · {row.hint}</span>
        </li>
      ))}
    </ul>
  );
}

/** Un producto en la revisión del diálogo «Publicar» (prototipo: productHTML). */
export function PublishProductRow(props: PublishProductRowProps) {
  const { item } = props;
  return (
    <li className="pim-publish-product">
      <span className="pim-publish-thumb">
        {item.image ? <img src={item.image} alt="" loading="lazy" decoding="async" /> : <Icon name="package" size={16} />}
      </span>
      <span className="pim-publish-product-text">
        <strong>{item.name || item.sku}</strong>
        <small className="pim-mono">{item.sku}</small>
      </span>
      <span className="pim-publish-status"><StatusBadge {...props} /></span>
      <div className="pim-publish-detail"><Detail {...props} /></div>
    </li>
  );
}
