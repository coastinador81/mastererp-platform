import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { pimStore, type PimProduct } from '@/shared/pim';
import { toast } from '@/shared/ui';
import { tab } from '..';
import { handlers } from '../mocks/handlers';
import { makeContext, renderTab } from './helpers';

const server = setupServer(...handlers);
const product: PimProduct = { sku: 'UON-D1', name: 'Juego de piezas', description: 'Piezas de madera.', bullets: ['Madera de haya'], category: 'Juguetes' };

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(async () => {
  pimStore.clear();
  // Deja que la pestaña anterior vuelva a «Vista» (se hace al salir, en la siguiente vuelta del bucle).
  await new Promise(resolve => setTimeout(resolve, 0));
});
afterEach(() => {
  server.resetHandlers();
  act(() => toast.dismiss());
});
afterAll(() => server.close());

describe('Descripciones', () => {
  test('pinta los tres bloques y las seis viñetas; escribir guarda en el producto', async () => {
    const user = userEvent.setup();
    renderTab(tab, makeContext(product));
    expect(screen.getByRole('region', { name: 'Descripción Larga' })).toBeInTheDocument();
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(6);
    expect(screen.getByLabelText('Viñeta 1')).toHaveValue('Madera de haya');
    await user.type(screen.getByLabelText('Viñeta 2'), 'Seis colores');
    expect(pimStore.get<string[]>('UON-D1', 'bullets').slice(0, 2)).toEqual(['Madera de haya', 'Seis colores']);
    await user.click(screen.getByRole('button', { name: 'Vaciar viñeta 1' }));
    expect(screen.getByLabelText('Viñeta 1')).toHaveValue('');
    await user.type(screen.getByLabelText('Keywords SEO (Amazon)'), 'madera');
    expect(pimStore.get<Record<string, unknown>>('UON-D1', 'edited').keywords).toBe('madera');
  });

  test('Vista | HTML: el editor conserva lo tecleado y la vista previa lo enseña saneado', async () => {
    const user = userEvent.setup();
    renderTab(tab, makeContext(product));
    expect(screen.getByText('Piezas de madera.')).toBeInTheDocument();
    const html = screen.getByRole('button', { name: 'HTML' });
    expect(screen.getByRole('button', { name: 'Vista' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(html);
    expect(html).toHaveAttribute('aria-pressed', 'true');
    const editor = screen.getByRole('textbox', { name: 'Descripción Larga' });
    expect(editor).toHaveValue('<p>Piezas de madera.</p>');
    await user.clear(editor);
    await user.type(editor, 'a');
    expect(editor).toHaveValue('a');
    expect(screen.getByText(/Editando HTML/)).toBeInTheDocument();
    await user.clear(editor);
    await user.type(editor, '<b>Hola</b><img src=x onerror=alert(1)>');
    await user.click(screen.getByRole('button', { name: 'Vista' }));
    const strong = screen.getByText('Hola');
    expect(strong.tagName).toBe('B');
    expect(document.querySelector('.pim-descripciones-preview img')).toBeNull();
  });

  test('Uony genera la descripción, una viñeta y las keywords; cada varita con su spinner', async () => {
    const user = userEvent.setup();
    renderTab(tab, makeContext(product));
    const wand = screen.getByRole('button', { name: 'Generar descripción con Uony' });
    await user.click(wand);
    expect(document.querySelector('.pim-descripciones-indicator')).toHaveTextContent('Generando...');
    expect(await screen.findByText('Descripción generada')).toBeInTheDocument();
    const description = String(pimStore.get<Record<string, unknown>>('UON-D1', 'edited').description);
    expect(description).toMatch(/^<p><strong>Juego de piezas<\/strong>/);
    expect(screen.getByText('Madera de haya', { selector: 'li' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Generar viñeta 2 con Uony' }));
    expect(await screen.findByText('Viñeta 2 generada')).toBeInTheDocument();
    const bullet = screen.getByLabelText('Viñeta 2') as HTMLTextAreaElement;
    expect(bullet.value).toMatch(/^FÁCIL DE USAR: Juego de piezas/);
    expect(bullet.value.length).toBeLessThanOrEqual(250);

    await user.click(screen.getByRole('button', { name: 'Generar keywords con Uony' }));
    expect(await screen.findByText('Keywords generadas')).toBeInTheDocument();
    const keywords = (screen.getByLabelText('Keywords SEO (Amazon)') as HTMLTextAreaElement).value;
    expect(keywords).toMatch(/^juego piezas juguetes madera haya/);
    expect(keywords).not.toMatch(/sacarlo/);
    await waitFor(() => expect(wand).toBeEnabled());
  });

  test('«Añadir Viñeta» lleva a la siguiente vacía y se oculta con las seis llenas', async () => {
    const user = userEvent.setup();
    renderTab(tab, makeContext(product));
    await user.click(screen.getByRole('button', { name: 'Añadir Viñeta' }));
    expect(screen.getByLabelText('Viñeta 2')).toHaveFocus();
    act(() => { pimStore.set('UON-D1', 'bullets', ['1', '2', '3', '4', '5', '6']); });
    expect(screen.queryByRole('button', { name: 'Añadir Viñeta' })).toBeNull();
  });

  test('sin producto guardado pide seleccionar uno antes de generar', async () => {
    const user = userEvent.setup();
    renderTab(tab, makeContext(null));
    await user.click(screen.getByRole('button', { name: 'Generar keywords con Uony' }));
    expect(await screen.findByText('Selecciona un producto primero')).toBeInTheDocument();
  });
});
