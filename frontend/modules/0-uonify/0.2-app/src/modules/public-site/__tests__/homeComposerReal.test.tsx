import { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { HomeComposer } from '../components/home/HomeComposer';

const auth = vi.hoisted(() => ({ signIn: vi.fn(), submit: vi.fn(), status: 'signed-out' }));
const speech = vi.hoisted(() => ({ mode: null, start: vi.fn() }));
vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => null,
  useSession: () => ({ status: auth.status, user: null, profile: null }), openSignIn: auth.signIn,
}));
vi.mock('../hooks/useSpeechInput', () => ({ useSpeechInput: () => speech }));
function Home() {
  const [draft, setDraft] = useState(''); const textareaRef = useRef<HTMLTextAreaElement>(null);
  return <HomeComposer draft={draft} onDraftInput={setDraft} fillDraft={setDraft} onSubmitPrompt={auth.submit} report={() => {}} textareaRef={textareaRef} />;
}
function mount() { render(<QueryClientProvider client={new QueryClient()}><Home /></QueryClientProvider>); }
beforeEach(() => { auth.status = 'signed-out'; auth.signIn.mockReset(); auth.submit.mockReset(); speech.start.mockReset(); });
afterEach(() => vi.restoreAllMocks());

it.each(['Más opciones', 'Hilos', 'Límites de uso', 'Respuesta ágil: iniciar sesión',
  'Modelo: Auto. Razonamiento: Medio. Iniciar sesión', 'Dictar', 'Hablar con Uony', 'Enviar petición'])(
'sin sesión, %s abre solo el acceso con el texto actual', async name => {
  const get = vi.spyOn(api, 'get'), post = vi.spyOn(api, 'post'), put = vi.spyOn(api, 'put');
  mount();
  const field = screen.getByRole('textbox', { name: 'Describe qué quieres conseguir' });
  await userEvent.type(field, 'Crear Basic Mini Bricks desde cero');
  await userEvent.click(screen.getByRole('button', { name }));
  expect(auth.signIn).toHaveBeenCalledExactlyOnceWith({ prompt: 'Crear Basic Mini Bricks desde cero' });
  expect(field).toHaveValue('Crear Basic Mini Bricks desde cero');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(speech.start).not.toHaveBeenCalled(); expect(auth.submit).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
});

it.each(['', 'Mi producto'])('Enter abre el acceso con el borrador %j, sin exigir texto', async text => {
  mount(); const field = screen.getByRole('textbox', { name: 'Describe qué quieres conseguir' });
  if (text) await userEvent.type(field, text);
  field.focus(); await userEvent.keyboard('{Enter}');
  expect(auth.signIn).toHaveBeenCalledExactlyOnceWith({ prompt: text });
  expect(auth.submit).not.toHaveBeenCalled();
});

it('clic en el SVG de enviar y activación con teclado llevan al mismo acceso sin duplicarlo', async () => {
  mount();
  const send = screen.getByRole('button', { name: 'Enviar petición' });
  fireEvent.click(send.querySelector('path')!);
  expect(auth.signIn).toHaveBeenCalledExactlyOnceWith({ prompt: '' });
  auth.signIn.mockClear();
  screen.getByRole('button', { name: 'Más opciones' }).focus();
  await userEvent.keyboard(' ');
  expect(auth.signIn).toHaveBeenCalledExactlyOnceWith({ prompt: '' });
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('Mayúsculas+Enter escribe una línea y con sesión se conserva el menú y el envío normales', async () => {
  auth.status = 'ready'; mount();
  const field = screen.getByRole('textbox', { name: 'Describe qué quieres conseguir' });
  await userEvent.type(field, 'Uno{Shift>}{Enter}{/Shift}dos');
  expect(field).toHaveValue('Uno\ndos'); expect(auth.signIn).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Más opciones' }));
  expect(screen.getByRole('menu')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Enviar petición' }));
  expect(auth.submit).toHaveBeenCalledOnce(); expect(auth.signIn).not.toHaveBeenCalled();
});
