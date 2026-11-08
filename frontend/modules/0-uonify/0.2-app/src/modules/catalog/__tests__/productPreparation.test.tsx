import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { pimStore } from '@/shared/pim';
import { ProductPreparationPanel } from '../components/ProductPreparationPanel';
import { preparationKey, type ProductPreparation } from '../api/preparation';
import { clearPreparationDrafts } from '../hooks/preparationDrafts';

const identity = vi.hoisted(() => ({ account: 'one@example.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account }));
vi.mock('@/shared/api/config', async original => ({ ...await original<typeof import('@/shared/api/config')>(), USE_MOCKS: false }));
const product = { sku: 'JUEGO/1', name: 'Juego', revision: 1, bullets: [], customFields: [] };
const fixture = (revision = 1, goal = ''): ProductPreparation => ({ product: { ...product, revision }, preparation: {
  mode: null, activeSection: 'video', briefReady: false, sections: [
    { id: 'video', label: 'Vídeo', kind: 'planning', state: 'pending', notice: 'Guardamos el encargo. La generación de vídeo aún no está integrada.', fields: [
      { id: 'goal', label: 'Objetivo del vídeo', type: 'textarea', required: true, value: goal },
      { id: 'format', label: 'Formato', type: 'select', required: false, value: '', options: ['Horizontal', 'Vertical'] },
    ] },
    { id: 'aplus', label: 'A+', kind: 'planning', state: 'pending', notice: 'Publicación pendiente.', fields: [{ id: 'story', label: 'Historia de marca', type: 'textarea', required: false, value: '' }] },
  ],
} });
beforeEach(() => { identity.account = 'one@example.test'; clearPreparationDrafts(); pimStore.clear(); });
afterEach(() => vi.restoreAllMocks());
function mount(onSelectTab = vi.fn(), strict = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['catalog', 'products', identity.account], [product]);
  const body = <QueryClientProvider client={client}><ProductPreparationPanel product={product} tab="video" onSelectTab={onSelectTab} /></QueryClientProvider>;
  const view = render(strict ? <StrictMode>{body}</StrictMode> : body);
  return { ...view, client, onSelectTab };
}

it('guarda los campos reales con revisión y actualiza catálogo antes de continuar', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(fixture());
  const response = fixture(2, 'Mostrar cómo se apilan las piezas'); response.preparation.activeSection = 'aplus';
  response.preparation.sections[0].state = 'reviewed';
  const patch = vi.spyOn(api, 'patch').mockResolvedValue(response);
  const { client, onSelectTab } = mount();
  fireEvent.change(await screen.findByLabelText(/Objetivo del vídeo/), { target: { value: 'Mostrar cómo se apilan las piezas' } });
  fireEvent.change(screen.getByLabelText('Formato'), { target: { value: 'Horizontal' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar y continuar' }));
  await waitFor(() => expect(onSelectTab).toHaveBeenCalledWith('aplus', true));
  expect(patch).toHaveBeenCalledWith('/products/JUEGO%2F1/preparation', {
    revision: 1, mode: 'manual', section: 'video', answers: { goal: 'Mostrar cómo se apilan las piezas', format: 'Horizontal' }, reviewed: true, advance: true,
  }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(client.getQueryData(['catalog', 'products', identity.account])).toEqual([response.product]);
  expect(screen.getByText(/La generación de vídeo aún no está integrada/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Generar vídeo/ })).not.toBeInTheDocument();
});

it('conserva respuestas tras conflicto, muestra versión actual y exige revisar antes de reintentar', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue(fixture());
  const patch = vi.spyOn(api, 'patch').mockRejectedValueOnce(new ApiError(409, { message: 'La ficha ha cambiado.' }));
  mount();
  fireEvent.change(await screen.findByLabelText(/Objetivo del vídeo/), { target: { value: 'Mi idea pendiente' } });
  get.mockResolvedValue(fixture(2, 'Objetivo actualizado por Uony'));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
  await screen.findByText('Objetivo actualizado por Uony');
  expect(screen.getByLabelText(/Objetivo del vídeo/)).toHaveValue('Mi idea pendiente');
  expect(screen.getByRole('button', { name: 'Guardar borrador' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'He revisado los cambios: conservar mis respuestas' }));
  patch.mockResolvedValue(fixture(3, 'Mi idea pendiente'));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
  expect(patch.mock.calls[1][1]).toMatchObject({ revision: 2, reviewed: false, advance: false, answers: { goal: 'Mi idea pendiente' } });
});

it('respeta ediciones locales del editor y mantiene el borrador al salir y volver', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(fixture());
  const patch = vi.spyOn(api, 'patch');
  const first = mount();
  fireEvent.change(await screen.findByLabelText(/Objetivo del vídeo/), { target: { value: 'Conservar mi propuesta' } });
  act(() => pimStore.set(product.sku, 'edited', { name: 'Título sin guardar' }));
  expect(screen.getByRole('button', { name: 'Guardar borrador' })).toBeDisabled();
  expect(pimStore.get(product.sku, 'edited')).toEqual({ name: 'Título sin guardar' });
  first.unmount();
  mount();
  expect(await screen.findByLabelText(/Objetivo del vídeo/)).toHaveValue('Conservar mi propuesta');
  expect(patch).not.toHaveBeenCalled();
});

it('reconcilia campos convertidos en notas tras 409 y no envía claves retiradas', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue(fixture());
  const patch = vi.spyOn(api, 'patch').mockRejectedValueOnce(new ApiError(409, { message: 'La ficha ha cambiado.' }));
  mount();
  fireEvent.change(await screen.findByLabelText(/Objetivo del vídeo/), { target: { value: 'Mi texto anterior' } });
  fireEvent.change(screen.getByLabelText('Formato'), { target: { value: 'Horizontal' } });
  const updated = fixture(2);
  updated.preparation.sections[0].fields = [{ id: 'goal_notes', label: 'Notas sobre el objetivo', type: 'textarea', required: false, value: '' }];
  get.mockResolvedValue(updated);
  fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
  await screen.findByLabelText('Notas sobre el objetivo');
  expect(screen.getByRole('button', { name: 'Guardar borrador' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'He revisado los cambios: conservar mis respuestas' }));
  expect(screen.getByLabelText('Notas sobre el objetivo')).toHaveValue('Mi texto anterior');
  expect(screen.getByText('Respuestas de campos anteriores para consultar o copiar')).toBeInTheDocument();
  expect(screen.getByText('Horizontal')).toBeInTheDocument();
  patch.mockResolvedValue({ ...updated, product: { ...product, revision: 3 } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
  expect(patch.mock.calls[1][1]).toMatchObject({ revision: 2, answers: { goal_notes: 'Mi texto anterior' } });
  expect((patch.mock.calls[1][1] as { answers: object }).answers).not.toHaveProperty('goal');
  expect((patch.mock.calls[1][1] as { answers: object }).answers).not.toHaveProperty('format');
});

it('StrictMode no cancela la lectura inicial; el cambio de cuenta sí aborta el guardado y descarta su respuesta', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue(fixture());
  let resolve: (value: ProductPreparation) => void = () => {};
  const patch = vi.spyOn(api, 'patch').mockImplementation(() => new Promise(done => { resolve = done as typeof resolve; }));
  const { client, onSelectTab } = mount(vi.fn(), true);
  fireEvent.change(await screen.findByLabelText(/Objetivo del vídeo/), { target: { value: 'Idea privada' } });
  expect(get.mock.calls.at(-1)?.[1]?.signal?.aborted).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Guardar y continuar' }));
  const signal = patch.mock.calls[0][2]?.signal;
  get.mockRejectedValue(new ApiError(404, { message: 'Producto no disponible en esta cuenta' }));
  act(() => { identity.account = 'two@example.test'; window.dispatchEvent(new Event('uonify:identity-changed')); });
  expect(signal?.aborted).toBe(true);
  await act(async () => resolve(fixture(2, 'Idea privada')));
  expect(client.getQueryData(preparationKey('two@example.test', product.sku))).toBeUndefined();
  expect(client.getQueryData(['catalog', 'products', 'two@example.test'])).toBeUndefined();
  expect(onSelectTab).not.toHaveBeenCalled();
  expect(screen.queryByText('Borrador guardado en esta ficha.')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('Idea privada')).not.toBeInTheDocument();
});

it('muestra el fallo de lectura y permite reintentar sin preparar recursos ficticios', async () => {
  const get = vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('Servidor temporalmente no disponible'));
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Servidor temporalmente no disponible');
  get.mockResolvedValue(fixture());
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByLabelText(/Objetivo del vídeo/)).toHaveValue('');
  expect(screen.getByText('Por preparar')).toBeInTheDocument();
});
