import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { pimStore } from '@/shared/pim';
import { AmazonRequirementsPanel } from '../components/AmazonRequirementsPanel';
import { amazonRequirementsKey, type AmazonRequirements } from '../api/amazonRequirements';
import { clearRequirementsDrafts } from '../hooks/amazonRequirementsDrafts';

const identity = vi.hoisted(() => ({ account: 'one@example.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account }));
vi.mock('@/shared/api/config', async original => ({ ...await original<typeof import('@/shared/api/config')>(), USE_MOCKS: false }));
const product = { sku: 'BRICKS-01', name: 'Basic Mini Bricks', revision: 1, bullets: [], customFields: [] };
function fixture(revision = 1): AmazonRequirements {
  return { product: { ...product, revision }, evaluation: {
    state: 'needs_input', evaluationId: `evaluation-${revision}`, productType: 'TABLETOP_GAME', marketplaceId: 'A1RKKUPIHCS9HS', referenceAsin: 'B07NPPMZM8',
    schemaVersion: 'version', schemaChecksum: 'checksum', evaluatedAt: '2026-10-14T13:00:00Z', localOnly: true,
    counts: { missing: 1, invalid: 0, questions: 1 }, message: 'Falta completar la edad recomendada.', issues: [],
    fields: [{ id: 'age', label: 'Edad recomendada', type: 'text', required: true, value: '', hint: 'Amazon acepta un número entero de años.', validation: { number: 'integer', minimum: 0 } }],
    attributes: [{ id: 'recommended_age', label: 'Edad recomendada', required: true, present: false, valid: false }, { id: 'material', label: 'Material', required: false, present: true, valid: true }],
  } };
}
function mount(strict = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['catalog', 'products', identity.account], [product]);
  const body = <QueryClientProvider client={client}><AmazonRequirementsPanel product={product} /></QueryClientProvider>;
  return { ...render(strict ? <StrictMode>{body}</StrictMode> : body), client };
}
beforeEach(() => { identity.account = 'one@example.test'; clearRequirementsDrafts(); pimStore.clear(); });
afterEach(() => vi.restoreAllMocks());

it('guarda en la misma ficha y vuelve a preguntar según las condiciones activadas', async () => {
  let state = fixture();
  vi.spyOn(api, 'get').mockImplementation(async () => state);
  const patch = vi.spyOn(api, 'patch').mockImplementation(async () => {
    state = fixture(2);
    state.evaluation.message = 'La edad requiere completar una advertencia.';
    state.evaluation.fields = [{ id: 'warning', label: 'Advertencia de seguridad', type: 'select', required: true, options: ['Contiene piezas pequeñas', 'Otra advertencia'], closed: true, value: '', hint: 'Selecciona una advertencia aceptada por Amazon.' }];
    return state;
  });
  const { client } = mount();
  expect(await screen.findByText('Amazon acepta un número entero de años.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Edad recomendada/), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar y volver a evaluar' }));
  expect(await screen.findByLabelText(/Advertencia de seguridad/)).toHaveValue('');
  expect(patch).toHaveBeenCalledWith('/products/BRICKS-01/amazon-requirements', { revision: 1, evaluationId: 'evaluation-1', answers: { age: '3' } }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(client.getQueryData(['catalog', 'products', identity.account])).toEqual([state.product]);
  expect(screen.getByText(/Amazon revisará el producto cuando decidas enviarlo/)).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Sobre esta comprobación' }));
  expect(screen.getByText(/Amazon revisará el producto cuando decidas enviarlo/)).toBeVisible();
});

it('el botón existente prepara en el chat la elección explícita de esta ficha sin enviarla todavía', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(fixture(3));
  const post = vi.spyOn(api, 'post');
  const prompt = vi.fn();
  window.addEventListener('uonify:product-prompt', prompt);
  try {
    mount();
    await screen.findByText('Falta completar la edad recomendada.');
    fireEvent.click(screen.getByRole('button', { name: 'Completar con Uony' }));
    expect(prompt).toHaveBeenCalledOnce();
    expect((prompt.mock.calls[0][0] as CustomEvent).detail).toEqual({
      text: 'Quiero continuar la preparación de este producto con Uony y completar sus requisitos de Amazon. SKU: BRICKS-01.',
      productLink: { sku: 'BRICKS-01', revision: 3 },
    });
    expect(post).not.toHaveBeenCalled();
  } finally { window.removeEventListener('uonify:product-prompt', prompt); }
});

it('valida el formato y ofrece una sugerencia sin darla por confirmada', async () => {
  const state = fixture();
  state.evaluation.fields[0].suggestion = { value: '3', source: 'Propuesta de la ficha técnica; confirma la edad del fabricante.' };
  vi.spyOn(api, 'get').mockResolvedValue(state);
  const patch = vi.spyOn(api, 'patch');
  mount();
  const field = await screen.findByLabelText(/Edad recomendada/);
  expect(field).toHaveValue('');
  fireEvent.change(field, { target: { value: 'tres' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar y volver a evaluar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Introduce un número entero válido');
  expect(patch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Usar sugerencia' }));
  expect(field).toHaveValue('3');
  expect(patch).not.toHaveBeenCalled();
});

it('conserva las respuestas ante conflicto y exige revisar la versión nueva', async () => {
  let state = fixture();
  vi.spyOn(api, 'get').mockImplementation(async () => state);
  const patch = vi.spyOn(api, 'patch').mockImplementationOnce(async () => {
    state = fixture(2); state.evaluation.fields[0].value = '5';
    throw new ApiError(409, { message: 'La ficha ha cambiado.' });
  }).mockImplementationOnce(async () => { state = fixture(3); state.evaluation.fields[0].value = '3'; return state; });
  mount();
  fireEvent.change(await screen.findByLabelText(/Edad recomendada/), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar y volver a evaluar' }));
  await screen.findByText(/Guardado: 5/);
  expect(screen.getByLabelText(/Edad recomendada/)).toHaveValue('3');
  expect(screen.getByRole('button', { name: 'Guardar y volver a evaluar' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'He revisado los cambios: conservar mis respuestas' }));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar y volver a evaluar' }));
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
  expect(patch.mock.calls[1][1]).toMatchObject({ revision: 2, evaluationId: 'evaluation-2', answers: { age: '3' } });
});

it('muestra la revisión compartida y no presenta preguntas mientras Uony razona', async () => {
  const state = fixture(); state.evaluation.state = 'reasoning';
  state.evaluation.reasoning = { id: 'job-1', status: 'running', message: 'Revisando tus documentos.' };
  vi.spyOn(api, 'get').mockResolvedValue(state);
  const post = vi.spyOn(api, 'post'); mount();
  expect(await screen.findByText('Uony está revisando tus documentos e imágenes')).toBeVisible();
  expect(screen.queryByLabelText(/Edad recomendada/)).not.toBeInTheDocument();
  expect(screen.queryByText('Siguientes datos pendientes')).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});

it('espera la preparación explícita de las fuentes antes de mostrar preguntas antiguas', async () => {
  const state = fixture(); state.evaluation.state = 'reasoning';
  state.evaluation.reasoning = { id: null, status: 'stale', requiresPreparation: true, canRetry: true, message: 'Revisa tus documentos para continuar.' };
  vi.spyOn(api, 'get').mockResolvedValue(state);
  const post = vi.spyOn(api, 'post').mockResolvedValue(state); mount();
  const button = await screen.findByRole('button', { name: 'Revisar documentos con Uony' });
  expect(screen.queryByLabelText(/Edad recomendada/)).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled(); fireEvent.click(button);
  await waitFor(() => expect(post).toHaveBeenCalledOnce());
  expect(post.mock.calls[0][0]).toBe('/products/BRICKS-01/amazon-requirements/prepare');
});

it('autoriza expresamente un posible nuevo consumo antes de reintentar desde Producto', async () => {
  const state = fixture(); state.evaluation.state = 'reasoning'; state.evaluation.fields = [];
  state.evaluation.reasoning = { id: 'job-2', status: 'unknown', message: 'La ejecución anterior no tiene resultado confirmado.' };
  vi.spyOn(api, 'get').mockResolvedValue(state);
  const post = vi.spyOn(api, 'post').mockResolvedValue(state); mount();
  const button = await screen.findByRole('button', { name: 'Reintentar con Uony' });
  expect(button).toBeDisabled(); expect(post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(button);
  await waitFor(() => expect(post).toHaveBeenCalledOnce());
  expect(post.mock.calls[0][0]).toBe('/products/BRICKS-01/amazon-requirements/prepare');
  expect(post.mock.calls[0][1]).toEqual({ revision: 1, retry: true, acknowledgeUnknown: true });
});

it('permite consultar un atributo opcional y guarda contra su evaluación', async () => {
  let state = fixture();
  const get = vi.spyOn(api, 'get').mockImplementation(async (_path, options) => {
    if (options?.params?.attribute === 'material') return { ...state, evaluation: { ...state.evaluation, evaluationId: 'material-1', fields: [{ id: 'material', label: 'Material del producto', type: 'select', required: false, options: ['Madera'], closed: false, value: 'Madera' }] } };
    return state;
  });
  const patch = vi.spyOn(api, 'patch').mockImplementation(async () => { state = fixture(2); return state; });
  mount();
  fireEvent.change(await screen.findByLabelText('Revisar un atributo de la ficha'), { target: { value: 'material' } });
  fireEvent.change(await screen.findByLabelText('Material del producto'), { target: { value: 'Bambú' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar y volver a evaluar' }));
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
  expect(get).toHaveBeenCalledWith('/products/BRICKS-01/amazon-requirements', expect.objectContaining({ params: { attribute: 'material' } }));
  expect(patch.mock.calls[0][1]).toEqual({ revision: 1, evaluationId: 'material-1', answers: { material: 'Bambú' }, attribute: 'material' });
});

it('consulta requisitos reales con el ASIN y evita cambiar la fuente con respuestas pendientes', async () => {
  let state = fixture(); state.evaluation.state = 'unconfigured'; state.evaluation.productType = null; state.evaluation.referenceAsin = null; state.evaluation.fields = []; state.evaluation.attributes = [];
  vi.spyOn(api, 'get').mockImplementation(async () => state);
  const post = vi.spyOn(api, 'post').mockImplementation(async () => { state = fixture(2); return state; });
  mount();
  fireEvent.change(await screen.findByLabelText('ASIN de referencia'), { target: { value: 'b07nppmzm8' } });
  fireEvent.click(screen.getByRole('button', { name: 'Consultar requisitos' }));
  fireEvent.change(await screen.findByLabelText(/Edad recomendada/), { target: { value: '3' } });
  fireEvent.click(screen.getByText('Cambiar categoría o actualizar requisitos de Amazon'));
  expect(screen.getByRole('button', { name: 'Actualizar requisitos' })).toBeDisabled();
  expect(post.mock.calls[0][1]).toEqual({ revision: 1, referenceAsin: 'B07NPPMZM8', marketplaceId: 'A1RKKUPIHCS9HS' });
});

it('no sobrescribe el editor y conserva respuestas al volver a la ficha', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(fixture());
  const patch = vi.spyOn(api, 'patch');
  const first = mount();
  fireEvent.change(await screen.findByLabelText(/Edad recomendada/), { target: { value: '3' } });
  act(() => pimStore.set(product.sku, 'edited', { name: 'Título pendiente' }));
  expect(screen.getByRole('button', { name: 'Guardar y volver a evaluar' })).toBeDisabled();
  first.unmount(); mount();
  expect(await screen.findByLabelText(/Edad recomendada/)).toHaveValue('3');
  expect(patch).not.toHaveBeenCalled();
});

it('la identidad cambiada aborta el guardado y no traslada respuestas a otra cuenta', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue(fixture());
  let resolve: (value: AmazonRequirements) => void = () => {};
  const patch = vi.spyOn(api, 'patch').mockImplementation(() => new Promise(done => { resolve = done as typeof resolve; }));
  const { client } = mount(true);
  fireEvent.change(await screen.findByLabelText(/Edad recomendada/), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar y volver a evaluar' }));
  const signal = patch.mock.calls[0][2]?.signal;
  get.mockRejectedValue(new ApiError(404, { message: 'Producto no disponible en esta cuenta.' }));
  act(() => { identity.account = 'two@example.test'; window.dispatchEvent(new Event('uonify:identity-changed')); });
  expect(signal?.aborted).toBe(true);
  await act(async () => resolve(fixture(2)));
  expect(client.getQueryData([...amazonRequirementsKey(identity.account, product.sku), ''])).toBeUndefined();
  expect(client.getQueryData(['catalog', 'products', identity.account])).toBeUndefined();
  expect(screen.queryByDisplayValue('3')).not.toBeInTheDocument();
});

it('actualiza un esquema caducado sin borrar las respuestas que estaban en edición', async () => {
  let state = fixture();
  vi.spyOn(api, 'get').mockImplementation(async () => state);
  const post = vi.spyOn(api, 'post').mockImplementation(async () => { state = fixture(3); return state; });
  mount();
  fireEvent.change(await screen.findByLabelText(/Edad recomendada/), { target: { value: '3' } });
  state = fixture(2); state.evaluation.state = 'stale'; state.evaluation.evaluationId = null; state.evaluation.fields = [];
  act(() => window.dispatchEvent(new Event('uonify:products-changed')));
  await screen.findByText('Puedes actualizar los requisitos. Tus respuestas seguirán aquí para compararlas después.');
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar requisitos' }));
  expect(await screen.findByLabelText(/Edad recomendada/)).toHaveValue('3');
  expect(post).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Guardar y volver a evaluar' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'He revisado los cambios: conservar mis respuestas' }));
  expect(screen.getByRole('button', { name: 'Guardar y volver a evaluar' })).toBeEnabled();
});
