import { Icon, toast } from '@/shared/ui';
import { money } from '../../model/format';
import type { BalanceStatus } from '../../jobs/balance';

/**
 * Saldo disponible y «Generar vídeo», la única acción sólida del estudio
 * (prototipo: balanceHTML y generateButtonHTML). Apagado, el botón explica el motivo.
 */
interface StudioFooterProps {
  balance: { state: BalanceStatus; amount: number; currency: string; empty: boolean };
  locked: boolean;
  sending: boolean;
  generating: boolean;
  onGenerate: () => void;
}

export function generateBlockReason({ locked, generating, empty }: { locked: boolean; generating: boolean; empty: boolean }): string {
  if (locked) return 'Espera a que termine el vídeo en curso';
  if (generating) return 'Espera a que termine de rehacerse el plano';
  if (empty) return 'Recarga tu saldo para generar vídeos';
  return '';
}

export function StudioFooter({ balance, locked, sending, generating, onGenerate }: StudioFooterProps) {
  const why = sending ? '' : generateBlockReason({ locked, generating, empty: balance.empty });
  return (
    <div className="pim-video-footer">
      <p className="pim-video-note pim-video-balance" aria-live="polite">
        {balance.state === 'ok'
          ? <>Saldo disponible: <strong className="pim-mono">{money({ amount: balance.amount, currency: balance.currency })}</strong></>
          : balance.state === 'unavailable' ? 'Saldo no disponible' : 'Consultando saldo…'}
      </p>
      <span data-slot="generate">
        <button
          type="button"
          className="pim-btn pim-btn-primary"
          data-action="generate"
          aria-disabled={sending || Boolean(why) || undefined}
          aria-busy={sending || undefined}
          data-tooltip={why || undefined}
          data-tooltip-align={why ? 'end' : undefined}
          onClick={() => {
            if (sending) return;
            if (why) { toast.info(why); return; }
            onGenerate();
          }}
        >
          {sending ? <Icon name="loader" size={16} className="pim-spin" /> : <Icon name="uony" size={16} />}
          {sending ? 'Enviando…' : 'Generar vídeo'}
        </button>
      </span>
    </div>
  );
}
