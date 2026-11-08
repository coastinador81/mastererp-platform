import { act, fireEvent, screen, within } from '@testing-library/react';
import { useComposerStore } from '../hooks/composerStore';
import { renderWorkspace, resetStores } from './harness';

vi.mock('../components/authBridge', () => ({
  AuthDialogs: () => null,
  signOut: vi.fn(),
  requirePrompt: (_text: string, run: () => void) => {
    run();
    return Promise.resolve();
  },
  takePendingPrompt: () => '',
  useSession: () => ({ status: 'ready', user: null, profile: null }),
  useAccountSummary: () => ({ name: 'Ana', email: 'ana@uonify.com', initial: 'A', planLabel: 'Plan Free' }),
}));

vi.mock('../components/moduleBridge', () => ({
  HelpButton: () => null,
  NotificationsBell: () => null,
  settingsPath: (section = 'cuenta') => `/espacio/configuracion/${section}`,
}));

vi.mock('../api/assistant', () => ({
  ASSISTANT_ENDPOINTS: { USAGE: '/ai/usage', MESSAGES: '/assistant/messages' },
  getUsage: vi.fn(() => Promise.resolve({ plan: 'Free', limits: [{ label: 'Límite de 5 horas', usedPercent: 6, reset: '2 h 46 min' }, { label: 'Semanal · todos los modelos', usedPercent: 26, resetText: 'el mié, 3:00' }] })),
  postAssistantMessage: vi.fn(() => new Promise(() => {})),
}));

beforeEach(() => resetStores('/espacio'));

const composer = () => document.getElementById('composer') as HTMLElement;

// Puerto de tests/composer-tools del prototipo (controles del compositor).
describe('compositor del espacio', () => {
  it('el esfuerzo es un menú de niveles; GPT-5.5 quita Ultra y baja la elección', () => {
    renderWorkspace();
    const effort = within(composer()).getByRole('button', { name: /^Esfuerzo: Medio/ });
    fireEvent.click(effort);
    const menu = screen.getByRole('menu', { name: 'Esfuerzo de razonamiento' });
    const options = within(menu).getAllByRole('menuitemradio', { hidden: true });
    expect(options.map(option => option.dataset.effortId)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(options.every(option => option.tabIndex === -1)).toBe(true); // las flechas se mueven dentro; Tab sale
    expect(options[1]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(options[4]).toHaveFocus();
    fireEvent.click(options[4]);
    expect(effort).toHaveTextContent('Ultra');
    expect(effort).toHaveFocus();
    expect(composer()).toHaveAttribute('data-ai-effort', 'max');

    fireEvent.click(within(composer()).getByRole('button', { name: /^Modelo: Auto/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /GPT-5\.5/ }));
    expect(within(composer()).getByRole('button', { name: /^Modelo: GPT-5\.5/ })).toHaveTextContent('5.5');
    expect(effort).toHaveTextContent('Muy alto');
    expect(options[4]).toHaveAttribute('hidden');
    expect(JSON.parse(sessionStorage.getItem('uonify-composer-preferences') || '{}')).toEqual({ model: 'gpt-5.5', effort: 'xhigh', speed: 'standard' });
  });

  it('el modo rápido es un interruptor 1,5× y Escape cierra un menú abierto', () => {
    renderWorkspace();
    const speed = within(composer()).getByRole('button', { name: /Activar modo rápido/ });
    fireEvent.click(speed);
    expect(speed).toHaveAttribute('aria-pressed', 'true');
    expect(speed).toHaveAccessibleName('Desactivar modo rápido y volver a velocidad normal');
    const model = within(composer()).getByRole('button', { name: /^Modelo:/ });
    fireEvent.click(model);
    expect(model).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(model).toHaveAttribute('aria-expanded', 'false');
    expect(model).toHaveFocus();
  });

  it('el uso es solo el anillo; su panel enseña los límites del plan', async () => {
    renderWorkspace();
    const trigger = await within(composer()).findByRole('button', { name: 'Límites de uso de OpenAI: 26 % usado' });
    expect(trigger).toHaveClass('has-usage');
    fireEvent.click(trigger);
    const panel = screen.getByRole('region', { name: 'Límites de uso de OpenAI' });
    expect(panel).toHaveTextContent('Límites de uso del plan · Free');
    expect(panel).toHaveTextContent('Límite de 5 horasSe restablece en 2 h 46 min6%');
    expect(panel).toHaveTextContent('Se restablece el mié, 3:00');
    fireEvent.pointerDown(document.body);
    expect(panel).toHaveAttribute('hidden');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('«+»: mientras Uony no recibe archivos solo ofrece crear una imagen, que empieza la frase', () => {
    // Decisión del dueño (22-10-2026, «Ocultar hasta que funcione»): sin fotos ni archivos.
    renderWorkspace();
    fireEvent.click(within(composer()).getByRole('button', { name: 'Más opciones' }));
    const menu = screen.getByRole('menu', { name: 'Añadir al mensaje' });
    expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Crear una imagen']);
    expect(composer().querySelector('input[type="file"]')).toBeNull();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Crear una imagen' }));
    expect(screen.getByLabelText('Escribe a Uony')).toHaveValue('Crea una imagen de ');
    expect(useComposerStore.getState().status).toBe('');
  });

  it('las ideas para empezar rellenan el mensaje y se pueden quitar', async () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Crear un producto para Amazon' }));
    expect(screen.getByLabelText('Escribe a Uony')).toHaveValue('Quiero crear la ficha de un producto para Amazon. Guíame paso a paso para preparar el borrador.');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Quitar sugerencia: Conectar Amazon' }));
    });
    expect(within(screen.getByRole('main')).getByRole('button', { name: 'Conectar Amazon', hidden: true }).closest('.prompt-suggestion')).toHaveAttribute('hidden');
    expect(JSON.parse(sessionStorage.getItem('uonify-composer-dismissed-suggestions') || '[]')).toEqual(['connect-channel']);
  });
});
