import { create } from 'zustand';
import { getAdsConnection } from '../api/videoApi';

/**
 * Conexión con Amazon Ads (GET /amazon/ads/connection), compartida por las fichas.
 * Mientras no esté conectada (o no se sepa), el anuncio se descarga listo para
 * subirlo a Amazon Ads (decisión del dueño); conectada, se envía desde Uonify.
 * Se consulta como mucho una vez por minuto salvo que se fuerce (tras un 409).
 */
export type AdsConnectionStatus = 'idle' | 'loading' | 'ok' | 'unavailable';

export interface AdsConnectionState {
  state: AdsConnectionStatus;
  connected: boolean;
  account: string;
  at: number;
}

const INITIAL: AdsConnectionState = { state: 'idle', connected: false, account: '', at: 0 };

export const useAdsConnectionStore = create<AdsConnectionState>(() => ({ ...INITIAL }));

let pending: Promise<void> | null = null;

export function refreshAdsConnection(force = false): Promise<void> {
  if (pending) return pending;
  const current = useAdsConnectionStore.getState();
  if (!force && current.state !== 'idle' && Date.now() - current.at < 60000) return Promise.resolve();
  useAdsConnectionStore.setState({ state: current.state === 'ok' ? 'ok' : 'loading' });
  pending = getAdsConnection()
    .then(data => {
      useAdsConnectionStore.setState({ state: 'ok', connected: data?.connected === true, account: String(data?.account?.name || '') });
    })
    .catch(() => {
      // Sin respuesta, lo seguro es descargar: nunca se da por conectada.
      useAdsConnectionStore.setState({ state: 'unavailable', connected: false, account: '' });
    })
    .finally(() => {
      useAdsConnectionStore.setState({ at: Date.now() });
      pending = null;
    });
  return pending;
}

/** Amazon Ads conectado (confirmado por el servidor). */
export const adsConnected = (): boolean => useAdsConnectionStore.getState().connected;

/** Vuelve al estado inicial (pruebas). */
export function resetAdsConnection(): void {
  pending = null;
  useAdsConnectionStore.setState({ ...INITIAL });
}
