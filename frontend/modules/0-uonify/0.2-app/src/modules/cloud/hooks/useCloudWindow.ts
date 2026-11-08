import { useEffect, useRef, useState } from 'react';
import { currentAccountEmail } from '@/modules/auth';
import { api, ApiError, errorMessage } from '@/shared/api/client';

type Mode = 'authorization' | 'billing';
interface Pending { mode: Mode; flowId?: string; started: number }
const validFlow = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function useCloudWindow(onComplete: (mode: Mode) => Promise<void>, connection: 'google-cloud' | 'google-drive' = 'google-cloud') {
  const account = currentAccountEmail();
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState('');
  const popup = useRef<Window | null>(null);
  const complete = useRef(onComplete);
  const active = useRef<Pending | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const cancelling = useRef<number | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => { complete.current = onComplete; }, [onComplete]);
  const current = () => mounted.current && !!account && currentAccountEmail() === account;
  const closePopup = () => {
    try { popup.current?.close(); } catch { /* Google puede aislar la ventana mediante COOP. */ }
    popup.current = null;
  };
  const cancelQuietly = (flowId?: string) => {
    if (validFlow(flowId) && account && currentAccountEmail() === account) {
      void api.delete(`/connections/${connection}/flows/${flowId}`, { signal: AbortSignal.timeout(10_000) }).catch(() => {});
    }
  };
  useEffect(() => {
    mounted.current = true;
    const dispose = () => {
      generation.current += 1;
      request.current?.abort(); request.current = null;
      closePopup(); cancelQuietly(active.current?.flowId); active.current = null;
    };
    const identityChanged = () => { dispose(); setPending(null); setMessage('Tu sesión ha cambiado. Vuelve a abrir la conexión.'); };
    window.addEventListener('uonify:identity-changed', identityChanged);
    return () => { mounted.current = false; dispose(); window.removeEventListener('uonify:identity-changed', identityChanged); };
    // La limpieza pertenece a la cuenta y al proveedor con los que se abrió este control.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, connection]);

  useEffect(() => {
    if (!pending || pending.mode !== 'authorization' || !pending.flowId) return;
    const flowId = pending.flowId;
    const operation = generation.current;
    const controller = new AbortController();
    let disposed = false, polling = false, finished = false;
    let timer: ReturnType<typeof setTimeout>;
    const live = () => !disposed && current() && generation.current === operation && active.current?.flowId === flowId;
    const stop = (text: string) => {
      finished = true; active.current = null;
      closePopup(); window.focus(); setPending(null); setMessage(text);
    };
    const poll = async () => {
      if (!live() || polling || finished) return;
      clearTimeout(timer);
      if (Date.now() - pending.started > 600_000) {
        cancelQuietly(flowId); stop('La autorización ha caducado. Sigues en Uonify; vuelve a conectar para intentarlo de nuevo.'); return;
      }
      polling = true;
      try {
        const result = await api.get<{ status: 'pending' | 'success' | 'error'; error?: string }>(`/connections/${connection}/flows/${flowId}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        if (!live()) return;
        if (result.status !== 'pending') {
          finished = true; active.current = null;
          closePopup(); window.focus();
          if (result.status === 'success') {
            await complete.current('authorization');
            if (!disposed && current() && generation.current === operation) setMessage('Cuenta conectada. Seguimos aquí, en Uonify.');
          } else setMessage(result.error === 'account_mismatch' ? 'La cuenta elegida no coincide con tu sesión de Uonify. Vuelve a conectar usando la misma cuenta. La otra cuenta no se ha conectado.' : 'No se ha completado la autorización. Sigues en Uonify; puedes reintentarlo.');
          if (!disposed && current() && generation.current === operation) setPending(null);
          return;
        }
      } catch (error) {
        if (disposed || !current() || generation.current !== operation) return;
        if (finished) { setPending(null); setMessage(errorMessage(error)); return; }
        if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
          stop('La autorización ha caducado o la sesión ha cambiado. Vuelve a conectar desde esta ventana.'); return;
        }
        setMessage(errorMessage(error));
      } finally { polling = false; }
      if (live() && !finished) timer = setTimeout(() => void poll(), 2000);
    };
    // El retorno solo despierta la consulta. Ningún mensaje de ventana concede acceso.
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('uonify-google-return');
    if (channel) channel.onmessage = event => { if (event.data?.flowId === flowId && live()) { window.focus(); void poll(); } };
    const wake = () => { void poll(); };
    window.addEventListener('focus', wake);
    timer = setTimeout(() => void poll(), 500);
    return () => { disposed = true; controller.abort(); clearTimeout(timer); channel?.close(); window.removeEventListener('focus', wake); };
    // El resultado siempre comprueba la cuenta, el intento y la vigencia antes de aplicarse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, connection, account]);

  const open = async (mode: Mode, email?: string, officialUrl?: string) => {
    if (active.current || !current()) return;
    const width = Math.min(mode === 'billing' ? 1000 : 560, window.screen.availWidth || 560);
    const height = Math.min(760, window.screen.availHeight || 760);
    const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
    const child = window.open('about:blank', '_blank', `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`);
    if (!child) { setMessage('Tu navegador ha bloqueado la ventana de Google. Permite ventanas emergentes para Uonify y vuelve a pulsar el botón.'); return; }
    popup.current = child;
    const operation = ++generation.current;
    const controller = new AbortController(); request.current = controller;
    active.current = { mode, started: Date.now() };
    setPending(active.current); setMessage('');
    try {
      child.opener = null;
      child.document.title = 'Conectando con Google · Uonify';
      child.document.body.textContent = 'Abriendo Google… Tu progreso permanece en Uonify.';
      child.focus();
      if (mode === 'billing') {
        const url = new URL(officialUrl ?? 'https://console.cloud.google.com/billing');
        if (url.origin !== 'https://console.cloud.google.com' || url.username || url.password) throw new Error('No se ha podido abrir una página oficial válida de Google.');
        if (email) url.searchParams.set('authuser', email);
        child.location.replace(url.href);
      } else {
        const result = await api.post<{ authUrl: string; flowId: string }>(`/connections/${connection}/start`, { popup: true }, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        if (!current() || operation !== generation.current) { cancelQuietly(result.flowId); return; }
        const url = new URL(result.authUrl);
        if (url.origin !== 'https://accounts.google.com' || url.username || url.password || !validFlow(result.flowId)) throw new Error('No se ha podido abrir una conexión válida con Google.');
        active.current = { mode, flowId: result.flowId, started: Date.now() };
        child.location.replace(url.href); setPending(active.current);
      }
    } catch (error) {
      if (!current() || operation !== generation.current) return;
      cancelQuietly(active.current?.flowId); active.current = null;
      closePopup(); setPending(null); setMessage(errorMessage(error));
    } finally { if (request.current === controller) request.current = null; }
  };
  const resume = async () => {
    const attempt = active.current;
    const operation = generation.current;
    if (!attempt || !current() || cancelling.current === operation) return;
    cancelling.current = operation;
    const controller = new AbortController(); request.current?.abort(); request.current = controller;
    try {
      if (attempt.flowId) await api.delete(`/connections/${connection}/flows/${attempt.flowId}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
      if (!current() || generation.current !== operation || active.current !== attempt) return;
      generation.current += 1; active.current = null;
      closePopup(); window.focus(); setPending(null);
      const completion = generation.current;
      await complete.current(attempt.mode);
      if (current() && generation.current === completion) setMessage(attempt.mode === 'billing' ? 'Hemos vuelto a consultar tu cuenta. Revisa los proyectos disponibles.' : 'Puedes volver a conectar Google. Tu progreso sigue guardado.');
    } catch (error) { if (current() && generation.current === operation) setMessage(errorMessage(error)); }
    finally {
      if (request.current === controller) request.current = null;
      if (cancelling.current === operation) cancelling.current = null;
    }
  };
  return { pending, message, open, resume, focus: () => { if (current()) try { popup.current?.focus(); } catch { /* Ventana aislada. */ } } };
}
