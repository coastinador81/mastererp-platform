import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { ProductDriveAnalysis } from '../components/ProductDriveAnalysis';
import { MaterialAnalysisResults } from '../components/MaterialAnalysisResults';
import { productMaterialsApi, type MaterialAnalysisJob, type ProductMaterials } from '../api/productMaterials';
import { driveApi } from '../api/driveApi';

let account = 'one@example.test';
let dirty = false;
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => account }));
vi.mock('@/shared/pim', () => ({ hasProductEdits: () => dirty }));
vi.mock('../components/DriveConnectionSettings', () => ({ DriveConnectionSettings: () => <div>Conectar Google Drive aquí</div> }));
const paused: MaterialAnalysisJob = {
  id: '11111111-1111-4111-8111-111111111111', sku: 'BASIC', revision: 1, status: 'paused', stage: 'paused', folderId: '1234567890_drive', folderName: 'Basic Mini Bricks',
  processed: 95, total: 95, sources: [{ id: 'source-1', name: 'Ficha técnica.pdf', mimeType: 'application/pdf', status: 'partial' }],
  proposals: [{ id: 'p1', field: 'brand', label: 'Marca', value: 'Uonify', evidence: [{ sourceId: 'source-1', locator: 'Página 1', excerpt: 'Marca: Uonify' }], status: 'proposed' }],
  warnings: [], canResume: true, pauseReason: 'user_requested',
  coverage: { sourcesTotal: 95, sourcesRead: 87, fragmentsTotal: 210, fragmentsDone: 30, fragmentsPending: 180 },
  budget: { maxCalls: 200, usedCalls: 16, maxTokens: 1_000_000, usedTokens: 120_000 },
};
paused.facts = { version: 1, proposals: [{ ...paused.proposals[0], canonicalField: 'brand', normalizedValue: 'uonify', scope: 'product', channel: 'product', claimType: 'declared', supportStatus: 'supported', supportReasons: [], reviewable: true, sourceProposalIds: ['p1'], originalValues: ['Uonify'] }], rejections: [] };
const running: MaterialAnalysisJob = { ...paused, status: 'running', stage: 'analyzing', pauseReason: undefined, canResume: false };
const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onReview = vi.fn(() => true);
  render(<QueryClientProvider client={client}><ProductDriveAnalysis account="one@example.test" sku="BASIC" revision={1} onReview={onReview} /></QueryClientProvider>);
  return { client, onReview };
};
beforeEach(() => {
  account = 'one@example.test'; dirty = false;
  vi.spyOn(driveApi, 'state').mockResolvedValue({ connection: { status: 'connected' }, available: true, accessAllowed: true });
  vi.spyOn(productMaterialsApi, 'latest').mockResolvedValue({ job: paused, product: { sku: 'BASIC', revision: 3 } });
  vi.spyOn(productMaterialsApi, 'job').mockResolvedValue({ job: paused });
});
afterEach(() => vi.restoreAllMocks());

it('recupera una pausa sin reanudar automáticamente y permite revisar lo guardado en el chat', async () => {
  const resume = vi.spyOn(productMaterialsApi, 'resume');
  const { onReview } = mount();
  await screen.findByRole('button', { name: 'Reanudar análisis con Uony' });
  expect(screen.getByText('87 de 95 archivos procesados')).toBeInTheDocument();
  expect(screen.getByText('30 de 210 partes procesadas · 180 pendientes de procesar')).toBeInTheDocument();
  expect(screen.getByText('16 de 200 llamadas · 120.000 de 1.000.000 tokens del límite actual.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Completar requisitos de Amazon con Uony' }));
  expect(onReview).toHaveBeenCalledWith(paused.id);
  expect(resume).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('reanuda el mismo trabajo con la revisión actual y conserva los resultados en caché', async () => {
  const resume = vi.spyOn(productMaterialsApi, 'resume').mockResolvedValue({ job: running, product: { sku: 'BASIC', revision: 5 } });
  const { client } = mount();
  await screen.findByRole('button', { name: 'Reanudar análisis con Uony' });
  vi.mocked(productMaterialsApi.latest).mockResolvedValue({ job: paused, product: { sku: 'BASIC', revision: 5 } });
  fireEvent.click(screen.getByRole('button', { name: 'Reanudar análisis con Uony' }));
  await screen.findByRole('button', { name: 'Pausar análisis' });
  expect(resume).toHaveBeenCalledWith('BASIC', paused.id, { requestId: expect.any(String), revision: 5 }, expect.any(AbortSignal));
  expect(client.getQueryData(['product-drive-materials', account, 'BASIC'])).toEqual({ job: running, product: { sku: 'BASIC', revision: 5 } });
  expect(screen.getByRole('progressbar', { name: 'Análisis de partes del contenido' })).toHaveAttribute('value', '30');
});

it('pausa sin borrar progreso ni exigir guardar una edición manual que no se aplica', async () => {
  dirty = true;
  vi.mocked(productMaterialsApi.latest).mockResolvedValue({ job: running, product: { sku: 'BASIC', revision: 4 } });
  vi.mocked(productMaterialsApi.job).mockResolvedValue({ job: running });
  const pause = vi.spyOn(productMaterialsApi, 'pause').mockResolvedValue({ job: paused, product: { sku: 'BASIC', revision: 4 } });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Pausar análisis' }));
  await screen.findByText('Análisis pausado.');
  expect(pause).toHaveBeenCalledWith('BASIC', paused.id, { requestId: expect.any(String), revision: 4 }, expect.any(AbortSignal));
  expect(screen.getByText('30 de 210 partes procesadas · 180 pendientes de procesar')).toBeInTheDocument();
});

it('protege cambios manuales sin guardar antes de reanudar', async () => {
  dirty = true;
  const resume = vi.spyOn(productMaterialsApi, 'resume');
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Reanudar análisis con Uony' }));
  await screen.findByText('Guarda los cambios de la ficha antes de reanudar el análisis.');
  expect(resume).not.toHaveBeenCalled();
});

it.each(['paused', 'error'] as const)('conserva la continuidad y no ofrece otra carpeta con estado %s reanudable', async status => {
  const resumable = { ...paused, status };
  vi.mocked(productMaterialsApi.latest).mockResolvedValue({ job: resumable });
  vi.mocked(productMaterialsApi.job).mockResolvedValue({ job: resumable });
  mount();
  await screen.findByRole('button', { name: 'Reanudar análisis con Uony' });
  expect(screen.queryByRole('button', { name: 'Analizar otra carpeta o una versión nueva' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Carpeta con los materiales del producto')).not.toBeInTheDocument();
});

it('ofrece un nuevo análisis si la fuente cambió y el anterior no se puede reanudar', async () => {
  const changed = { ...paused, pauseReason: 'source_changed', canResume: false };
  vi.mocked(productMaterialsApi.latest).mockResolvedValue({ job: changed });
  vi.mocked(productMaterialsApi.job).mockResolvedValue({ job: changed });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Analizar otra carpeta o una versión nueva' }));
  expect(screen.getByLabelText('Carpeta con los materiales del producto')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reanudar análisis con Uony' })).not.toBeInTheDocument();
  expect(screen.getByText(/Un archivo ha cambiado desde que empezó el análisis/)).toBeVisible();
});

it.each([
  ['download_limit', 'Se ha alcanzado el límite de lectura de esta pasada. Puedes reanudar para leer los archivos pendientes conservando el avance.'],
  ['discovery_limit', 'Se ha alcanzado el límite de exploración de esta pasada. Puedes reanudar para localizar el resto de archivos y subcarpetas.'],
])('explica la continuación por %s sin presentar el análisis como terminado', (pauseReason, message) => {
  render(<MaterialAnalysisResults job={{ ...paused, pauseReason }} disabled={false} onReview={vi.fn()} />);
  expect(screen.getByText(message, { exact: false })).toBeVisible();
});

it('mantiene la pausa solicitada mientras termina la llamada y evita nuevas solicitudes', async () => {
  const stopping = { ...running, pauseRequested: true };
  vi.mocked(productMaterialsApi.latest).mockResolvedValue({ job: stopping });
  vi.mocked(productMaterialsApi.job).mockResolvedValue({ job: stopping });
  const pause = vi.spyOn(productMaterialsApi, 'pause');
  mount();
  expect(await screen.findByRole('button', { name: 'Pausa solicitada' })).toBeDisabled();
  expect(screen.getByText('Pausa solicitada. Uony guardará el resultado de la operación en curso antes de detenerse.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Reanudar análisis con Uony' })).not.toBeInTheDocument();
  expect(pause).not.toHaveBeenCalled();
});

it('mantiene la clave idempotente cuando la respuesta de reanudación falla', async () => {
  const resume = vi.spyOn(productMaterialsApi, 'resume').mockRejectedValueOnce(new ApiError(503, { message: 'No se recibió la respuesta.' })).mockResolvedValue({ job: running });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Reanudar análisis con Uony' }));
  await screen.findByText('No se recibió la respuesta.');
  fireEvent.click(screen.getByRole('button', { name: 'Reanudar análisis con Uony' }));
  await screen.findByRole('button', { name: 'Pausar análisis' });
  expect(resume).toHaveBeenCalledTimes(2);
  expect(resume.mock.calls[0][2]).toEqual(resume.mock.calls[1][2]);
});

it('no reenvía una reanudación si el servidor ya la había aplicado', async () => {
  const resume = vi.spyOn(productMaterialsApi, 'resume');
  mount();
  await screen.findByRole('button', { name: 'Reanudar análisis con Uony' });
  vi.mocked(productMaterialsApi.latest).mockResolvedValue({ job: running, product: { sku: 'BASIC', revision: 3 } });
  fireEvent.click(screen.getByRole('button', { name: 'Reanudar análisis con Uony' }));
  await screen.findByRole('button', { name: 'Pausar análisis' });
  expect(resume).not.toHaveBeenCalled();
});

it('requiere un clic específico informado si el consumo de la última llamada es incierto', async () => {
  const uncertain = { ...paused, pauseReason: 'consumption_unknown' };
  const resume = vi.spyOn(productMaterialsApi, 'resume').mockResolvedValue({ job: running });
  mount();
  await screen.findByRole('button', { name: 'Reanudar análisis con Uony' });
  vi.mocked(productMaterialsApi.latest).mockResolvedValue({ job: uncertain, product: { sku: 'BASIC', revision: 3 } });
  fireEvent.click(screen.getByRole('button', { name: 'Reanudar análisis con Uony' }));
  await screen.findByRole('button', { name: 'Reintentar parte pendiente' });
  expect(screen.getByText(/La última llamada pudo consumir recursos. Reanudar volverá/)).toBeVisible();
  expect(resume).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar parte pendiente' }));
  await screen.findByRole('button', { name: 'Pausar análisis' });
  expect(resume).toHaveBeenCalledWith('BASIC', paused.id, { requestId: expect.any(String), revision: 3, acknowledgeUnknownConsumption: true }, expect.any(AbortSignal));
});

it('descarta la respuesta de reanudación tras cambiar de cuenta', async () => {
  let finish: (value: ProductMaterials) => void = () => {};
  vi.spyOn(productMaterialsApi, 'resume').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { client } = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Reanudar análisis con Uony' }));
  await waitFor(() => expect(productMaterialsApi.resume).toHaveBeenCalled());
  account = 'two@example.test';
  act(() => window.dispatchEvent(new Event('uonify:identity-changed')));
  await act(async () => finish({ job: running }));
  expect(client.getQueryData(['product-drive-materials', 'one@example.test', 'BASIC'])).toEqual({ job: paused, product: { sku: 'BASIC', revision: 3 } });
});

it('mantiene visibles las partes pendientes y formatos no leídos aunque el trabajo esté ready', () => {
  render(<MaterialAnalysisResults job={{ ...paused, status: 'ready', sources: [...paused.sources, { id: 'svg', name: 'Etiqueta.svg', mimeType: 'image/svg+xml', status: 'unsupported' }] }} disabled={false} onReview={vi.fn()} />);
  expect(screen.getByText('Quedan partes pendientes de analizar. Los datos encontrados se conservan.')).toBeVisible();
  expect(screen.getByText(/1 archivo conservado sin interpretar su contenido/)).toBeVisible();
  expect(screen.queryByText(/Análisis completo/)).not.toBeInTheDocument();
});

it('distingue los fragmentos parciales del trabajo pendiente y el consumo incierto', () => {
  render(<MaterialAnalysisResults job={{ ...paused, coverage: { ...paused.coverage!, fragmentsPartial: 10, fragmentsPending: 170 }, budget: { ...paused.budget!, unknownCalls: 1 } }} disabled={false} onReview={vi.fn()} />);
  expect(screen.getByText('30 de 210 partes procesadas · 170 pendientes de procesar')).toBeInTheDocument();
  expect(screen.getByText('1 llamada tiene consumo pendiente de confirmar. No se contabiliza como coste cero.')).toBeInTheDocument();
});

it('pagina más de cien propuestas sin perder el acceso a ninguna ni cambiar el total', () => {
  const proposals = Array.from({ length: 127 }, (_, index) => ({ ...paused.proposals[0], id: `p${index}`, label: `Atributo ${index + 1}`, value: `Valor ${index + 1}` }));
  render(<MaterialAnalysisResults job={{ ...paused, proposals, facts: undefined }} disabled={false} onReview={vi.fn()} />);
  expect(screen.getByText('127 propuestas pendientes de contrastar y unificar. Todavía no se pueden confirmar en la ficha.')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Ver propuestas y sus fuentes · 127'));
  const pagination = within(screen.getByRole('navigation', { name: 'Páginas de propuestas del análisis' }));
  expect(screen.getByText('Valor 50')).toBeInTheDocument();
  expect(screen.queryByText('Valor 51')).not.toBeInTheDocument();
  fireEvent.click(pagination.getByRole('button', { name: 'Siguiente' }));
  expect(screen.getByText('Valor 100')).toBeInTheDocument();
  fireEvent.click(pagination.getByRole('button', { name: 'Siguiente' }));
  expect(screen.getByText('Valor 127')).toBeInTheDocument();
  expect(pagination.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  fireEvent.click(pagination.getByRole('button', { name: 'Anterior' }));
  expect(screen.getByText('Valor 51')).toBeInTheDocument();
});

it('codifica las rutas y conserva el cuerpo de pausa y reanudación', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({ job: paused });
  const body = { requestId: 'request', revision: 4, acknowledgeUnknownConsumption: true };
  await productMaterialsApi.resume('A B', 'id/unsafe', body);
  expect(post).toHaveBeenCalledWith('/products/A%20B/materials/jobs/id%2Funsafe/resume', body, { signal: undefined });
  await productMaterialsApi.pause('A B', 'id/unsafe', { requestId: 'request', revision: 4 });
  expect(post).toHaveBeenCalledWith('/products/A%20B/materials/jobs/id%2Funsafe/pause', { requestId: 'request', revision: 4 }, { signal: undefined });
});
