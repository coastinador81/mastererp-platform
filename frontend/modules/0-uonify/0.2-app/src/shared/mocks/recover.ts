import { USE_MOCKS } from '@/shared/api/config';

/** Solo el adaptador local: nunca cambia el modo de autenticación del backend real. */
export async function recoverMockWorker(): Promise<void> {
  if (!USE_MOCKS || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const { restartMockWorker } = await import('./browser');
  await restartMockWorker();
}
