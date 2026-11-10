import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { enterWithDemoAccount, openServicePanel, renderApp, seedCompleteAccount, settle, setupSmokeServer } from './harness';

// jsdom no tiene WebGL: <model-viewer> se queda sin definir, como antes de cargar.
vi.mock('@google/model-viewer', () => ({}));

setupSmokeServer();
seedCompleteAccount();

describe('servicio pulsado sin sesión y acceso cerrado (de extremo a extremo)', () => {
  test('tras cerrar el acceso de ERP, «Iniciar sesión» entra en /espacio y no en ERP', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/productos');
    const panel = await openServicePanel(user);
    await user.click(within(panel).getByRole('button', { name: 'ERP' }));
    await user.click(await screen.findByRole('button', { name: 'Cerrar acceso' }, { timeout: 5000 }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Entra en Uonify' })).toBeNull());
    const header = document.querySelector<HTMLElement>('header.header--row');
    expect(header).not.toBeNull();
    await user.click(within(header as HTMLElement).getByRole('link', { name: /Iniciar sesión/ }));
    await enterWithDemoAccount(user);
    const location = () => `${router.state.location.pathname}${router.state.location.search}`;
    await waitFor(() => expect(location()).toBe('/espacio'), { timeout: 20000 });
    // La capa de bienvenida termina en el espacio, sin redirigir después a un servicio.
    await waitFor(() => expect(document.querySelector('#uon-workspace-transition[open]')).toBeNull(), { timeout: 5000 });
    await settle();
    expect(location()).toBe('/espacio');
  }, 40000);
});
