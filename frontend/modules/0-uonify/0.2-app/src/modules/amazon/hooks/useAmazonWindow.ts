import { useEffect, useRef, useState } from 'react';
import { ApiError, errorMessage } from '@/shared/api/client';
import { amazonApi } from '../api/amazonApi';
import { amazonFlowError, authorizationUrl } from '../model/authorization';

interface Pending { flowId?: string; started: number }
const TIMEOUT = 600_000;
export type AmazonConnectionPlacement = 'nexus' | 'conversation';

export function useAmazonWindow(onComplete: () => Promise<void>, loginUri?: string | null, placement: AmazonConnectionPlacement = 'nexus') {
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState('');
  const popup = useRef<Window | null>(null);
  const active = useRef<Pending | null>(null);
  const generation = useRef(0);
  const cancelling = useRef<number | null>(null);
  const mounted = useRef(true);
  const complete = useRef(onComplete);
  useEffect(() => { complete.current = onComplete; }, [onComplete]);
  const destination = placement === 'conversation' ? 'esta conversación' : 'Nexus';

  const closePopup = () => {
    try { popup.current?.close(); } catch { /* Amazon puede aislar la ventana. */ }
    popup.current = null;
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      closePopup();
      if (active.current?.flowId) void amazonApi.cancel(active.current.flowId).catch(() => {});
      active.current = null;
    };
  }, []);

  useEffect(() => {
    if (!pending?.flowId) return;
    const flowId = pending.flowId;
    let disposed = false;
    let polling = false;
    let finished = false;
    let timer: ReturnType<typeof setTimeout>;
    const stop = (text: string) => {
      finished = true;
      active.current = null;
      closePopup();
      window.focus();
      setPending(null);
      setMessage(text);
    };
    const poll = async () => {
      if (disposed || polling || finished) return;
      clearTimeout(timer);
      polling = true;
      try {
        // El servidor es la única fuente de verdad, aunque llegue un mensaje de otra ventana.
        const result = await amazonApi.flow(flowId);
        if (disposed || active.current?.flowId !== flowId) return;
        if (result.status === 'success') {
          finished = true;
          active.current = null;
          closePopup();
          window.focus();
          await complete.current();
          if (!disposed) { setPending(null); setMessage(`Amazon se ha conectado. Seguimos en ${destination}.`); }
          return;
        }
        if (result.status === 'error') { stop(amazonFlowError(result.error)); return; }
        if (Date.now() - pending.started > TIMEOUT) {
          await amazonApi.cancel(flowId);
          if (!disposed) stop(amazonFlowError('expired'));
          return;
        }
        // Una ventana cerrada puede ser el aislamiento de Amazon: no equivale a fallo.
        if (popup.current?.closed) setMessage('La ventana de Amazon se ha cerrado. Seguimos comprobando el resultado; puedes cancelar y volver a intentarlo.');
      } catch (error) {
        if (disposed) return;
        if (finished) { setPending(null); setMessage('Amazon ha autorizado la conexión, pero no podemos actualizar su estado. Pulsa «Comprobar conexión».'); return; }
        if (error instanceof ApiError && [401, 403, 404, 410].includes(error.status)) {
          stop(`La autorización ha caducado o tu sesión ha cambiado. Vuelve a conectar desde ${destination}.`); return;
        }
        setMessage(errorMessage(error, 'No podemos comprobar Amazon ahora. Reintentaremos automáticamente.'));
      } finally { polling = false; }
      if (!disposed && !finished) timer = setTimeout(() => void poll(), 2000);
    };
    const wake = () => { void poll(); };
    window.addEventListener('focus', wake);
    timer = setTimeout(() => void poll(), 500);
    return () => { disposed = true; clearTimeout(timer); window.removeEventListener('focus', wake); };
  }, [pending, destination]);

  const open = async (intentId?: string) => {
    if (active.current) return false;
    if (!loginUri) { setMessage('Amazon todavía no está disponible para conectar. Falta completar la configuración de Uonify.'); return false; }
    const width = Math.min(600, window.screen.availWidth || 600);
    const height = Math.min(760, window.screen.availHeight || 760);
    const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
    // La ventana se abre durante el clic, antes de esperar al backend.
    const child = window.open('about:blank', '_blank', `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`);
    if (!child) { setMessage('Tu navegador ha bloqueado la ventana de Amazon. Permite ventanas emergentes para Uonify y vuelve a pulsar el botón.'); return false; }
    popup.current = child;
    const operation = ++generation.current;
    active.current = { started: Date.now() };
    setPending(active.current);
    setMessage('');
    try {
      child.opener = null;
      child.document.title = 'Conectando con Amazon · Uonify';
      child.document.body.textContent = `Abriendo Amazon… Tu trabajo permanece en ${destination}.`;
      child.focus();
      const result = await amazonApi.start(intentId);
      if (!mounted.current || generation.current !== operation) {
        void amazonApi.cancel(result.flowId).catch(() => {});
        return false;
      }
      active.current = { flowId: result.flowId, started: Date.now() };
      const url = authorizationUrl(result, loginUri);
      child.location.replace(url);
      setPending(active.current);
      return true;
    } catch (error) {
      if (!mounted.current || generation.current !== operation) return false;
      if (active.current?.flowId) void amazonApi.cancel(active.current.flowId).catch(() => {});
      active.current = null;
      closePopup();
      setPending(null);
      setMessage(errorMessage(error));
      return false;
    }
  };
  const cancel = async () => {
    if (!active.current || cancelling.current === generation.current) return false;
    const previous = active.current;
    const operation = generation.current;
    const flowId = previous.flowId;
    cancelling.current = operation;
    try {
      if (flowId) await amazonApi.cancel(flowId);
      // Una respuesta antigua nunca debe cerrar una nueva ventana de autorización.
      if (!mounted.current || generation.current !== operation || active.current !== previous) return false;
      generation.current += 1;
      active.current = null;
      closePopup();
      window.focus();
      setPending(null);
      setMessage(`Conexión cancelada. Puedes volver a conectar Amazon desde ${destination}.`);
      return true;
    } catch (error) {
      if (mounted.current && generation.current === operation && active.current === previous) setMessage(errorMessage(error));
      return false;
    } finally { if (cancelling.current === operation) cancelling.current = null; }
  };
  return { pending, message, open, cancel, focus: () => { try { popup.current?.focus(); } catch { /* Ventana aislada. */ } } };
}
