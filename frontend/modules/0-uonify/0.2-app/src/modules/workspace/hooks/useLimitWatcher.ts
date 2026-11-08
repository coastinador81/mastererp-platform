import { useEffect } from 'react';
import { limitInfo } from '../model/aiLimit';
import { openLimitDialog } from './limitActions';
import { useUsage } from './useUsage';

// Límite para el que ya se abrió el aviso (sobrevive a que el marco se vuelva a montar).
let announcedLimit: string | null = null;

/**
 * Cuando el uso del plan de ChatGPT llega al 100 % (GET /ai/usage o la respuesta de
 * un mensaje), abre el aviso una vez por límite agotado. Si el cliente elige esperar,
 * no vuelve a abrirse solo: se abre de nuevo al intentar enviar. En las páginas
 * (Configuración) no interrumpe: se abrirá al volver al lienzo o a un servicio.
 */
export function useLimitWatcher(enabled: boolean): void {
  const { usage } = useUsage();
  const info = limitInfo(usage);
  const key = info.reached && info.payer === 'chatgpt' ? info.label || 'limit' : null;
  useEffect(() => {
    if (!key) {
      announcedLimit = null;
      return;
    }
    if (!enabled || announcedLimit === key) return;
    announcedLimit = key;
    openLimitDialog('usage');
  }, [key, enabled]);
}

/** Solo para pruebas: olvida el último aviso abierto. */
export function resetLimitWatcher(): void {
  announcedLimit = null;
}
