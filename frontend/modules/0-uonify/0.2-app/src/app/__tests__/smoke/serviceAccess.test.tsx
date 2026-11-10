import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { enterWithDemoAccount, openServicePanel, renderApp, seedCompleteAccount, settle, setupSmokeServer } from './harness';

// jsdom no tiene WebGL: <model-viewer> se queda sin definir, como antes de cargar.
vi.mock('@google/model-viewer', () => ({}));

setupSmokeServer();
seedCompleteAccount();

describe('servicio pulsado sin sesión en el panel de la cabecera (de extremo a extremo)', () => {
  test('ERP abre «Entra en Uonify» sin salir de la página y, al entrar, el espacio abre ERP', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/productos');
    const panel = await openServicePanel(user);
    await user.click(within(panel).getByRole('button', { name: 'ERP' }));
    expect(await screen.findByRole('dialog', { name: 'Entra en Uonify' }, { timeout: 5000 })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/productos');
    await enterWithDemoAccount(user);
    await waitFor(() => expect(router.state.location.pathname).toBe('/espacio/erp'), { timeout: 20000 });
    await settle();
  }, 40000);
});
