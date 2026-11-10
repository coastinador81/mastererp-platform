import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { api } from '@/shared/api/client';
import { queryClient } from '@/shared/api/queryClient';
import { ConversationActivationGate, ConversationActivationPanel } from '../components/ConversationActivation';
import { openConversationActivation, closeConversationActivation } from '../state/activation';
import { setSession } from '../state/session';
import { parseSession } from '../model/session';
import type { SessionPayload } from '../model/types';
import type { ActivationState } from '../model/activation';
import { navigation } from '../flows/navigation';
import { resetAuthUi } from '../state/authUi';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
const popup = vi.hoisted(() => ({ open: vi.fn(), resume: vi.fn(), focus: vi.fn() }));
vi.mock('@/modules/cloud', () => ({
  GoogleAccountRule: ({ account }: { account: string }) => <p>{account}</p>,
  useCloudWindow: () => ({ ...popup, pending: null, message: '' }),
}));

let saved: SessionPayload;
let setup: ActivationState;
const offer = { offer: { version: 'v1', annualCents: 11880, monthlyCents: 990, currency: 'EUR', trialDays: 14, reminderDays: 3 },
  trialUsed: true, embeddedReady: true, access: { status: 'allowed' }, subscription: { status: 'active', cancelAtPeriodEnd: false, interval: 'annual', periodEndsAt: '2099-10-15T00:00:00Z' } };
beforeEach(() => {
  queryClient.clear(); sessionStorage.clear(); resetAuthUi(); closeConversationActivation();
  saved = { authenticated: true, email: 'activation@example.test', account: { provider: 'google' }, identity: { name: 'Ana García' },
    onboardingStage: 'profile', onboarding: { step: 'terms' }, profileComplete: false, ageConfirmedAdult: false, consents: [] };
  setup = { step: 'profile', firstIntent: '', drive: { connected: false, deferred: false },
    cloud: { connected: true, ready: false, projectId: null, projectName: null, operation: null }, setupReady: false, aiReady: false };
  setSession(parseSession(saved));
  navigation.bind(vi.fn(), '/espacio');
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/onboarding/setup') return structuredClone(setup) as never;
    if (path === '/connections/google-drive') return { connection: { status: 'disconnected' }, available: true, accessAllowed: false, preparationAllowed: true, onboardingDeferred: setup.drive.deferred } as never;
    if (path === '/connections/google-cloud') return { connection: { status: 'connected' }, available: true, accessAllowed: false, preparationAllowed: true } as never;
    if (path === '/connections/google-cloud/projects') return { projects: [{ id: 'project-own', name: 'Mi proyecto' }] } as never;
    if (path === '/connections/google-cloud/billing-accounts') return { accounts: [{ name: 'billingAccounts/own', displayName: 'Mi facturación', open: true }] } as never;
    if (path === '/billing/onboarding-offer') return offer as never;
    throw new Error(`Consulta inesperada: ${path}`);
  });
  vi.spyOn(api, 'put').mockImplementation(async (path, body) => {
    if (path !== '/onboarding/setup') throw new Error(`Cambio inesperado: ${path}`);
    setup.firstIntent = (body as { firstIntent: string }).firstIntent; return structuredClone(setup) as never;
  });
});
afterEach(() => { queryClient.clear(); vi.restoreAllMocks(); });
const mount = (panel = false) => render(<QueryClientProvider client={queryClient}><MemoryRouter>{panel ? <ConversationActivationPanel /> : <ConversationActivationGate><p>Herramientas habilitadas</p></ConversationActivationGate>}</MemoryRouter></QueryClientProvider>);

it('completa perfil, aplaza Drive, prepara el proyecto y activa el acceso en la misma conversación', async () => {
  const user = userEvent.setup();
  const post = vi.spyOn(api, 'post').mockImplementation(async (path, body) => {
    if (path === '/onboarding/terms') saved = { ...saved, onboarding: { step: 'you' } };
    else if (path === '/onboarding/you') saved = { ...saved, onboarding: { step: 'work' }, profile: body as SessionPayload['profile'], ageConfirmedAdult: true };
    else if (path === '/onboarding/work') { saved = { ...saved, onboarding: { step: 'pending' }, profile: { ...saved.profile, ...body as object } }; setup.step = 'drive'; }
    else if (path === '/connections/google-drive/defer') { setup = { ...setup, step: 'cloud', drive: { connected: false, deferred: true } }; return { onboardingDeferred: true } as never; }
    else if (path === '/connections/google-cloud/setup') {
      expect(body).toEqual({ requestId: expect.any(String), mode: 'existing', projectId: 'project-own', configurationApproved: true, modelTestConsent: true });
      setup = { ...setup, step: 'subscription', aiReady: true, setupReady: true, cloud: { ...setup.cloud, ready: true, projectId: 'project-own', projectName: 'Mi proyecto' } };
      return { operation: { id: (body as { requestId: string }).requestId, status: 'ready', modelTest: 'passed', canResume: true, message: 'Preparado' } } as never;
    } else if (path === '/billing/checkout-status') { setup = { ...setup, step: 'complete', activation: { basis: 'paid', endsAt: '2099-10-15T00:00:00Z' } }; return { access: { status: 'allowed' }, subscription: offer.subscription } as never; }
    else if (path === '/onboarding/complete') saved = { ...saved, profileComplete: true };
    else throw new Error(`Operación inesperada: ${path}`);
    return saved as never;
  });
  sessionStorage.setItem('uonify-auth-pending-prompt', 'Crear Basic Mini Bricks desde mis documentos');
  mount();
  expect(await screen.findByRole('heading', { name: 'Condiciones de Uonify' })).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByText('Herramientas habilitadas')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Tu primera petición/ })).not.toBeInTheDocument();
  await waitFor(() => expect(setup.firstIntent).toBe('Crear Basic Mini Bricks desde mis documentos'));
  for (const checkbox of screen.getAllByRole('checkbox')) await user.click(checkbox);
  await user.click(screen.getByRole('button', { name: 'Aceptar y continuar' }));
  await user.selectOptions(await screen.findByLabelText('Franja de edad'), '25-34');
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
  await user.selectOptions(await screen.findByLabelText('Tu actividad'), 'seller');
  await user.selectOptions(screen.getByLabelText('Tamaño del equipo'), '1');
  await user.selectOptions(screen.getByLabelText('¿Qué quieres hacer primero?'), 'catalog');
  await user.click(screen.getByRole('button', { name: 'Guardar mis datos' }));
  await user.click(await screen.findByRole('button', { name: 'Ahora no, más adelante' }));
  await user.click(await screen.findByRole('button', { name: 'No, elegir uno que ya tengo' }));
  await user.selectOptions(await screen.findByLabelText('Tu proyecto de Google'), 'project-own');
  await user.click(screen.getByRole('checkbox', { name: /Autorizo una comprobación mínima/ }));
  await user.click(screen.getByRole('button', { name: 'Preparar mi IA con Uony' }));
  expect(await screen.findByRole('heading', { name: 'Tu IA está preparada' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Continuar con Uony' })).not.toBeInTheDocument();
  // Una consulta de estado posterior tampoco salta el resumen que se está leyendo.
  await act(async () => { await queryClient.invalidateQueries({ queryKey: ['onboarding-setup', saved.email] }); });
  expect(screen.getByRole('heading', { name: 'Tu IA está preparada' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
  await user.click(await screen.findByRole('button', { name: 'Continuar con Uony' }));
  expect(await screen.findByRole('heading', { name: 'Tu suscripción está activa' })).toBeVisible();
  expect(post.mock.calls.some(([path]) => path === '/onboarding/complete')).toBe(false);
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  await user.click(screen.getByRole('button', { name: 'Continuar con Uony' }));
  expect(await screen.findByText('Herramientas habilitadas')).toBeVisible();
  expect(sessionStorage.getItem('uonify-auth-pending-prompt')).toBe('Crear Basic Mini Bricks desde mis documentos');
  expect(post.mock.calls.some(([path]) => path === '/billing/checkout-embedded')).toBe(false);
  expect(post.mock.calls.some(([path]) => path === '/uony/messages')).toBe(false);
});

it('recupera de servidor la primera intención y el paso sin repetir conexiones ni preparación', async () => {
  saved = { ...saved, onboarding: { step: 'pending' }, ageConfirmedAdult: true };
  setup = { ...setup, step: 'cloud', firstIntent: 'Mi intención persistente', drive: { connected: false, deferred: true } };
  setSession(parseSession(saved));
  const post = vi.spyOn(api, 'post');
  const first = mount();
  expect(await screen.findByRole('button', { name: 'Sí, crear un proyecto Uonify' })).toBeVisible();
  expect(screen.queryByLabelText('Tu primera petición')).not.toBeInTheDocument();
  expect(setup.firstIntent).toBe('Mi intención persistente');
  first.unmount(); mount();
  expect(await screen.findByRole('button', { name: 'Sí, crear un proyecto Uonify' })).toBeVisible();
  expect(screen.queryByLabelText('Tu primera petición')).not.toBeInTheDocument();
  expect(setup.firstIntent).toBe('Mi intención persistente');
  expect(post).not.toHaveBeenCalled();
});

it('la cuenta ya pagada recupera su conexión sobre el chat sin abrir otro pago ni borrar la intención', async () => {
  saved = { ...saved, onboarding: { step: 'pending' }, profileComplete: true, ageConfirmedAdult: true };
  setup = { ...setup, step: 'complete', aiReady: true, setupReady: true, firstIntent: 'Petición anterior' };
  setSession(parseSession(saved));
  act(openConversationActivation);
  const post = vi.spyOn(api, 'post');
  mount(true);
  await userEvent.click(await screen.findByRole('button', { name: 'Continuar con Uony' }));
  await waitFor(() => expect(screen.queryByLabelText('Preparar tu cuenta con Uony')).not.toBeInTheDocument());
  expect(sessionStorage.getItem('uonify-auth-pending-prompt')).toBeNull();
  expect(post).not.toHaveBeenCalled();
});

it('recargar una IA ya preparada recupera la activación sin repetir la comprobación', async () => {
  saved = { ...saved, onboarding: { step: 'pending' }, ageConfirmedAdult: true };
  setup = { ...setup, step: 'subscription', aiReady: true, setupReady: true, firstIntent: 'Preparar Basic Mini Bricks' };
  setSession(parseSession(saved));
  const post = vi.spyOn(api, 'post');
  const first = mount();
  expect(await screen.findByRole('button', { name: 'Continuar con Uony' })).toBeVisible();
  first.unmount(); mount();
  expect(await screen.findByRole('button', { name: 'Continuar con Uony' })).toBeVisible();
  expect(post).not.toHaveBeenCalled();
  expect(setup.firstIntent).toBe('Preparar Basic Mini Bricks');
});

it('un fallo de lectura mantiene el acceso cerrado y permite recuperarlo sin simular éxito', async () => {
  vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('Servicio temporalmente no disponible'));
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('No puedo recuperar tu preparación');
  expect(screen.queryByText('Herramientas habilitadas')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByRole('heading', { name: 'Condiciones de Uonify' })).toBeVisible();
});

it('mantiene la cabecera habitual fuera del marco y los servicios no pierden los datos del alta', async () => {
  saved = { ...saved, onboarding: { step: 'pending' }, ageConfirmedAdult: true };
  setup = { ...setup, step: 'cloud', firstIntent: 'Preparar Basic Mini Bricks' };
  setSession(parseSession(saved));
  const post = vi.spyOn(api, 'post');
  const put = vi.spyOn(api, 'put');
  mount();
  await userEvent.click(await screen.findByRole('button', { name: 'No, elegir uno que ya tengo' }));
  await userEvent.selectOptions(await screen.findByLabelText('Tu proyecto de Google'), 'project-own');
  const card = screen.getByRole('region', { name: 'Preparar tu cuenta con Uony' });
  const account = screen.getByRole('button', { name: /Cuenta:/ });
  expect(card).not.toContainElement(account);
  expect(card).not.toContainElement(screen.getByRole('link', { name: 'Uonify: preparación de tu cuenta' }));
  expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', expect.stringContaining('Fase 3 de 4: Tu IA'));
  await userEvent.click(screen.getByRole('button', { name: 'Abrir servicios de Uonify' }));
  expect(screen.getByText('Termina de preparar tu cuenta para utilizar estas herramientas.')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Producto' }));
  expect(screen.getByLabelText('Tu proyecto de Google')).toHaveValue('project-own');
  expect(document.getElementById('activation-progress')).toHaveFocus();
  expect(screen.queryByRole('button', { name: /Tu primera petición/ })).not.toBeInTheDocument();
  expect(setup.firstIntent).toBe('Preparar Basic Mini Bricks');
  expect(post).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
});

it('la bienvenida lleva el pie global debajo de la conversación: nunca se oculta', async () => {
  mount();
  expect(await screen.findByRole('heading', { name: 'Condiciones de Uonify' })).toBeVisible();
  const footers = screen.getAllByRole('contentinfo');
  expect(footers).toHaveLength(1);
  expect(screen.getByRole('main', { name: 'Conversación de bienvenida con Uony' })).not.toContainElement(footers[0]);
  expect(within(footers[0]).getByRole('link', { name: 'Términos y condiciones' })).toHaveAttribute('href', '/terminos');
  expect(within(footers[0]).getByRole('button', { name: 'Idioma' })).toHaveAttribute('aria-haspopup', 'dialog');
});

