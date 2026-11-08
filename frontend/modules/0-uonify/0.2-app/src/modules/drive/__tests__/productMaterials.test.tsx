import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError, errorMessage } from '@/shared/api/client';
import { ProductDriveAnalysis } from '../components/ProductDriveAnalysis';
import { productMaterialsApi, type MaterialAnalysisJob } from '../api/productMaterials';
import { driveApi } from '../api/driveApi';
import { driveFolderId } from '../model/folderId';
import { MATERIAL_START_CONSENT_SHA256, MATERIAL_START_CONSENT_TEXT, MATERIAL_START_CONSENT_VERSION } from '../model/materialAnalysisConsent';

let account = 'one@example.test';
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => account }));
vi.mock('@/shared/pim', () => ({ hasProductEdits: () => false }));
vi.mock('../components/DriveConnectionSettings', () => ({ DriveConnectionSettings: () => <div>Conectar Google Drive aquí</div> }));
const folderId = '1234567890_drive';
const job: MaterialAnalysisJob = {
  id: '11111111-1111-4111-8111-111111111111', sku: 'BASIC', revision: 2, status: 'ready', folderId, folderName: 'Basic Mini Bricks', processed: 2, total: 2,
  sources: [{ id: 'source-1', name: 'Ficha técnica.pdf', mimeType: 'application/pdf', status: 'analyzed' }],
  proposals: [{ id: 'p1', field: 'brand', label: 'Marca', value: 'Uonify', evidence: [{ sourceId: 'source-1', locator: 'Página 1', excerpt: 'Marca: Uonify' }], status: 'proposed' }],
  warnings: ['Una imagen no contenía texto verificable.'],
};
job.facts = { version: 1, proposals: [{ ...job.proposals[0], canonicalField: 'brand', normalizedValue: 'uonify', scope: 'product', channel: 'product', claimType: 'declared', supportStatus: 'supported', supportReasons: [], reviewable: true, sourceProposalIds: ['p1'], originalValues: ['Uonify'] }], rejections: [] };
const mount = (onReview = vi.fn(() => true)) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ProductDriveAnalysis account="one@example.test" sku="BASIC" revision={1} onReview={onReview} /></QueryClientProvider>);
  return { client, onReview };
};
beforeEach(() => {
  account = 'one@example.test';
  vi.spyOn(driveApi, 'state').mockResolvedValue({ connection: { status: 'connected' }, available: true, accessAllowed: true });
  vi.spyOn(productMaterialsApi, 'latest').mockResolvedValue({ job: null, product: { sku: 'BASIC', revision: 2 } });
  vi.spyOn(productMaterialsApi, 'startConsent').mockResolvedValue({
    version: MATERIAL_START_CONSENT_VERSION, text: MATERIAL_START_CONSENT_TEXT,
    sha256: MATERIAL_START_CONSENT_SHA256 });
  vi.spyOn(productMaterialsApi, 'job').mockResolvedValue({ job });
});
afterEach(() => vi.restoreAllMocks());

it.each([
  [folderId, folderId], [`https://drive.google.com/drive/folders/${folderId}?usp=sharing`, folderId],
  [`https://drive.google.com/drive/u/0/folders/${folderId}`, folderId],
  ['https://evil.test/drive/folders/1234567890', null], ['https://drive.google.com.evil.test/drive/folders/1234567890', null],
  ['javascript:alert(1)', null], ['https://drive.google.com/file/d/1234567890/view', null], ['root', null],
])('valida una referencia de carpeta sin aceptar otras URLs: %s', (value, expected) => expect(driveFolderId(value!)).toBe(expected));

it('solo inicia al confirmar una carpeta y utiliza la revisión vigente', async () => {
  const start = vi.spyOn(productMaterialsApi, 'start').mockResolvedValue({ job });
  mount();
  const input = await screen.findByLabelText('Carpeta con los materiales del producto');
  expect(screen.getByText('Uony analizará los documentos y las imágenes de esta carpeta y sus subcarpetas. Tus originales se conservan.')).toBeVisible();
  expect(screen.getByText('Presupuesto inicial: 200 llamadas y 1.000.000 de tokens. Al alcanzar el límite, el análisis se pausa automáticamente. El consumo se realiza en tu proyecto de Google conectado.')).toBeVisible();
  fireEvent.change(input, { target: { value: `https://drive.google.com/drive/folders/${folderId}` } });
  expect(start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Analizar carpeta con Uony' }));
  await screen.findByText('Uony aprovechará los datos de tus documentos y solo te preguntará por lo que no pueda completar para Amazon.');
  expect(start).toHaveBeenCalledTimes(1);
  expect(start).toHaveBeenCalledWith('BASIC', { folderId, revision: 2, requestId: expect.any(String),
    consentVersion: MATERIAL_START_CONSENT_VERSION, consentText: MATERIAL_START_CONSENT_TEXT,
    consentSha256: MATERIAL_START_CONSENT_SHA256 }, expect.any(AbortSignal));
});

it('solo reanaliza la misma carpeta tras pedir una nueva versión de forma explícita', async () => {
  vi.mocked(productMaterialsApi.latest).mockResolvedValue({ job, product: { sku: 'BASIC', revision: 2 } });
  const start = vi.spyOn(productMaterialsApi, 'start').mockResolvedValue({ job: { ...job, id: '22222222-2222-4222-8222-222222222222', status: 'queued' } });
  mount();
  await screen.findByRole('button', { name: 'Analizar otra carpeta o una versión nueva' });
  expect(start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Analizar otra carpeta o una versión nueva' }));
  fireEvent.change(screen.getByLabelText('Carpeta con los materiales del producto'), { target: { value: folderId } });
  fireEvent.click(screen.getByRole('button', { name: 'Analizar carpeta con Uony' }));
  await waitFor(() => expect(start).toHaveBeenCalledWith('BASIC',
    { folderId, revision: 2, requestId: expect.any(String), consentVersion: MATERIAL_START_CONSENT_VERSION,
      consentText: MATERIAL_START_CONSENT_TEXT, consentSha256: MATERIAL_START_CONSENT_SHA256,
      reanalysisOf: job.id }, expect.any(AbortSignal)));
});

it('no inicia un análisis sin recibo si el backend anterior no ofrece la versión de consentimiento', async () => {
  vi.mocked(productMaterialsApi.startConsent).mockRejectedValue(new ApiError(404, { detail: 'Not Found' }));
  const start = vi.spyOn(productMaterialsApi, 'start');
  mount();
  fireEvent.change(await screen.findByLabelText('Carpeta con los materiales del producto'), { target: { value: folderId } });
  fireEvent.click(screen.getByRole('button', { name: 'Analizar carpeta con Uony' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Recarga la página para revisar las condiciones');
  expect(start).not.toHaveBeenCalled();
});

it('no inicia si el servidor anuncia un texto de autorización distinto', async () => {
  vi.mocked(productMaterialsApi.startConsent).mockResolvedValue({
    version: 'materials-start-newer', text: MATERIAL_START_CONSENT_TEXT,
    sha256: MATERIAL_START_CONSENT_SHA256 });
  const start = vi.spyOn(productMaterialsApi, 'start');
  mount();
  fireEvent.change(await screen.findByLabelText('Carpeta con los materiales del producto'), { target: { value: folderId } });
  fireEvent.click(screen.getByRole('button', { name: 'Analizar carpeta con Uony' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Las condiciones del análisis han cambiado.');
  expect(start).not.toHaveBeenCalled();
});

it('bloquea una copia distinta aunque el servidor reutilice la misma versión', async () => {
  vi.mocked(productMaterialsApi.startConsent).mockResolvedValueOnce({
    version: MATERIAL_START_CONSENT_VERSION, text: MATERIAL_START_CONSENT_TEXT + ' cambio',
    sha256: MATERIAL_START_CONSENT_SHA256 }).mockRejectedValueOnce(new ApiError(404, { detail: 'Not Found' }));
  const start = vi.spyOn(productMaterialsApi, 'start');
  mount();
  fireEvent.change(await screen.findByLabelText('Carpeta con los materiales del producto'), { target: { value: folderId } });
  fireEvent.click(screen.getByRole('button', { name: 'Analizar carpeta con Uony' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Las condiciones del análisis han cambiado.');
  expect(start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Analizar carpeta con Uony' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('El servicio de análisis se está actualizando.');
  expect(start).not.toHaveBeenCalled();
});

it('bloquea un hash de servidor que no corresponde a la copia mostrada', async () => {
  vi.mocked(productMaterialsApi.startConsent).mockResolvedValue({
    version: MATERIAL_START_CONSENT_VERSION, text: MATERIAL_START_CONSENT_TEXT,
    sha256: '0'.repeat(64) });
  const start = vi.spyOn(productMaterialsApi, 'start');
  mount();
  fireEvent.change(await screen.findByLabelText('Carpeta con los materiales del producto'), { target: { value: folderId } });
  fireEvent.click(screen.getByRole('button', { name: 'Analizar carpeta con Uony' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Las condiciones del análisis han cambiado.');
  expect(start).not.toHaveBeenCalled();
});

it.each([
  new ApiError(401, { message: 'Inicia sesión de nuevo.' }),
  new ApiError(403, { message: 'Acceso no permitido.' }),
  new ApiError(503, { message: 'Servicio no disponible.' }),
  new ApiError(404, { error: 'product_not_found', message: 'La ficha ya no está disponible.' }),
  new TypeError('Failed to fetch'),
])('no degrada a solicitud heredada ante fallo de la capacidad', async failure => {
  vi.mocked(productMaterialsApi.startConsent).mockRejectedValue(failure);
  const start = vi.spyOn(productMaterialsApi, 'start');
  mount();
  fireEvent.change(await screen.findByLabelText('Carpeta con los materiales del producto'), { target: { value: folderId } });
  fireEvent.click(screen.getByRole('button', { name: 'Analizar carpeta con Uony' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(errorMessage(failure));
  expect(start).not.toHaveBeenCalled();
});

it('recupera el análisis que apareció mientras se elegía carpeta sin crear otro', async () => {
  vi.mocked(productMaterialsApi.latest).mockResolvedValueOnce({ job: null, product: { sku: 'BASIC', revision: 2 } });
  const start = vi.spyOn(productMaterialsApi, 'start');
  mount();
  fireEvent.change(await screen.findByLabelText('Carpeta con los materiales del producto'), { target: { value: folderId } });
  vi.mocked(productMaterialsApi.latest).mockResolvedValue({ job, product: { sku: 'BASIC', revision: 2 } });
  fireEvent.click(screen.getByRole('button', { name: 'Analizar carpeta con Uony' }));
  await screen.findByRole('button', { name: 'Completar requisitos de Amazon con Uony' });
  expect(start).not.toHaveBeenCalled();
});

it('recupera propuestas y sus fuentes, y su revisión se envía al chat', async () => {
  vi.mocked(productMaterialsApi.latest).mockResolvedValue({ job });
  const { onReview } = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Completar requisitos de Amazon con Uony' }));
  expect(onReview).toHaveBeenCalledWith(job.id);
  expect(screen.getByText('· Página 1')).toHaveTextContent('Ficha técnica.pdf · Página 1');
  expect(screen.getByText('Marca: Uonify')).toBeInTheDocument();
  expect(screen.getByText('Una imagen no contenía texto verificable.')).toBeInTheDocument();
});

it.each(['gemini-3.5-flash-lite', 'unknown-provider-model', undefined])('presenta el nombre del modelo de análisis solo si es conocido: %s', async analysisModel => {
  const analyzed = { ...job, analysisModel, analysisEffort: 'minimal' };
  vi.mocked(productMaterialsApi.latest).mockResolvedValue({ job: analyzed });
  vi.mocked(productMaterialsApi.job).mockResolvedValue({ job: analyzed });
  mount();
  await screen.findByRole('button', { name: 'Completar requisitos de Amazon con Uony' });
  if (analysisModel === 'gemini-3.5-flash-lite') expect(screen.getByText('Análisis con Gemini 3.5 Flash-Lite')).toBeInTheDocument();
  else expect(screen.queryByText('Análisis con Gemini 3.5 Flash-Lite')).not.toBeInTheDocument();
  expect(screen.queryByText('unknown-provider-model')).not.toBeInTheDocument();
  expect(screen.queryByText('minimal')).not.toBeInTheDocument();
});

it('consulta progreso persistido hasta ready y nunca analiza al montar', async () => {
  vi.mocked(productMaterialsApi.latest).mockResolvedValue({ job: { ...job, status: 'running', processed: 1 } });
  vi.mocked(productMaterialsApi.job).mockResolvedValueOnce({ job: { ...job, status: 'running', processed: 1 } }).mockResolvedValue({ job });
  const start = vi.spyOn(productMaterialsApi, 'start');
  mount();
  await screen.findByRole('progressbar', { name: 'Análisis de archivos' });
  await screen.findByRole('button', { name: 'Completar requisitos de Amazon con Uony' }, { timeout: 5000 });
  expect(productMaterialsApi.job).toHaveBeenCalledTimes(2);
  expect(start).not.toHaveBeenCalled();
});

it('muestra el valor corregido y confirmado, conservando la evidencia original', async () => {
  const reviewed = { ...job, facts: { ...job.facts!, proposals: [{ ...job.facts!.proposals[0], status: 'confirmed' as const, confirmedValue: 'UONIFY' }] } };
  vi.mocked(productMaterialsApi.latest).mockResolvedValue({ job: reviewed });
  vi.mocked(productMaterialsApi.job).mockResolvedValue({ job: reviewed });
  mount();
  expect(await screen.findByText('UONIFY')).toBeInTheDocument();
  expect(screen.queryByText('Uonify', { selector: 'dd' })).not.toBeInTheDocument();
  expect(screen.getByText('Marca: Uonify')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Completar requisitos de Amazon con Uony' })).toBeEnabled();
});

it('permite revisar propuestas de lotes terminados aunque otro lote haya fallado', async () => {
  const partial = { ...job, status: 'error' as const, error: { code: 'quota', message: 'Se ha agotado la cuota de Google.' } };
  vi.mocked(productMaterialsApi.latest).mockResolvedValue({ job: partial });
  vi.mocked(productMaterialsApi.job).mockResolvedValue({ job: partial });
  const { onReview } = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Completar requisitos de Amazon con Uony' }));
  expect(onReview).toHaveBeenCalledWith(job.id);
  expect(screen.getByText('Análisis incompleto. Puedes revisar los datos encontrados o volver a analizar la carpeta.')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Se ha agotado la cuota de Google.');
  expect(screen.getByLabelText('Carpeta con los materiales del producto')).toHaveValue(`https://drive.google.com/drive/folders/${folderId}`);
});

it('avisa de las fuentes parciales fuera del desplegable aunque todos los archivos estén procesados', async () => {
  const partial = { ...job, sources: [{ ...job.sources[0], status: 'partial' }] };
  vi.mocked(productMaterialsApi.latest).mockResolvedValue({ job: partial });
  vi.mocked(productMaterialsApi.job).mockResolvedValue({ job: partial });
  mount();
  const notice = await screen.findByText('Hay archivos con cobertura parcial u observaciones. Consulta su detalle; los descartes registrados no equivalen a datos que debas completar.');
  expect(notice.closest('details')).toBeNull();
  expect(notice).toBeVisible();
  expect(screen.getByText('2 de 2 archivos procesados')).toBeInTheDocument();
});

it('mantiene la clave del reintento tras un fallo incierto del inicio', async () => {
  const start = vi.spyOn(productMaterialsApi, 'start').mockRejectedValueOnce(new ApiError(503, { message: 'Inténtalo otra vez.' })).mockResolvedValue({ job });
  mount();
  fireEvent.change(await screen.findByLabelText('Carpeta con los materiales del producto'), { target: { value: folderId } });
  fireEvent.click(screen.getByRole('button', { name: 'Analizar carpeta con Uony' }));
  await screen.findByText('Inténtalo otra vez.');
  fireEvent.click(screen.getByRole('button', { name: 'Analizar carpeta con Uony' }));
  await screen.findByRole('button', { name: 'Completar requisitos de Amazon con Uony' });
  expect(start.mock.calls[0][1]).toEqual(start.mock.calls[1][1]);
});

it('no degrada un intento versionado a un POST antiguo durante un despliegue mixto', async () => {
  vi.mocked(productMaterialsApi.startConsent).mockResolvedValueOnce({
    version: MATERIAL_START_CONSENT_VERSION, text: MATERIAL_START_CONSENT_TEXT,
    sha256: MATERIAL_START_CONSENT_SHA256,
  }).mockRejectedValueOnce(new ApiError(404, { detail: 'Not Found' })).mockResolvedValueOnce({
    version: MATERIAL_START_CONSENT_VERSION, text: MATERIAL_START_CONSENT_TEXT,
    sha256: MATERIAL_START_CONSENT_SHA256,
  });
  const start = vi.spyOn(productMaterialsApi, 'start')
    .mockRejectedValueOnce(new ApiError(422, { detail: 'Campos no admitidos.' })).mockResolvedValue({ job });
  mount();
  fireEvent.change(await screen.findByLabelText('Carpeta con los materiales del producto'), { target: { value: folderId } });
  fireEvent.click(screen.getByRole('button', { name: 'Analizar carpeta con Uony' }));
  await screen.findByText('No se ha podido completar. Inténtalo de nuevo.');
  fireEvent.click(screen.getByRole('button', { name: 'Analizar carpeta con Uony' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('El servicio de análisis se está actualizando.');
  expect(start).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Analizar carpeta con Uony' }));
  await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
  expect(start.mock.calls[1][1].requestId).toBe(start.mock.calls[0][1].requestId);
  expect(start.mock.calls[0][1]).toHaveProperty('consentVersion', MATERIAL_START_CONSENT_VERSION);
  expect(start.mock.calls[0][1]).toHaveProperty('consentText', MATERIAL_START_CONSENT_TEXT);
  expect(start.mock.calls[0][1]).toHaveProperty('consentSha256', MATERIAL_START_CONSENT_SHA256);
  expect(start.mock.calls[1][1]).toHaveProperty('consentVersion', MATERIAL_START_CONSENT_VERSION);
  expect(start.mock.calls[1][1]).toHaveProperty('consentText', MATERIAL_START_CONSENT_TEXT);
  expect(start.mock.calls[1][1]).toHaveProperty('consentSha256', MATERIAL_START_CONSENT_SHA256);
});

it('permite conectar Drive en el chat y no muestra un selector sin autorización', async () => {
  vi.mocked(driveApi.state).mockResolvedValue({ connection: { status: 'disconnected' }, available: true, accessAllowed: true });
  mount();
  expect(await screen.findByText('Conectar Google Drive aquí')).toBeInTheDocument();
  expect(screen.queryByLabelText('Carpeta con los materiales del producto')).not.toBeInTheDocument();
});

it('descarta resultados de una petición de inicio si cambia la identidad', async () => {
  let finish: (value: { job: MaterialAnalysisJob }) => void = () => {};
  vi.spyOn(productMaterialsApi, 'start').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { client } = mount();
  fireEvent.change(await screen.findByLabelText('Carpeta con los materiales del producto'), { target: { value: folderId } });
  fireEvent.click(screen.getByRole('button', { name: 'Analizar carpeta con Uony' }));
  await waitFor(() => expect(productMaterialsApi.start).toHaveBeenCalled());
  account = 'two@example.test';
  act(() => window.dispatchEvent(new Event('uonify:identity-changed')));
  await act(async () => finish({ job }));
  expect(client.getQueryData(['product-drive-materials', 'one@example.test', 'BASIC'])).toEqual({ job: null, product: { sku: 'BASIC', revision: 2 } });
});

it('codifica el SKU y el identificador al consultar la API', async () => {
  vi.restoreAllMocks();
  const get = vi.spyOn(api, 'get').mockResolvedValue({ job: null });
  await productMaterialsApi.job('A B', 'id/unsafe');
  expect(get).toHaveBeenCalledWith('/products/A%20B/materials/jobs/id%2Funsafe', { signal: undefined });
});
