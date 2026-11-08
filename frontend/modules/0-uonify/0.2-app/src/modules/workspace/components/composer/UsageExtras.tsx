import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { toast } from '@/shared/ui';
import { choosePayer } from '../../api/aiBilling';
import { openLimitDialog, setUsageSnapshot, usageSnapshot } from '../../hooks/limitActions';
import type { UsageLimitInfo } from '../../model/aiLimit';

/** Forma de pago de Uony y acceso al aviso del límite de uso. */
export function UsagePayerNote({ info }: { info: UsageLimitInfo }) {
  const [busy, setBusy] = useState(false);
  if (info.payer === 'uonify_tokens') {
    const backToChatGpt = async () => {
      setBusy(true);
      try {
        const result = await choosePayer('chatgpt');
        setUsageSnapshot(result.usage ?? { ...(usageSnapshot() ?? {}), payer: 'chatgpt' });
        toast.success('Uony vuelve a tu plan de ChatGPT');
      } catch (error) {
        toast.error('No se ha podido cambiar la forma de pago', { description: errorMessage(error) });
      } finally {
        setBusy(false);
      }
    };
    return (
      <p className="composer-usage-payer">
        <span>Uony usa tus tokens de Uonify en esta sesión.</span>
        <button type="button" className="pim-link" aria-busy={busy || undefined} disabled={busy} onClick={() => void backToChatGpt()}>
          Volver a ChatGPT
        </button>
      </p>
    );
  }
  if (!info.reached) return null;
  return (
    <p className="composer-usage-payer is-limit">
      <span>Has llegado al límite de tu plan de ChatGPT.</span>
      <button type="button" className="pim-link" onClick={() => openLimitDialog('send')}>
        Elegir cómo seguir
      </button>
    </p>
  );
}

