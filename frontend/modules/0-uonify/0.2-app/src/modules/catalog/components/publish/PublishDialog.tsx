import { useCallback, useEffect, useId, useRef, useState } from 'react';
import clsx from 'clsx';
import { Button, Dialog, Icon, toast } from '@/shared/ui';
import { getChannel, useChannels, type Channel } from '@/shared/pim';
import {
  dialogTitle,
  doneMessage,
  initialChannels,
  plural,
  publishLabel,
  readyItems,
  resultKey,
  reviewOf,
  summaryText,
  type PublishPhase,
  type PublishResults,
} from '../../model/publishReview';
import type { PublishRequest } from '../../model/types';
import { PublishProductRow } from './PublishProductRow';

export interface PublishDialogProps {
  request: PublishRequest;
  onClose: () => void;
  /** «Completar en …»: abre ese producto en esa pestaña. */
  onOpenProduct: (sku: string, tab: string) => void;
  /** Un envío correcto activa el canal en la ficha del producto. */
  onPublished: (sku: string, channel: string) => void;
}

/**
 * Diálogo «Publicar» (prototipo: pim/publicar.js): canales como opciones con casilla,
 * revisión de cada ficha para cada canal (lo obligatorio bloquea ese producto, lo
 * recomendado solo avisa), envío canal a canal con su resultado y una sola acción
 * sólida («Publicar…» y, al terminar, «Cerrar»). Mientras se publica, «Cancelar» no
 * cierra (los envíos ya han salido); si el diálogo se cierra, el resultado llega
 * como aviso.
 */
export function PublishDialog({ request, onClose, onOpenProduct, onPublished }: PublishDialogProps) {
  const channels = useChannels();
  const { items } = request;
  const [chosen, setChosen] = useState<string[]>(() => initialChannels(request.preselect, channels));
  const [phase, setPhase] = useState<PublishPhase>('review');
  const [results, setResults] = useState<PublishResults>({});
  const mounted = useRef(true);
  const publishButton = useRef<HTMLButtonElement>(null);
  const channelsId = useId();
  const reviewId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Al terminar, el foco pasa a «Cerrar» (el mismo botón).
  useEffect(() => {
    if (phase === 'done') publishButton.current?.focus({ preventScroll: true });
  }, [phase]);

  const lookup = useCallback((id: string): Channel | null => channels.find(channel => channel.id === id) ?? null, [channels]);
  const ready = readyItems(items, chosen, lookup);
  const summary = summaryText({ phase, items, chosen, results, ready: ready.length });

  const run = async () => {
    if (phase === 'done') {
      onClose();
      return;
    }
    if (phase !== 'review' || !ready.length) return;
    const queue = ready;
    const sending = [...chosen];
    let current: PublishResults = {};
    queue.forEach(item => sending.forEach(id => {
      current[resultKey(item.sku, id)] = { state: 'pending' };
    }));
    setPhase('publishing');
    setResults(current);
    let sent = 0;
    let failed = 0;
    for (const item of queue) {
      for (const id of sending) {
        const channel = getChannel(id);
        const key = resultKey(item.sku, id);
        try {
          if (!channel) throw new Error('No se pudo publicar.');
          const answer = await channel.publish(item.data);
          current = { ...current, [key]: { state: 'done', message: doneMessage(answer) } };
          sent += 1;
          try {
            onPublished(item.sku, id);
          } catch {
            /* La ficha ya no existe. */
          }
        } catch (error) {
          current = { ...current, [key]: { state: 'error', message: error instanceof Error && error.message ? error.message : 'No se pudo publicar.' } };
          failed += 1;
        }
        if (mounted.current) setResults(current);
      }
    }
    if (mounted.current) {
      // El diálogo ya enseña cada resultado (un aviso quedaría detrás del fondo).
      setPhase('done');
      return;
    }
    if (sent && !failed) toast.success(plural(sent, 'publicación enviada', 'publicaciones enviadas'));
    else if (sent) toast.warning(`${plural(sent, 'publicación enviada', 'publicaciones enviadas')}, ${plural(failed, 'con error', 'con errores')}`);
    else toast.error('No se pudo publicar', { description: Object.values(current).find(state => state.state === 'error')?.message });
  };

  const toggleChannel = (id: string, on: boolean) => {
    if (phase !== 'review') return;
    setChosen(list => (on ? [...list.filter(item => item !== id), id] : list.filter(item => item !== id)));
  };

  const footer = (
    <>
      {phase !== 'done' ? (
        <Button variant="outline" aria-disabled={phase === 'publishing' || undefined} onClick={() => phase !== 'publishing' && onClose()}>
          Cancelar
        </Button>
      ) : null}
      <Button
        ref={publishButton}
        variant="primary"
        icon={phase === 'review' ? 'send' : undefined}
        loading={phase === 'publishing'}
        disabled={phase === 'review' && ready.length === 0}
        aria-disabled={phase === 'publishing' || undefined}
        onClick={() => void run()}
      >
        {phase === 'review' ? publishLabel(ready.length) : phase === 'publishing' ? 'Publicando…' : 'Cerrar'}
      </Button>
    </>
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title={dialogTitle(items)}
      description="Elige los canales. Antes de enviar, Uonify revisa cada ficha para cada canal."
      size="lg"
      className="pim-publish-dialog"
      footer={footer}
    >
      <div className="pim-publish">
        <div className="pim-publish-content">
          <section className="pim-publish-section" aria-labelledby={channelsId}>
            <h3 className="pim-publish-title" id={channelsId}>Canales</h3>
            <div className="pim-publish-channels">
              {channels.map(channel => {
                const selected = chosen.includes(channel.id);
                const connected = typeof channel.connected === 'function' && channel.connected();
                return (
                  <label key={channel.id} className={clsx('pim-option pim-publish-channel', selected && 'is-selected')}>
                    <input
                      type="checkbox"
                      className="pim-check"
                      data-channel={channel.id}
                      checked={selected}
                      disabled={phase !== 'review'}
                      onChange={event => toggleChannel(channel.id, event.target.checked)}
                    />
                    <span className="pim-publish-logo">{channel.logo ? <img src={channel.logo} alt="" /> : <Icon name="globe" size={16} />}</span>
                    <span className="pim-publish-channel-text">
                      <strong>{channel.label}</strong>
                      <small>{channel.market || ''}</small>
                    </span>
                    <span className={clsx('pim-badge', connected ? 'pim-badge-green' : 'pim-badge-amber')}>
                      {connected ? 'Cuenta conectada' : 'Cuenta sin conectar'}
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="pim-publish-note">Los marketplaces que conectes en Nexus aparecerán aquí.</p>
          </section>
          <section className="pim-publish-section" aria-labelledby={reviewId}>
            <h3 className="pim-publish-title" id={reviewId}>Revisión antes de publicar</h3>
            <ul className="pim-publish-products">
              {items.map(item => (
                <PublishProductRow
                  key={item.sku}
                  item={item}
                  review={reviewOf(item, chosen, lookup)}
                  phase={phase}
                  chosen={chosen}
                  results={results}
                  lookup={lookup}
                  onComplete={(sku, tab) => {
                    onClose();
                    onOpenProduct(sku, tab);
                  }}
                />
              ))}
            </ul>
          </section>
        </div>
        <p className="pim-publish-summary" role="status">{summary}</p>
      </div>
    </Dialog>
  );
}
