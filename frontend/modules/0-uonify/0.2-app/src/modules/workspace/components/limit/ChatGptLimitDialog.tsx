import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, errorMessage } from '@/shared/api/client';
import { Button, Dialog, toast } from '@/shared/ui';
import { choosePayer, getTokenBalance, getTokenQuote } from '../../api/aiBilling';
import { focusComposer, openWorkspacePage } from '../../hooks/actions';
import { useComposerStore } from '../../hooks/composerStore';
import { closeLimitDialog, setUsageSnapshot, usageSnapshot } from '../../hooks/limitActions';
import { useUiStore } from '../../hooks/uiStore';
import { useUsage } from '../../hooks/useUsage';
import { formatTokens, limitInfo, limitSentence, type TokenAmount } from '../../model/aiLimit';
import { settingsPath } from '../moduleBridge';

/**
 * Aviso del límite del plan de ChatGPT (decisión del dueño, 27-09-2026). Se abre
 * cuando el uso llega al 100 %, al intentar enviar con el plan agotado o si el
 * servidor rechaza un mensaje (429). El cliente elige: «Esperar», «Seguir con tokens
 * de Uonify» (con el saldo y el precio a la vista; sin plan, el servidor responde 402
 * y billing abre el muro de pago) o «Ver uso». Nunca se cambia de forma de pago en
 * silencio. El foco empieza en «Esperar», la opción que no gasta nada.
 */
function amountText(query: { data?: TokenAmount | null; isPending: boolean }, prefix = ''): string {
  if (query.isPending) return 'Consultando…';
  return query.data ? `${prefix}${formatTokens(query.data)}` : 'No disponible ahora';
}

export function ChatGptLimitDialog() {
  const reason = useUiStore(state => state.limitDialog);
  const open = reason !== null;
  const { usage } = useUsage();
  const info = limitInfo(usage);
  const model = useComposerStore(state => state.model);
  const effort = useComposerStore(state => state.effort);
  const speed = useComposerStore(state => state.speed);
  const [busy, setBusy] = useState(false);
  const costId = useId();

  const balance = useQuery({
    queryKey: ['workspace', 'uonify-tokens'],
    queryFn: ({ signal }) => getTokenBalance(signal),
    enabled: open,
    retry: false,
    staleTime: 0,
  });
  const quote = useQuery({
    queryKey: ['workspace', 'uonify-token-quote', model, effort, speed],
    queryFn: ({ signal }) => getTokenQuote({ model, effort, speed }, signal),
    enabled: open,
    retry: false,
    staleTime: 60_000,
  });

  if (!open) return null;

  // Tras enviar (o un rechazo), el texto sigue en el compositor: el foco vuelve allí.
  const close = () => {
    closeLimitDialog();
    if (reason !== 'usage') focusComposer();
  };

  const payWithTokens = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await choosePayer('uonify_tokens');
      setUsageSnapshot(result.usage ?? { ...(usageSnapshot() ?? {}), payer: 'uonify_tokens' });
      closeLimitDialog();
      toast.success('Uony sigue con tus tokens de Uonify', { description: 'Solo durante esta sesión. Puedes volver a tu plan de ChatGPT desde el uso del compositor.' });
      focusComposer();
    } catch (error) {
      // 402: el cliente HTTP ya avisó a billing, que abre el muro de pago; este aviso le deja sitio.
      if (error instanceof ApiError && error.status === 402) closeLimitDialog();
      else toast.error('No se ha podido cambiar la forma de pago', { description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const seeUsage = () => {
    closeLimitDialog();
    openWorkspacePage(settingsPath('uso'));
  };

  return (
    <Dialog
      open
      onClose={close}
      className="uony-limit-dialog"
      title="Has llegado al límite de tu plan de ChatGPT"
      description={limitSentence(info)}
      footer={
        <>
          <Button variant="ghost" onClick={seeUsage}>Ver uso</Button>
          <Button variant="outline" data-autofocus onClick={close}>Esperar</Button>
          <Button variant="primary" loading={busy} aria-describedby={costId} onClick={() => void payWithTokens()}>
            Seguir con tokens de Uonify
          </Button>
        </>
      }
    >
      <div className="uony-limit">
        
        <p>Uony no cambia de forma de pago por su cuenta. Elige cómo quieres seguir:</p>
        <ul className="uony-limit-options">
          <li>
            <strong>Esperar</strong>
            <span>Uony vuelve a trabajar con tu plan de ChatGPT en cuanto se restablezca, sin coste para ti.</span>
          </li>
          <li>
            <strong>Seguir con tokens de Uonify</strong>
            <span id={costId}>
              Solo durante esta sesión. Cada mensaje cuesta {amountText(quote, 'unos ')} con el modelo y el esfuerzo que tienes elegidos.
            </span>
            <dl className="uony-limit-balance">
              <div>
                <dt>Tu saldo</dt>
                <dd className="pim-mono">{amountText(balance)}</dd>
              </div>
            </dl>
          </li>
          <li>
            <strong>Ver uso</strong>
            <span>Consulta tus límites de ChatGPT y tus tokens de Uonify en Configuración.</span>
          </li>
        </ul>
      </div>
    </Dialog>
  );
}
