import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/shared/api/client';
import { notifyProductChanges } from '@/shared/pim';
import { productIntakesApi, type ProductIntake } from '../api/productIntakes';
import { productMaterialsApi } from '../api/productMaterials';
import { driveApi } from '../api/driveApi';
import { IntakeDriveAnalysis } from '../components/IntakeDriveAnalysis';

let account = 'one@example.test';
let active = true;
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => account }));
vi.mock('@/shared/pim', () => ({ hasProductEdits: () => false, notifyProductChanges: vi.fn() }));
vi.mock('../components/DriveConnectionSettings', () => ({ DriveConnectionSettings: () => <div>Conectar Google Drive aquí</div> }));
const id = '11111111-1111-4111-8111-111111111111';
const threadId = 't-basic';
const folderId = '1234567890_basic';
const selecting: ProductIntake = { id, threadId, revision: 1, status: 'selecting' };
const identified: ProductIntake = { ...selecting, revision: 2, status: 'identified', folder: { id: folderId, name: 'Basic Mini Bricks' }, suggestedName: 'Basic Mini Bricks' };
const linked: ProductIntake = { ...identified, revision: 3, status: 'linked', product: { sku: 'BASIC', revision: 2 } };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(<QueryClientProvider client={client}><IntakeDriveAnalysis account="one@example.test" threadId={threadId} id={id} revision={1} isCurrent={() => active} onReview={() => true} /></QueryClientProvider>);
  return { client, ...view };
}
async function choose() {
  fireEvent.change(await screen.findByLabelText('Carpeta con los materiales del producto'), { target: { value: folderId } });
  fireEvent.click(screen.getByRole('button', { name: 'Elegir carpeta' }));
}
beforeEach(() => {
  account = 'one@example.test'; active = true;
  vi.spyOn(driveApi, 'state').mockResolvedValue({ connection: { status: 'connected' }, available: true, accessAllowed: true });
  vi.spyOn(productIntakesApi, 'get').mockResolvedValue(selecting);
  vi.spyOn(productIntakesApi, 'folder').mockResolvedValue(identified);
  vi.spyOn(productIntakesApi, 'product').mockResolvedValue(linked);
  vi.spyOn(productMaterialsApi, 'latest').mockResolvedValue({ job: null, product: linked.product });
  vi.spyOn(productMaterialsApi, 'start').mockRejectedValue(new Error('No debe analizarse automáticamente.'));
  vi.mocked(notifyProductChanges).mockClear();
});
afterEach(() => vi.restoreAllMocks());

it('recupera la preparación sin crear un producto ni consumir análisis', async () => {
  mount();
  await screen.findByRole('button', { name: 'Explorar Drive' });
  expect(screen.queryByRole('button', { name: 'Elegir carpeta' })).not.toBeInTheDocument();
  expect(productIntakesApi.get).toHaveBeenCalledWith(id, threadId, expect.any(AbortSignal));
  expect(screen.getByText(/sin leer los documentos ni consumir IA/)).toBeVisible();
  expect(productIntakesApi.folder).not.toHaveBeenCalled();
  expect(productIntakesApi.product).not.toHaveBeenCalled();
  expect(productMaterialsApi.latest).not.toHaveBeenCalled();
  expect(productMaterialsApi.start).not.toHaveBeenCalled();
});

it('muestra una sola acción para explorar y ofrece elegir únicamente tras una referencia válida', async () => {
  mount();
  const explore = await screen.findByRole('button', { name: 'Explorar Drive' });
  const input = screen.getByLabelText('Carpeta con los materiales del producto');
  expect(explore).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Elegir carpeta' })).not.toBeInTheDocument();
  fireEvent.change(input, { target: { value: 'texto que no es una carpeta' } });
  expect(screen.queryByRole('button', { name: 'Elegir carpeta' })).not.toBeInTheDocument();
  fireEvent.change(input, { target: { value: `https://drive.google.com/drive/folders/${folderId}` } });
  expect(screen.getByRole('button', { name: 'Elegir carpeta' })).toBeVisible();
  expect(productIntakesApi.folder).not.toHaveBeenCalled();
});

it('elige materiales antes del nombre y no exige SKU al confirmar Basic Mini Bricks', async () => {
  const changes = [{ product: { sku: 'BASIC', name: 'Basic Mini Bricks', revision: 2 }, previousSku: null }];
  vi.mocked(productIntakesApi.product).mockResolvedValue({ ...linked, productChanges: changes });
  mount(); await choose();
  const input = await screen.findByLabelText('Nombre del producto');
  expect(input).toHaveValue('Basic Mini Bricks');
  expect(screen.queryByLabelText(/SKU/i)).not.toBeInTheDocument();
  expect(productIntakesApi.folder).toHaveBeenCalledWith(id, { threadId, revision: 1, folderId, requestId: expect.any(String) }, expect.any(AbortSignal));
  vi.mocked(productIntakesApi.get).mockResolvedValue(identified);
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar producto con Uony' }));
  await screen.findByRole('button', { name: 'Analizar carpeta con Uony' });
  expect(productIntakesApi.product).toHaveBeenCalledWith(id, { threadId, revision: 2, name: 'Basic Mini Bricks', requestId: expect.any(String) }, expect.any(AbortSignal));
  expect(screen.getByLabelText('Carpeta con los materiales del producto')).toHaveValue(`https://drive.google.com/drive/folders/${folderId}`);
  expect(notifyProductChanges).toHaveBeenCalledWith(changes);
  expect(productMaterialsApi.start).not.toHaveBeenCalled();
});

it('consulta la revisión vigente y exige revisar un cambio antes de mutar', async () => {
  vi.mocked(productIntakesApi.get).mockResolvedValueOnce(selecting).mockResolvedValue(identified);
  mount(); await choose();
  await screen.findByText('La preparación ha cambiado. Revisa los datos antes de continuar.');
  expect(screen.getByLabelText('Nombre del producto')).toHaveValue('Basic Mini Bricks');
  expect(productIntakesApi.folder).not.toHaveBeenCalled();
  expect(productIntakesApi.product).not.toHaveBeenCalled();
});

it('un doble clic solo identifica una vez', async () => {
  let finish: (value: ProductIntake) => void = () => undefined;
  vi.mocked(productIntakesApi.folder).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  mount();
  fireEvent.change(await screen.findByLabelText('Carpeta con los materiales del producto'), { target: { value: folderId } });
  const button = screen.getByRole('button', { name: 'Elegir carpeta' });
  fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(productIntakesApi.folder).toHaveBeenCalledTimes(1));
  await act(async () => finish(identified));
  await screen.findByLabelText('Nombre del producto');
});

it('conserva el identificador de reintento después de una respuesta desconocida', async () => {
  vi.mocked(productIntakesApi.folder).mockRejectedValueOnce(new TypeError('network')).mockResolvedValue(identified);
  mount(); await choose();
  await screen.findByText('Sin conexión. Revisa tu red e inténtalo de nuevo.');
  const first = vi.mocked(productIntakesApi.folder).mock.calls[0][1].requestId;
  fireEvent.click(screen.getByRole('button', { name: 'Elegir carpeta' }));
  await screen.findByLabelText('Nombre del producto');
  expect(productIntakesApi.folder).toHaveBeenCalledTimes(2);
  expect(vi.mocked(productIntakesApi.folder).mock.calls[1][1].requestId).toBe(first);
});

it('recupera el producto ya vinculado sin volver a crearlo ni analizarlo', async () => {
  vi.mocked(productIntakesApi.get).mockResolvedValue(linked);
  mount();
  await screen.findByRole('button', { name: 'Analizar carpeta con Uony' });
  expect(productIntakesApi.product).not.toHaveBeenCalled();
  expect(productIntakesApi.folder).not.toHaveBeenCalled();
  expect(productMaterialsApi.start).not.toHaveBeenCalled();
});

it('conserva el nombre escrito si falla el guardado y reutiliza el mismo intento explícito', async () => {
  vi.mocked(productIntakesApi.get).mockResolvedValue(identified);
  vi.mocked(productIntakesApi.product).mockRejectedValueOnce(new TypeError('network')).mockResolvedValue(linked);
  mount();
  fireEvent.change(await screen.findByLabelText('Nombre del producto'), { target: { value: 'Basic Mini Bricks confirmado' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar producto con Uony' }));
  await screen.findByText('Sin conexión. Revisa tu red e inténtalo de nuevo.');
  expect(screen.getByLabelText('Nombre del producto')).toHaveValue('Basic Mini Bricks confirmado');
  const first = vi.mocked(productIntakesApi.product).mock.calls[0][1].requestId;
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar producto con Uony' }));
  await screen.findByRole('button', { name: 'Analizar carpeta con Uony' });
  expect(vi.mocked(productIntakesApi.product).mock.calls[1][1]).toMatchObject({ name: 'Basic Mini Bricks confirmado', requestId: first });
  expect(productMaterialsApi.start).not.toHaveBeenCalled();
});

it('la vuelta a una ficha con análisis vigente no vuelve a ofrecer el análisis inicial', async () => {
  const job = { id: '22222222-2222-4222-8222-222222222222', sku: 'BASIC', revision: 2, status: 'ready' as const,
    folderId, folderName: 'Basic Mini Bricks', processed: 1, total: 1, sources: [], proposals: [], warnings: [],
    facts: { version: 1, proposals: [], rejections: [] } };
  vi.mocked(productIntakesApi.get).mockResolvedValue(linked);
  vi.mocked(productMaterialsApi.latest).mockResolvedValue({ job, product: linked.product });
  vi.spyOn(productMaterialsApi, 'job').mockResolvedValue({ job });
  mount();
  await screen.findByRole('button', { name: 'Completar requisitos de Amazon con Uony' });
  expect(screen.queryByLabelText('Carpeta con los materiales del producto')).not.toBeInTheDocument();
  expect(productMaterialsApi.start).not.toHaveBeenCalled();
  expect(productIntakesApi.product).not.toHaveBeenCalled();
});

it('un error de consulta permite recuperación explícita sin ejecutar una mutación', async () => {
  vi.mocked(productIntakesApi.get).mockRejectedValueOnce(new ApiError(503, { message: 'Consulta temporalmente no disponible.' })).mockResolvedValue(selecting);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
  await screen.findByRole('button', { name: 'Explorar Drive' });
  expect(screen.queryByRole('button', { name: 'Elegir carpeta' })).not.toBeInTheDocument();
  expect(productIntakesApi.folder).not.toHaveBeenCalled();
  expect(productIntakesApi.product).not.toHaveBeenCalled();
});

it('permite conectar Drive en la conversación recuperando el mismo estado sin mutaciones', async () => {
  vi.mocked(driveApi.state).mockResolvedValue({ connection: { status: 'disconnected' }, available: true, accessAllowed: true });
  mount();
  await screen.findByText('Conectar Google Drive aquí');
  expect(productIntakesApi.get).toHaveBeenCalledWith(id, threadId, expect.any(AbortSignal));
  expect(productIntakesApi.folder).not.toHaveBeenCalled();
});

it('ofrece la conexión existente si el permiso caduca entre ambas consultas', async () => {
  vi.mocked(productIntakesApi.get).mockRejectedValue(new ApiError(409, { error: 'reauthorize', message: 'Renueva la conexión con Drive para continuar.' }));
  mount();
  await screen.findByText('Conectar Google Drive aquí');
  expect(productIntakesApi.product).not.toHaveBeenCalled();
});

it('ofrece recuperar Drive si la autorización caduca al elegir la carpeta sin repetir el POST', async () => {
  vi.mocked(productIntakesApi.folder).mockRejectedValue(new ApiError(409, { error: 'reauthorize', message: 'Renueva la conexión con Drive para continuar.', connectionActions: [{ provider: 'drive', action: 'manage' }] }));
  mount(); await choose();
  await screen.findByText('Conectar Google Drive aquí');
  expect(productIntakesApi.folder).toHaveBeenCalledTimes(1);
  expect(productIntakesApi.product).not.toHaveBeenCalled();
  expect(productMaterialsApi.start).not.toHaveBeenCalled();
});

it.each(['account', 'thread'])('descarta una respuesta tardía al cambiar %s', async kind => {
  let finish: (value: ProductIntake) => void = () => undefined;
  vi.mocked(productIntakesApi.folder).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { client } = mount(); await choose();
  await waitFor(() => expect(productIntakesApi.folder).toHaveBeenCalledTimes(1));
  if (kind === 'account') account = 'two@example.test'; else active = false;
  await act(async () => finish({ ...linked, productChanges: [{ product: { sku: 'BASIC', name: 'Basic Mini Bricks', revision: 2 }, previousSku: null }] }));
  expect(client.getQueryData(['product-intake', 'one@example.test', threadId, id])).toEqual(selecting);
  expect(notifyProductChanges).not.toHaveBeenCalled();
  expect(productMaterialsApi.latest).not.toHaveBeenCalled();
});

it('invalida una respuesta anterior aunque vuelva la misma identidad antes de recibirla', async () => {
  let finish: (value: ProductIntake) => void = () => undefined;
  vi.mocked(productIntakesApi.folder).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { client } = mount(); await choose();
  await waitFor(() => expect(productIntakesApi.folder).toHaveBeenCalledTimes(1));
  act(() => { window.dispatchEvent(new Event('uonify:identity-changed')); });
  await act(async () => finish(linked));
  expect(client.getQueryData(['product-intake', 'one@example.test', threadId, id])).toEqual(selecting);
  expect(notifyProductChanges).not.toHaveBeenCalled();
  expect(productMaterialsApi.latest).not.toHaveBeenCalled();
});

it('rechaza una preparación de otro hilo sin mostrar datos ni ejecutar acciones', async () => {
  vi.mocked(productIntakesApi.get).mockResolvedValue({ ...identified, threadId: 'another-thread' });
  mount();
  await screen.findByText('No se ha podido recuperar la preparación de este producto.');
  expect(screen.queryByLabelText('Nombre del producto')).not.toBeInTheDocument();
  expect(productIntakesApi.product).not.toHaveBeenCalled();
});
