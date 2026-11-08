import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { setupServer } from 'msw/node';
import { onPlanRequired, type PlanRequiredDetail } from '@/shared/api/planRequired';
import { HttpResponse, mock } from '@/shared/mocks/utils';
import { choosePayer, setLimitSimulation } from '../api/aiBilling';
import { useComposerStore } from '../hooks/composerStore';
import { useUiStore, workspaceRefs } from '../hooks/uiStore';
import { useWorkspaceStore } from '../hooks/workspaceStore';
import { handlers } from '../mocks/handlers';
import { renderWorkspace, resetStores } from './harness';

// Flujo del límite del plan de ChatGPT con la simulación real del espacio (MSW).
vi.mock('@/shared/mocks/utils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/shared/mocks/utils')>()),
  latency: () => Promise.resolve(),
}));
vi.mock('../components/authBridge', () => ({
  AuthDialogs: () => null,
  signOut: vi.fn(),
  requirePrompt: (_text: string, run: () => void) => {
    run();
    return Promise.resolve();
  },
  takePendingPrompt: () => '',
  useSession: () => ({ status: 'ready', user: { email: 'ana@uonify.com' }, profile: null }),
  useAccountSummary: () => ({ name: 'Ana', email: 'ana@uonify.com', initial: 'A', planLabel: 'Sin plan activo' }),
}));
vi.mock('../components/moduleBridge', () => ({
  HelpButton: () => null,
  NotificationsBell: () => null,
  settingsPath: (section = 'cuenta') => `/espacio/configuracion/${section}`,
}));

// El saldo es del módulo billing: aquí basta con su respuesta.
const server = setupServer(...handlers, http.get(mock('/billing/balance'), () => HttpResponse.json({ amount: 60, currency: 'EUR' })));
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

async function start({ limit, plan }: { limit: boolean; plan: boolean }) {
  resetStores('/espacio');
  await setLimitSimulation({ limitReached: limit, hasPlan: plan });
  await choosePayer('chatgpt');
}

const nbsp = (text: string | null) => String(text).replace(/[\u00a0\u202f]/g, ' ');
const findLimitDialog = () => screen.findByRole('dialog', { name: 'Has llegado al límite de tu plan de ChatGPT' });

function send(text: string) {
  const draft = screen.getByLabelText('Escribe a Uony');
  fireEvent.change(draft, { target: { value: text } });
  fireEvent.keyDown(draft, { key: 'Enter' });
}

describe('aviso del límite del plan de ChatGPT', () => {
  it('al llegar al 100 % se abre solo, con el saldo y el precio, y el foco en «Esperar»', async () => {
    await start({ limit: true, plan: false });
    renderWorkspace();
    const dialog = await findLimitDialog();
    expect(dialog).toHaveAccessibleDescription(/^Has usado todo el límite de tu plan de ChatGPT \(semanal · todos los modelos\)\. Se restablece el \S+, 3:00\.$/);
    await waitFor(() => expect(nbsp(within(dialog).getByText(/^Solo durante esta sesión/).textContent)).toMatch(/cuesta unos 4 tokens · 0,04 € con el modelo/));
    await waitFor(() => expect(nbsp(within(dialog).getByText(/tokens · 60,00 €$/).textContent)).toBe('6.000 tokens · 60,00 €'));
    expect(within(dialog).getByRole('button', { name: 'Esperar' })).toHaveFocus();
    expect(within(dialog).getByRole('button', { name: 'Seguir con tokens de Uonify' })).toHaveClass('pim-btn-primary');
    expect(within(dialog).getByRole('button', { name: 'Seguir con tokens de Uonify' })).toHaveAccessibleDescription(/Solo durante esta sesión/);
    // Un solo botón sólido.
    expect(dialog.querySelectorAll('.pim-btn-primary')).toHaveLength(1);
  });

  it('«Esperar» cierra sin cambiar nada; enviar después no llega a Uony y vuelve a preguntar', async () => {
    await start({ limit: true, plan: false });
    renderWorkspace();
    fireEvent.click(within(await findLimitDialog()).getByRole('button', { name: 'Esperar' }));
    expect(screen.queryByRole('dialog', { name: /límite/ })).toBeNull();
    send('Revisa el inventario del ERP');
    expect(await findLimitDialog()).toBeInTheDocument();
    expect(useUiStore.getState().limitDialog).toBe('send');
    expect(useComposerStore.getState().draft).toBe('Revisa el inventario del ERP'); // el texto no se pierde
    expect(useWorkspaceStore.getState().threads).toHaveLength(0);
    // Escape también cierra (la opción que no gasta nada) y el foco vuelve al texto.
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /límite/ })).toBeNull();
    await waitFor(() => expect(screen.getByLabelText('Escribe a Uony')).toHaveFocus());
  });

  it('sin plan, «Seguir con tokens de Uonify» pide un plan (402) y no cambia la forma de pago', async () => {
    await start({ limit: true, plan: false });
    const seen: PlanRequiredDetail[] = [];
    const stop = onPlanRequired(detail => seen.push(detail));
    renderWorkspace();
    fireEvent.click(within(await findLimitDialog()).getByRole('button', { name: 'Seguir con tokens de Uonify' }));
    await waitFor(() => expect(seen).toHaveLength(1));
    stop();
    expect(seen[0]).toMatchObject({ code: 'plan_required', feature: 'uony_tokens' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /límite/ })).toBeNull());
    send('Hola');
    expect(await findLimitDialog()).toBeInTheDocument(); // sigue con ChatGPT: nada en silencio
  });

  it('con plan, sigue con tokens de Uonify en la sesión y Uony vuelve a responder', async () => {
    await start({ limit: true, plan: true });
    renderWorkspace();
    fireEvent.click(within(await findLimitDialog()).getByRole('button', { name: 'Seguir con tokens de Uonify' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /límite/ })).toBeNull());
    send('Hola, Uony');
    expect(screen.getByText('Revisando tu petición…')).toBeInTheDocument();
    expect(useWorkspaceStore.getState().threads[0].messages[0]).toMatchObject({ role: 'user', text: 'Hola, Uony' });
    await waitFor(() => expect(useWorkspaceStore.getState().threads[0].messages.map(item => item.role)).toEqual(['user', 'assistant']));
    // El panel de uso lo dice y deja volver a ChatGPT.
    fireEvent.click(screen.getByRole('button', { name: /^Límites de uso de OpenAI/ }));
    const panel = screen.getByRole('region', { name: 'Límites de uso de OpenAI' });
    expect(panel).toHaveTextContent('Uony usa tus tokens de Uonify en esta sesión.');
    expect(within(panel).getByRole('button', { name: 'Volver a ChatGPT' })).toBeInTheDocument();
  });

  it('«Ver uso» lleva a Configuración › Uso', async () => {
    await start({ limit: true, plan: false });
    renderWorkspace();
    const dialog = await findLimitDialog();
    const navigate = vi.spyOn(workspaceRefs, 'navigate');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ver uso' }));
    expect(navigate).toHaveBeenCalledWith('/espacio/configuracion/uso', undefined);
    expect(useUiStore.getState().limitDialog).toBeNull();
    navigate.mockRestore();
  });

  it('si el servidor rechaza el mensaje (429), sale del hilo, el texto vuelve y se abre el aviso', async () => {
    await start({ limit: false, plan: false });
    renderWorkspace();
    await screen.findByRole('button', { name: /^Límites de uso de OpenAI: \d+ % usado$/ });
    // El límite se agota fuera de esta pestaña: la caché aún no lo sabe.
    await setLimitSimulation({ limitReached: true });
    send('Quiero crear una ficha de producto');
    expect(await findLimitDialog()).toBeInTheDocument();
    expect(useUiStore.getState().limitDialog).toBe('rejected');
    expect(useWorkspaceStore.getState().threads).toHaveLength(0);
    expect(useComposerStore.getState().draft).toBe('Quiero crear una ficha de producto');
    expect(useUiStore.getState().pendingReply).toBeNull();
  });

  it('el panel de uso no expone controles de prueba', async () => {
    await start({ limit: false, plan: false });
    renderWorkspace();
    fireEvent.click(await screen.findByRole('button', { name: /^Límites de uso de OpenAI: \d+ % usado$/ }));
    expect(screen.queryByRole('group', { name: 'Datos simulados' })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Simular límite alcanzado' })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Cuenta con plan de Uonify' })).toBeNull();
  });
});
