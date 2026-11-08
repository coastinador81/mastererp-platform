import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HomePage } from '../components/home/HomePage';
import { COMPOSER_PREFERENCES_KEY, DISMISSED_SUGGESTIONS_KEY } from '../model/composerOptions';
import { HOME_PREFERENCES_KEY } from '../model/storage';
import { authState, openSignIn } from './authMock';
import { renderPage } from './renderPage';

vi.mock('@/modules/auth', async () => (await import('./authMock')).authMock);

beforeEach(() => {
  sessionStorage.clear();
  authState.status = 'signed-out';
  openSignIn.mockClear();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

describe('portada', () => {
  test('pone el título y la descripción de la vista e inyecta sus hojas solo mientras está montada', () => {
    const { unmount } = renderPage(<HomePage />);
    expect(document.title).toBe('Uonify — Hazlo posible');
    expect(screen.getByRole('link', { name: 'Una forma más clara de operar tu e-commerce' })).toHaveAttribute('href', '/productos');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toMatch(/^Uonify reúne tus productos, tus canales y la IA/);
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://uonify.com/');
    expect(document.head.querySelectorAll('style[data-uon-view-style="portada"]')).toHaveLength(6);
    unmount();
    expect(document.head.querySelectorAll('style[data-uon-view-style]')).toHaveLength(0);
  });

  test('una petición vacía también abre el acceso; con texto conserva la petición', async () => {
    const user = userEvent.setup();
    renderPage(<HomePage />);
    await user.click(screen.getByRole('button', { name: 'Enviar petición' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(openSignIn).toHaveBeenCalledWith({ prompt: '' });
    const field = screen.getByLabelText('Describe qué quieres conseguir');
    await user.type(field, 'Quiero vender en Amazon');
    expect(screen.queryByRole('alert')).toBeNull();
    await user.keyboard('{Enter}');
    expect(openSignIn).toHaveBeenCalledWith({ prompt: 'Quiero vender en Amazon' });
  });

  test('Mayúsculas + Intro añade una línea sin enviar', async () => {
    const user = userEvent.setup();
    renderPage(<HomePage />);
    const field = screen.getByLabelText('Describe qué quieres conseguir');
    await user.type(field, 'Hola{Shift>}{Enter}{/Shift}mundo');
    expect(field).toHaveValue('Hola\nmundo');
    expect(openSignIn).not.toHaveBeenCalled();
  });

  test('«Iniciar sesión» abre el acceso y el texto sigue a la sesión', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPage(<HomePage />);
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    expect(openSignIn).toHaveBeenCalledWith({});
    unmount();
    authState.status = 'onboarding';
    renderPage(<HomePage />);
    expect(screen.getByRole('button', { name: 'Completar perfil' })).toBeInTheDocument();
  });

  test('las ideas rellenan el campo y la × las quita para toda la pestaña', async () => {
    const user = userEvent.setup();
    renderPage(<HomePage />);
    await user.click(screen.getByRole('button', { name: 'Publicar un producto en Amazon' }));
    expect(screen.getByLabelText('Describe qué quieres conseguir')).toHaveValue('Quiero publicar un producto en Amazon desde cero.');
    await user.click(screen.getByRole('button', { name: 'Quitar sugerencia: Crear un vídeo para redes' }));
    expect(screen.queryByRole('button', { name: 'Crear un vídeo para redes' })).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(DISMISSED_SUGGESTIONS_KEY) ?? '[]')).toEqual(['social-video']);
  });

  test('el selector de modelo es un menú de opciones únicas; GPT-5.5 baja el esfuerzo de Ultra a Muy alto', async () => {
    authState.status = 'ready';
    const user = userEvent.setup();
    renderPage(<HomePage />);
    await user.click(screen.getByRole('button', { name: 'Esfuerzo: Medio. Ajustar esfuerzo de razonamiento' }));
    const effortMenu = screen.getByRole('menu', { name: 'Esfuerzo de razonamiento' });
    expect(within(effortMenu).getAllByRole('menuitemradio').map(item => item.textContent)).toEqual(['Bajo✓', 'Medio✓', 'Alto✓', 'Muy alto✓', 'Ultra✓']);
    expect(within(effortMenu).getByRole('menuitemradio', { name: 'Medio' })).toHaveFocus();
    await user.click(within(effortMenu).getByRole('menuitemradio', { name: 'Ultra' }));
    expect(screen.getByRole('button', { name: 'Esfuerzo: Ultra. Ajustar esfuerzo de razonamiento' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Modelo: Auto. Elegir otro modelo' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'GPT-5.5' }));
    expect(screen.getByRole('button', { name: 'Esfuerzo: Muy alto. Ajustar esfuerzo de razonamiento' })).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem(COMPOSER_PREFERENCES_KEY) ?? '{}')).toEqual({ model: 'gpt-5.5', effort: 'xhigh', speed: 'standard' });
    expect(document.getElementById('composer')?.dataset.aiEffort).toBe('xhigh');
  });

  test('Escape cierra el menú abierto y devuelve el foco a su botón', async () => {
    authState.status = 'ready';
    const user = userEvent.setup();
    renderPage(<HomePage />);
    const trigger = screen.getByRole('button', { name: 'Modelo: Auto. Elegir otro modelo' });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'GPT-6 Astra' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  test('el modo rápido se activa y se recuerda', async () => {
    authState.status = 'ready';
    const user = userEvent.setup();
    renderPage(<HomePage />);
    await user.click(screen.getByRole('button', { name: 'Activar modo rápido: 1,5 veces más velocidad y mayor consumo' }));
    expect(screen.getByRole('button', { name: 'Desactivar modo rápido y volver a velocidad normal' })).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(sessionStorage.getItem(COMPOSER_PREFERENCES_KEY) ?? '{}').speed).toBe('fast');
  });

  test('«Crear una imagen» empieza la petición y el dictado avisa si el navegador no lo admite', async () => {
    authState.status = 'ready';
    const user = userEvent.setup();
    renderPage(<HomePage />);
    await user.click(screen.getByRole('button', { name: 'Más opciones' }));
    await user.click(screen.getByRole('menuitem', { name: 'Crear una imagen' }));
    expect(screen.getByLabelText('Describe qué quieres conseguir')).toHaveValue('Crea una imagen de ');
    await user.click(screen.getByRole('button', { name: 'Dictar' }));
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('El dictado por voz no está disponible en este navegador.');
  });

  test('los archivos añadidos aparecen como chips que se pueden quitar', async () => {
    authState.status = 'ready';
    renderPage(<HomePage />);
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]')!;
    const photo = new File(['x'], 'caja.png', { type: 'image/png' });
    await act(async () => { fireEvent.change(input, { target: { files: [photo] } }); });
    expect(screen.getByText('caja.png')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Quitar caja.png' }));
    expect(screen.queryByText('caja.png')).toBeNull();
  });

  test('el panel de herramientas se abre, enfoca la primera y se cierra con Escape', async () => {
    const user = userEvent.setup();
    renderPage(<HomePage />);
    const trigger = screen.getByRole('button', { name: 'Herramientas de Uonify' });
    await user.click(trigger);
    expect(screen.getByRole('link', { name: 'ERP' })).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Catálogo' })).toHaveAttribute('href', '/productos#catalogo');
    expect(screen.getByRole('button', { name: 'Academy' })).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('las preferencias se aplican al documento y se guardan en la pestaña', async () => {
    const user = userEvent.setup();
    renderPage(<HomePage />);
    await user.click(screen.getByRole('checkbox', { name: /Más contraste/, hidden: true }));
    expect(document.documentElement.dataset.moreContrast).toBe('true');
    expect(JSON.parse(sessionStorage.getItem(HOME_PREFERENCES_KEY) ?? '{}')).toEqual({ contrast: true, reduceMotion: false });
    expect(document.getElementById('preferences-status')).toHaveTextContent('Preferencias guardadas para esta pestaña.');
    await user.click(screen.getByRole('button', { name: 'Restablecer preferencias', hidden: true }));
    expect(document.documentElement.dataset.moreContrast).toBe('false');
  });

  test('con sesión, el logotipo lleva al espacio', async () => {
    authState.status = 'ready';
    const user = userEvent.setup();
    const { router } = renderPage(<HomePage />, '/?auth=return');
    const brand = screen.getByRole('link', { name: 'Uonify, volver a mi espacio' });
    await user.click(brand);
    expect(router.state.location.pathname).toBe('/espacio');
  });
});
