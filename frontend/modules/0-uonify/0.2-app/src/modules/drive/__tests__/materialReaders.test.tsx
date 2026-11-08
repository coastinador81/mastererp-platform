import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { ProductDriveAnalysis } from '../components/ProductDriveAnalysis';
import { MaterialReadingDetails, MaterialEvidenceLocation } from '../components/MaterialReadingDetails';
import { MaterialAnalysisProgress } from '../components/MaterialAnalysisProgress';
import { productMaterialsApi, type MaterialAnalysisJob, type ProductMaterials } from '../api/productMaterials';
import { driveApi } from '../api/driveApi';
import { MATERIAL_CONTROL_CONSENT, materialControlConsentText } from '../model/materialControlConsent';

let account = 'one@example.test';
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => account }));
vi.mock('@/shared/pim', () => ({ hasProductEdits: () => false }));
const ready: MaterialAnalysisJob = { id: 'reader-test', sku: 'BASIC', revision: 3, status: 'ready', folderId: 'folder1234567', folderName: 'Basic Mini Bricks', processed: 1, total: 1, sources: [], proposals: [], warnings: [], readerUpgradeAvailable: true };
const queued: MaterialAnalysisJob = { ...ready, status: 'queued', operation: 'upgrade_readers', readerUpgradeAvailable: false };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ProductDriveAnalysis account={account} sku="BASIC" revision={1} onReview={vi.fn(() => true)} /></QueryClientProvider>);
  return client;
}
beforeEach(() => {
  account = 'one@example.test';
  vi.spyOn(driveApi, 'state').mockResolvedValue({ connection: { status: 'connected' }, available: true, accessAllowed: true });
  vi.spyOn(productMaterialsApi, 'latest').mockResolvedValue({ job: ready, product: { sku: 'BASIC', revision: 3 } });
  vi.spyOn(productMaterialsApi, 'job').mockResolvedValue({ job: ready });
  vi.spyOn(productMaterialsApi, 'controlConsent').mockResolvedValue({
    version: MATERIAL_CONTROL_CONSENT.upgradeReaders.version,
    text: materialControlConsentText('upgradeReaders'),
    sha256: MATERIAL_CONTROL_CONSENT.upgradeReaders.sha256 });
});
afterEach(() => vi.restoreAllMocks());

it('amplía el mismo trabajo desde el chat con revisión vigente y sin iniciar al montar', async () => {
  const upgrade = vi.spyOn(productMaterialsApi, 'upgradeReaders').mockResolvedValue({ job: queued });
  const client = mount();
  const button = await screen.findByRole('button', { name: 'Analizar archivos pendientes con Uony' });
  expect(upgrade).not.toHaveBeenCalled();
  vi.mocked(productMaterialsApi.latest).mockResolvedValue({ job: ready, product: { sku: 'BASIC', revision: 5 } });
  fireEvent.click(button);
  await screen.findByText(/Uony está ampliando la lectura visual/);
  expect(upgrade).toHaveBeenCalledWith('BASIC', ready.id, { requestId: expect.any(String), revision: 5,
    consentVersion: MATERIAL_CONTROL_CONSENT.upgradeReaders.version,
    consentText: materialControlConsentText('upgradeReaders'),
    consentSha256: MATERIAL_CONTROL_CONSENT.upgradeReaders.sha256 }, expect.any(AbortSignal));
  expect(client.getQueryData(['product-drive-materials', account, 'BASIC'])).toEqual({ job: queued, product: { sku: 'BASIC', revision: 5 } });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('reutiliza la clave de reintento si se pierde la respuesta', async () => {
  const upgrade = vi.spyOn(productMaterialsApi, 'upgradeReaders').mockRejectedValueOnce(new ApiError(503, { message: 'Respuesta no recibida.' })).mockResolvedValue({ job: queued });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Analizar archivos pendientes con Uony' }));
  await screen.findByText('Respuesta no recibida.');
  fireEvent.click(screen.getByRole('button', { name: 'Analizar archivos pendientes con Uony' }));
  await screen.findByText(/Uony está ampliando la lectura visual/);
  expect(upgrade.mock.calls[0][2]).toEqual(upgrade.mock.calls[1][2]);
});

it('no abre otra lectura si el servidor anuncia una copia distinta', async () => {
  vi.mocked(productMaterialsApi.controlConsent).mockResolvedValue({
    version: MATERIAL_CONTROL_CONSENT.upgradeReaders.version,
    text: materialControlConsentText('upgradeReaders') + ' cambio',
    sha256: MATERIAL_CONTROL_CONSENT.upgradeReaders.sha256 });
  const upgrade = vi.spyOn(productMaterialsApi, 'upgradeReaders');
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Analizar archivos pendientes con Uony' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Las condiciones de esta acción han cambiado.');
  expect(upgrade).not.toHaveBeenCalled();
});

it('no amplía la lectura si el servidor anterior no ofrece el texto verificable', async () => {
  vi.mocked(productMaterialsApi.controlConsent).mockRejectedValue(new ApiError(404, { detail: 'Not Found' }));
  const upgrade = vi.spyOn(productMaterialsApi, 'upgradeReaders');
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Analizar archivos pendientes con Uony' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Recarga la página para revisar las condiciones');
  expect(upgrade).not.toHaveBeenCalled();
});

it('no convierte un fallo de permisos en una solicitud heredada', async () => {
  vi.mocked(productMaterialsApi.controlConsent).mockRejectedValue(new ApiError(403, { message: 'Acceso no permitido.' }));
  const upgrade = vi.spyOn(productMaterialsApi, 'upgradeReaders');
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Analizar archivos pendientes con Uony' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Acceso no permitido.');
  expect(upgrade).not.toHaveBeenCalled();
});

it('no degrada un intento versionado a POST antiguo si un servidor devuelve 404', async () => {
  vi.mocked(productMaterialsApi.controlConsent)
    .mockResolvedValueOnce({ version: MATERIAL_CONTROL_CONSENT.upgradeReaders.version,
      text: materialControlConsentText('upgradeReaders'), sha256: MATERIAL_CONTROL_CONSENT.upgradeReaders.sha256 })
    .mockRejectedValueOnce(new ApiError(404, { detail: 'Not Found' }));
  const upgrade = vi.spyOn(productMaterialsApi, 'upgradeReaders').mockRejectedValueOnce(new ApiError(503, { message: 'Respuesta no recibida.' }));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Analizar archivos pendientes con Uony' }));
  await screen.findByText('Respuesta no recibida.');
  fireEvent.click(screen.getByRole('button', { name: 'Analizar archivos pendientes con Uony' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('El servicio de análisis se está actualizando.');
  expect(upgrade).toHaveBeenCalledTimes(1);
});

it('no repite una ampliación completada por otra vista', async () => {
  const upgrade = vi.spyOn(productMaterialsApi, 'upgradeReaders');
  mount();
  const button = await screen.findByRole('button', { name: 'Analizar archivos pendientes con Uony' });
  vi.mocked(productMaterialsApi.latest).mockResolvedValue({ job: { ...ready, readerUpgradeAvailable: false } });
  fireEvent.click(button);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Analizar archivos pendientes con Uony' })).not.toBeInTheDocument());
  expect(upgrade).not.toHaveBeenCalled();
});

it('descarta resultados tardíos de otra identidad', async () => {
  let finish: (value: ProductMaterials) => void = () => {};
  vi.spyOn(productMaterialsApi, 'upgradeReaders').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const client = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Analizar archivos pendientes con Uony' }));
  await waitFor(() => expect(productMaterialsApi.upgradeReaders).toHaveBeenCalled());
  account = 'two@example.test';
  act(() => window.dispatchEvent(new Event('uonify:identity-changed')));
  await act(async () => finish({ job: queued }));
  expect(client.getQueryData(['product-drive-materials', 'one@example.test', 'BASIC'])).toEqual({ job: ready, product: { sku: 'BASIC', revision: 3 } });
});

it('advierte cobertura parcial aunque todos los fragmentos estén analizados', () => {
  render(<MaterialAnalysisProgress job={{ ...ready, sources: [{ id: 's', name: 'pack.pdf', mimeType: 'application/pdf', status: 'analyzed', readingCoverage: { complete: false, pages: 2 } }] }} />);
  expect(screen.getByText('Hay archivos con cobertura parcial u observaciones. Consulta su detalle; los descartes registrados no equivalen a datos que debas completar.')).toBeVisible();
});

it('explica geometría nominal, texturas ausentes y fórmula sin valor guardado', () => {
  render(<MaterialReadingDetails source={{ id: 's', name: 'tower.blend', status: 'analyzed', mimeType: 'application/x-blender', readingCoverage: {
    native: true, complete: false, objects: 54, scenes: 1, materials: 9, nominalGeometry: true, externalTextures: 2,
    visualPreviewGenerated: false, formulaCells: 5, missingFormulaValues: 2, uncertainFormulaValues: 3,
  } }} />);
  expect(screen.getByText(/no son medidas de una muestra física/)).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Sobre las medidas del diseño' }));
  expect(screen.getByText(/no son medidas de una muestra física/)).toBeVisible();
  expect(screen.getByText(/2 texturas externas sin cargar/)).toBeVisible();
  expect(screen.getByText(/2 fórmulas sin valor guardado/)).toBeVisible();
  expect(screen.getByText(/no se ejecutan macros ni se recalcula el libro/)).toBeVisible();
});

it('ofrece alternativa para documentos cifrados desde el mismo chat', () => {
  render(<MaterialReadingDetails source={{ id: 's', name: 'protected.pdf', status: 'error', mimeType: 'application/pdf', reason: 'Documento cifrado' }} />);
  expect(screen.getByText(/copia sin contraseña/)).toBeVisible();
  expect(screen.getByText(/continuar el análisis en este mismo chat/)).toBeVisible();
});

it('muestra ubicación legible sin coordenadas internas y aclara el alcance bajo demanda', () => {
  render(<MaterialEvidenceLocation evidence={{ sourceId: 's', locator: 'Página 2 · Código', excerpt: '8435833200006', method: 'barcode', structureValid: true, region: {
    page: 2, bbox: [100, 200, 350, 400], coordinateSpace: 'pixels', width: 1200, height: 1800, origin: 'top-left',
  } }} />);
  expect(screen.getByText('Código de barras decodificado')).toBeVisible();
  expect(screen.getByText('Página 2 del documento original.')).toBeVisible();
  expect(screen.queryByText(/Región 100, 200, 350, 400/)).not.toBeInTheDocument();
  expect(screen.getByText('Formato del código válido.')).toBeVisible();
  expect(screen.getByText('Esta comprobación no verifica a quién pertenece el código.')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Sobre esta comprobación' }));
  expect(screen.getByText('Esta comprobación no verifica a quién pertenece el código.')).toBeVisible();
});

it('codifica SKU e identificador al ampliar lectores', async () => {
  vi.restoreAllMocks();
  const post = vi.spyOn(api, 'post').mockResolvedValue({ job: queued });
  await productMaterialsApi.upgradeReaders('A B', 'id/path', { requestId: 'req', revision: 3 });
  expect(post).toHaveBeenCalledWith('/products/A%20B/materials/jobs/id%2Fpath/upgrade-readers', { requestId: 'req', revision: 3 }, { signal: undefined });
});

it('presenta OCR de baja confianza y códigos del decodificador sin confundirlos con titularidad', () => {
  render(<MaterialReadingDetails source={{ id: 's', name: 'pack.png', mimeType: 'image/png', status: 'analyzed', readingCoverage: {
    complete: true, ocr: { engine: 'tesseract', units: 1, seconds: 2, externalCalls: 0, lowConfidenceLines: 7 },
    visualUnits: [{ locator: 'Imagen 1', detailRegions: 3, status: 'read' }],
    barcodes: [{ value: '8435833200006', format: 'EAN-13', structureValid: true, decoded: true }],
  } }} />);
  expect(screen.getByText(/7 líneas reconocidas con baja confianza/)).toBeVisible();
  expect(screen.getByText('1 código de barras leído.')).toBeVisible();
  fireEvent.click(screen.getByText('Códigos encontrados'));
  expect(screen.getByText('EAN-13: 8435833200006 · estructura válida')).toBeVisible();
  expect(screen.getByText(/1 vistas o páginas localizadas · 3 ampliaciones/)).toBeVisible();
});

it('conserva la fórmula y distingue su error de un resultado vigente', () => {
  render(<MaterialEvidenceLocation evidence={{ sourceId: 's', locator: 'Hoja!fila 2', excerpt: 'Peso', formulaEvidence: [
    { locator: 'Hoja!B2', rowLocator: 'Hoja!fila 2', formula: '=A2/0', cachedValue: '#DIV/0!', cacheStatus: 'cached_error', freshness: 'unknown', executed: false },
  ] }} />);
  fireEvent.click(screen.getByText('Fórmula y valor guardado'));
  expect(screen.getByText('Hoja!B2 · =A2/0')).toBeVisible();
  expect(screen.getByText('Resultado guardado con error: #DIV/0!. La fórmula no se ha ejecutado.')).toBeVisible();
});


it('permite consultar un extracto nominal del archivo 3D sin abandonar el chat', () => {
  render(<MaterialReadingDetails source={{ id: 's', name: 'tower.blend', mimeType: 'application/x-blender', status: 'analyzed',
    readingCoverage: { native: true, complete: true, nominalGeometry: true },
    excerpts: [{ locator: 'Blender · Escena · Unidades', text: 'Sistema métrico, escala: 1' }],
  }} />);
  fireEvent.click(screen.getByText('Extracto del archivo 3D'));
  expect(screen.getByText('Sistema métrico, escala: 1')).toBeVisible();
  expect(screen.getByText(/Primeros registros del diseño/)).toBeVisible();
});


it('no afirma lectura visual por metadatos OCR vacíos de un JSON', () => {
  render(<MaterialReadingDetails source={{ id: 's', name: 'ficha.json', mimeType: 'application/json', status: 'analyzed', readingCoverage: {
    complete: true, ocr: { engine: 'tesseract', units: 0, seconds: 0, externalCalls: 0, lowConfidenceLines: 0 }, visualUnits: [], barcodes: [],
  } }} />);
  expect(screen.queryByText(/Lectura visual combinada/)).not.toBeInTheDocument();
  expect(screen.queryByText(/códigos de barras decodificados/)).not.toBeInTheDocument();
});

it('distingue tablas extraídas de tablas localizadas sin filas y páginas de texto nativo', () => {
  render(<MaterialReadingDetails source={{ id: 's', name: 'ficha.pdf', mimeType: 'application/pdf', status: 'analyzed', readingCoverage: {
    complete: true, ocr: { engine: 'tesseract', units: 0, seconds: 0, externalCalls: 0, lowConfidenceLines: 0 },
    visualUnits: [{ locator: 'Página 1', status: 'native_text' }],
    tables: [{ locator: 'Página 1 · Tabla 1', rows: 4, status: 'read' }, { locator: 'Página 2 · Tabla 1', rows: 0, status: 'visual_review' }],
  } }} />);
  expect(screen.queryByText(/Lectura visual combinada/)).not.toBeInTheDocument();
  expect(screen.getByText('1 tabla con sus filas y ubicación conservadas.')).toBeVisible();
  expect(screen.getByText(/1 tabla sin filas estructuradas/)).toBeVisible();
});
