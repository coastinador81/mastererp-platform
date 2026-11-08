import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { mock } from '@/shared/mocks/utils';
import { openSignIn, takePendingPrompt } from '../index';
import { handlers } from '@/shared/mocks/handlers';
import { STORAGE_KEYS } from '../model/storage';
import { completeConsents, completeProfile, connectAs, locationText, renderAuthApp, resetAll } from './harness';

vi.mock('@/shared/mocks/utils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/shared/mocks/utils')>()),
  latency: () => Promise.resolve(),
}));

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let hard: ReturnType<typeof vi.fn>;
beforeEach(() => {
  hard = resetAll();
});

describe('petición actual del compositor público', () => {
  test.each(['', '   '])('un borrador explícitamente vacío (%j) descarta la petición anterior', async prompt => {
    renderAuthApp('/');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    sessionStorage.setItem(STORAGE_KEYS.pendingPrompt, 'Esta petición ya se borró del compositor');
    let opening!: Promise<void>;
    act(() => {
      opening = openSignIn({ prompt });
      expect(sessionStorage.getItem(STORAGE_KEYS.pendingPrompt)).toBeNull();
    });
    await act(() => opening);
    const signIn = screen.getByRole('dialog', { name: 'Entra en Uonify' });
    expect(within(signIn).getByText('Tu petición está lista')).not.toBeVisible();
    expect(within(signIn).queryByText('Esta petición ya se borró del compositor')).not.toBeInTheDocument();
    expect(takePendingPrompt()).toBe('');
  });

  test('abrir el acceso sin indicar borrador conserva la petición pendiente', async () => {
    renderAuthApp('/');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    const pending = 'Quiero preparar Basic Mini Bricks';
    sessionStorage.setItem(STORAGE_KEYS.pendingPrompt, pending);
    await act(() => openSignIn());
    const signIn = screen.getByRole('dialog', { name: 'Entra en Uonify' });
    expect(within(signIn).getByText('Tu petición está lista')).toBeVisible();
    expect(within(signIn).getByText(pending)).toBeVisible();
    expect(takePendingPrompt()).toBe(pending);
  });
});

describe('acceso con ChatGPT y alta', () => {
  test('de la portada al espacio: acceso, cuenta, cinco pasos y bienvenida', async () => {
    const user = userEvent.setup();
    renderAuthApp('/');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    await act(() => openSignIn({ prompt: 'Sube mi producto a Amazon' }));

    const signIn = screen.getByRole('dialog', { name: 'Entra en Uonify' });
    expect(signIn).toHaveAccessibleDescription(/Elige cómo quieres entrar/);
    expect(within(signIn).getByText('Tu petición está lista')).toBeVisible();
    expect(within(signIn).getByText('Sube mi producto a Amazon')).toBeVisible();
    const provider = within(signIn).getByRole('button', { name: 'Continuar con ChatGPT' });
    expect(provider).toHaveFocus();
    await user.click(provider);

    const connect = await screen.findByRole('dialog', { name: 'Continúa en Uonify' });
    const email = within(connect).getByLabelText('Correo electrónico');
    await waitFor(() => expect(email).toHaveFocus());
    await user.type(email, 'ana@tienda.es');
    await user.click(within(connect).getByRole('button', { name: 'Continuar' }));

    const terms = await screen.findByRole('dialog', { name: 'Condiciones de Uonify' });
    expect(screen.getByText('PASO 1 DE 5 · CONDICIONES')).toBeVisible();
    expect(within(terms).queryByRole('button', { name: 'Volver' })).toBeNull();
    expect(within(terms).getAllByRole('checkbox')).toHaveLength(4);
    for (const checkbox of within(terms).getAllByRole('checkbox')) expect(checkbox).not.toBeChecked();
    await completeConsents(user);
    const profile = await screen.findByRole('dialog', { name: 'Empecemos por ti' });
    expect(screen.getByText('PASO 2 DE 5 · TÚ')).toBeVisible();
    const emailField = within(profile).getByLabelText('Correo electrónico');
    expect(emailField).toHaveValue('ana@tienda.es');
    expect(emailField).toHaveAttribute('readonly');
    expect(within(profile).getByText('Es el correo de tu cuenta de ChatGPT.')).toBeVisible();
    expect(within(profile).getByRole('button', { name: 'Volver' })).toBeVisible();
    expect(screen.getByTestId('status')).toHaveTextContent('onboarding');

    await completeProfile(user);
    await screen.findByText('Todo listo, Ana');
    await waitFor(() => expect(locationText()).toBe('/espacio'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByLabelText('Escribe tu petición')).toHaveFocus();
    expect(screen.getByTestId('account')).toHaveTextContent('Ana|ana@tienda.es|A|Plan Gratis');
    expect(document.getElementById('uon-onboarding-surface')).not.toBeVisible();
    expect(document.documentElement).not.toHaveClass('uon-onboarding-active');
    expect(takePendingPrompt()).toBe('Sube mi producto a Amazon');
    expect(takePendingPrompt()).toBe('');
    expect(hard).not.toHaveBeenCalled();
  });

  test('el paso 4 muestra los cinco planes, la recomendación y la nota del plan', async () => {
    const user = userEvent.setup();
    renderAuthApp('/');
    await act(() => openSignIn());
    await connectAs(user, 'luis@tienda.es');
    await completeConsents(user);
    await screen.findByRole('dialog', { name: 'Empecemos por ti' });
    await user.type(screen.getByLabelText('Nombre'), 'Luis');
    await user.type(screen.getByLabelText('Apellidos'), 'Pérez');
    await user.selectOptions(screen.getByLabelText('Franja de edad'), '45-54');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.selectOptions(screen.getByLabelText('Tu actividad'), 'seller');
    await user.selectOptions(screen.getByLabelText('Tamaño del equipo'), '51-200');
    await user.selectOptions(screen.getByLabelText('¿Qué quieres hacer primero?'), 'explore');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    const plans = within(await screen.findByRole('radiogroup', { name: 'Plan de Uonify' })).getAllByRole('radio');
    expect(plans.map(radio => (radio as HTMLInputElement).value)).toEqual(['free', 'basic', 'pro', 'max', 'custom']);
    expect(plans[0]).toBeChecked();
    expect(screen.getByText('Por el tamaño de tu equipo, te recomendamos empezar con Max. Puedes elegir cualquier plan.')).toBeVisible();
    expect(screen.getByText(/Gratis no tiene coste/)).toBeVisible();
    await user.click(screen.getByRole('radio', { name: /^Personalizado/ }));
    expect(within(screen.getByRole('dialog', { name: 'Elige tu plan' })).getByText(/Te escribiremos desde hola@uonify.com/, { selector: '#uon-onboard-plan-note' })).toBeVisible();
    expect(screen.getByText('PASO 4 DE 5 · TU PLAN')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Volver' }));
    expect(screen.getByRole('dialog', { name: 'Conozcamos tu trabajo' })).toBeVisible();
  });

  test('menores de 18: aviso y el botón queda bloqueado', async () => {
    const user = userEvent.setup();
    renderAuthApp('/');
    await act(() => openSignIn());
    await connectAs(user, 'joven@correo.es');
    await completeConsents(user);
    await screen.findByRole('dialog', { name: 'Empecemos por ti' });
    await user.selectOptions(screen.getByLabelText('Franja de edad'), 'under18');
    expect(screen.getByRole('alert')).toHaveTextContent('Si eres menor de 18 años, no puedes crear un espacio en Uonify.');
    const next = screen.getByRole('button', { name: 'Continuar' });
    expect(next).toBeDisabled();
    expect(next).toHaveAttribute('data-age-blocked', 'true');
    await user.selectOptions(screen.getByLabelText('Franja de edad'), '18-24');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(next).toBeEnabled();
  });

  test('si no se puede guardar el perfil, se avisa y se puede reintentar', async () => {
    const user = userEvent.setup();
    server.use(http.post(mock('/profile'), () => HttpResponse.json({ message: 'caído' }, { status: 500 })));
    renderAuthApp('/');
    await act(() => openSignIn());
    await connectAs(user, 'ana@tienda.es');
    await completeProfile(user);
    expect(await screen.findByText('No se pudo guardar tu perfil. Inténtalo de nuevo.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Entrar en mi espacio' })).toBeEnabled();
    expect(locationText()).toBe('/');
  });

  test('Escape cierra el acceso y devuelve el foco a quien lo abrió', async () => {
    const user = userEvent.setup();
    renderAuthApp('/');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    const trigger = screen.getByRole('button', { name: 'Iniciar sesión' });
    await user.click(trigger);
    await screen.findByRole('dialog', { name: 'Entra en Uonify' });
    expect(document.documentElement).toHaveClass('uon-onboarding-active');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(document.documentElement).not.toHaveClass('uon-onboarding-active');
  });

  test('«Volver» en «Conecta tu cuenta» regresa al acceso', async () => {
    const user = userEvent.setup();
    renderAuthApp('/');
    await act(() => openSignIn());
    await user.click(screen.getByRole('button', { name: 'Continuar con ChatGPT' }));
    const connect = await screen.findByRole('dialog', { name: 'Continúa en Uonify' });
    await user.click(within(connect).getByRole('button', { name: 'Volver' }));
    const signIn = screen.getByRole('dialog', { name: 'Entra en Uonify' });
    expect(within(signIn).getByRole('button', { name: 'Continuar con ChatGPT' })).toBeEnabled();
  });
});

describe('acceso real en OpenAI (modo redirect)', () => {
  beforeEach(() => {
    server.use(http.get(mock('/auth/config'), () => HttpResponse.json({ provider: 'chatgpt', mode: 'redirect' })));
  });

  test('redirige a la URL de OpenAI tras «Continúa en ChatGPT»', async () => {
    const user = userEvent.setup();
    server.use(http.post(mock('/auth/chatgpt/start'), () => HttpResponse.json({ authUrl: 'https://auth.openai.com/authorize?client=uonify' })));
    renderAuthApp('/');
    await act(() => openSignIn());
    await user.click(screen.getByRole('button', { name: 'Continuar con ChatGPT' }));
    await screen.findByText('Continúa en ChatGPT');
    await waitFor(() => expect(hard).toHaveBeenCalledWith('https://auth.openai.com/authorize?client=uonify'));
  });

  test('una URL que no es de OpenAI no se sigue', async () => {
    const user = userEvent.setup();
    server.use(http.post(mock('/auth/chatgpt/start'), () => HttpResponse.json({ authUrl: 'https://evil.test/login' })));
    renderAuthApp('/');
    await act(() => openSignIn());
    await user.click(screen.getByRole('button', { name: 'Continuar con ChatGPT' }));
    expect(await screen.findByText('No se pudo iniciar el acceso con ChatGPT. Inténtalo de nuevo.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continuar con ChatGPT' })).toBeEnabled();
    expect(hard).not.toHaveBeenCalled();
  });
});
