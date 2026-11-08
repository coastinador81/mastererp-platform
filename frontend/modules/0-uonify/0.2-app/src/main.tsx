import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { USE_MOCKS } from '@/shared/api/config';
import '@/shared/styles/index.css';

// Con datos simulados (por defecto en desarrollo) arranca MSW antes de pintar:
// así la primera petición ya la atiende la simulación del backend.
async function start() {
  if (USE_MOCKS) {
    const { startMockWorker } = await import('@/shared/mocks/browser');
    await startMockWorker();
  } else if ('serviceWorker' in navigator) {
    // Al pasar a backend real, retirar solo el worker de MSW de este origen.
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.filter(reg =>
      [reg.active, reg.waiting, reg.installing].some(worker => worker?.scriptURL.endsWith('/mockServiceWorker.js')),
    ).map(reg => reg.unregister()));
    if (navigator.serviceWorker.controller?.scriptURL.endsWith('/mockServiceWorker.js')) {
      window.location.reload();
      return;
    }
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
