import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { ProductDriveAnalysis } from '../components/ProductDriveAnalysis';
import { MaterialAnalysisResults } from '../components/MaterialAnalysisResults';
import { productMaterialsApi, type MaterialAnalysisJob, type MaterialFact, type ProductMaterials } from '../api/productMaterials';
import { driveApi } from '../api/driveApi';

let account = 'one@example.test';
let dirty = false;
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => account }));
vi.mock('@/shared/pim', () => ({ hasProductEdits: () => dirty }));
const source = { id: 'technical', name: 'Ficha técnica.pdf', mimeType: 'application/pdf', status: 'analyzed' };
const brand: MaterialFact = {
  id: 'brand', field: 'brand', canonicalField: 'brand', label: 'Marca', value: 'UONIFY', normalizedValue: 'uonify', scope: 'product', channel: 'product',
  claimType: 'declared', supportStatus: 'supported', supportReasons: [], reviewable: true, originalValues: ['Uonify', 'UONIFY'], sourceProposalIds: ['p1', 'p2'], status: 'proposed',
  evidence: [{ sourceId: source.id, locator: 'Página 1', excerpt: 'Marca: UONIFY', fragmentId: 'fragment1', sourceVersion: 'version1', supportStatus: 'supported' }],
};
const raw: MaterialAnalysisJob = { id: '11111111-1111-4111-8111-111111111111', sku: 'BASIC', revision: 2, status: 'ready', folderId: 'folder1234567', folderName: 'Basic Mini Bricks', processed: 1, total: 1, sources: [source], proposals: [brand], warnings: [] };
const ready: MaterialAnalysisJob = { ...raw, facts: { version: 1, proposals: [brand], rejections: [] } };
const queued: MaterialAnalysisJob = { ...raw, status: 'queued', operation: 'reconcile', stage: 'reconciling' };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onReview = vi.fn(() => true);
  render(<QueryClientProvider client={client}><ProductDriveAnalysis account={account} sku="BASIC" revision={1} onReview={onReview} /></QueryClientProvider>);
  return { client, onReview };
}
beforeEach(() => {
  account = 'one@example.test'; dirty = false;
  vi.spyOn(driveApi, 'state').mockResolvedValue({ connection: { status: 'connected' }, available: true, accessAllowed: true });
  vi.spyOn(productMaterialsApi, 'latest').mockResolvedValue({ job: raw, product: { sku: 'BASIC', revision: 2 } });
  vi.spyOn(productMaterialsApi, 'job').mockResolvedValue({ job: raw });
});
afterEach(() => vi.restoreAllMocks());

it('bloquea la confirmación de propuestas sin contrastar y solo inicia al solicitarlo', async () => {
  const reconcile = vi.spyOn(productMaterialsApi, 'reconcile').mockResolvedValue({ job: queued });
  const { client, onReview } = mount();
  const button = await screen.findByRole('button', { name: 'Verificar y unificar datos con Uony' });
  expect(reconcile).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Completar requisitos de Amazon con Uony' })).not.toBeInTheDocument();
  vi.mocked(productMaterialsApi.latest).mockResolvedValue({ job: raw, product: { sku: 'BASIC', revision: 5 } });
  fireEvent.click(button);
  await screen.findByRole('progressbar', { name: 'Comprobación de fuentes y datos' });
  expect(reconcile).toHaveBeenCalledWith('BASIC', raw.id, { requestId: expect.any(String), revision: 5 }, expect.any(AbortSignal));
  expect(client.getQueryData(['product-drive-materials', account, 'BASIC'])).toEqual({ job: queued, product: { sku: 'BASIC', revision: 5 } });
  expect(onReview).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('conserva la clave idempotente cuando la respuesta se pierde', async () => {
  const reconcile = vi.spyOn(productMaterialsApi, 'reconcile').mockRejectedValueOnce(new ApiError(503, { message: 'Respuesta no recibida.' })).mockResolvedValue({ job: ready });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Verificar y unificar datos con Uony' }));
  await screen.findByText('Respuesta no recibida.');
  fireEvent.click(screen.getByRole('button', { name: 'Verificar y unificar datos con Uony' }));
  await screen.findByRole('button', { name: 'Completar requisitos de Amazon con Uony' });
  expect(reconcile).toHaveBeenCalledTimes(2);
  expect(reconcile.mock.calls[0][2]).toEqual(reconcile.mock.calls[1][2]);
});

it('recupera una unificación ya completada sin repetir la petición', async () => {
  const reconcile = vi.spyOn(productMaterialsApi, 'reconcile');
  mount();
  await screen.findByRole('button', { name: 'Verificar y unificar datos con Uony' });
  vi.mocked(productMaterialsApi.latest).mockResolvedValue({ job: ready, product: { sku: 'BASIC', revision: 2 } });
  fireEvent.click(screen.getByRole('button', { name: 'Verificar y unificar datos con Uony' }));
  await screen.findByRole('button', { name: 'Completar requisitos de Amazon con Uony' });
  expect(reconcile).not.toHaveBeenCalled();
});

it('permite volver a comprobar fuentes consolidadas con revisión actual y conserva la clave del reintento', async () => {
  vi.mocked(productMaterialsApi.latest).mockResolvedValue({ job: ready, product: { sku: 'BASIC', revision: 5 } });
  vi.mocked(productMaterialsApi.job).mockResolvedValue({ job: ready });
  const reconcile = vi.spyOn(productMaterialsApi, 'reconcile').mockRejectedValueOnce(new ApiError(503, { message: 'Respuesta no recibida.' })).mockResolvedValue({ job: queued });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Volver a comprobar fuentes' }));
  await screen.findByText('Respuesta no recibida.');
  fireEvent.click(screen.getByRole('button', { name: 'Volver a comprobar fuentes' }));
  await screen.findByRole('progressbar', { name: 'Comprobación de fuentes y datos' });
  expect(reconcile).toHaveBeenCalledTimes(2);
  expect(reconcile.mock.calls[0][2]).toEqual(reconcile.mock.calls[1][2]);
  expect(reconcile.mock.calls[1][2]).toEqual({ requestId: expect.any(String), revision: 5 });
});

it.each([
  { status: 'paused' as const, pauseReason: 'source_changed' },
  { status: 'paused' as const, operation: 'reconcile' as const },
  { status: 'error' as const, error: { code: 'permission_denied', message: 'Se ha retirado el permiso de la fuente.' } },
  { status: 'error' as const, error: { code: 'reauthorize', message: 'Vuelve a autorizar Drive.' } },
])('protege la nueva comprobación si hay que resolver primero la continuidad (%j)', change => {
  const recheck = vi.fn();
  render(<MaterialAnalysisResults job={{ ...ready, ...change }} disabled={false} onReview={vi.fn()} onRecheck={recheck} />);
  const button = screen.getByRole('button', { name: 'Volver a comprobar fuentes' });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(recheck).not.toHaveBeenCalled();
});

it('protege una edición manual antes de iniciar la comprobación', async () => {
  dirty = true;
  const reconcile = vi.spyOn(productMaterialsApi, 'reconcile');
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Verificar y unificar datos con Uony' }));
  expect(await screen.findByText('Guarda los cambios de la ficha antes de contrastar sus materiales.')).toBeVisible();
  expect(reconcile).not.toHaveBeenCalled();
});

it('descarta una respuesta tardía si cambia la cuenta', async () => {
  let finish: (value: ProductMaterials) => void = () => {};
  vi.spyOn(productMaterialsApi, 'reconcile').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { client } = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Verificar y unificar datos con Uony' }));
  await waitFor(() => expect(productMaterialsApi.reconcile).toHaveBeenCalled());
  account = 'two@example.test';
  act(() => window.dispatchEvent(new Event('uonify:identity-changed')));
  await act(async () => finish({ job: ready }));
  expect(client.getQueryData(['product-drive-materials', 'one@example.test', 'BASIC'])).toEqual({ job: raw, product: { sku: 'BASIC', revision: 2 } });
});

it('agrupa alias y conflictos, conserva fuentes y separa producción, seguridad y referencias', () => {
  const ean = { ...brand, id: 'ean1', field: 'ean', canonicalField: 'ean', label: 'EAN', value: '8435833200006', normalizedValue: '8435833200006', sourceProposalIds: ['p3'], originalValues: ['8435833200006'], conflict: true, conflictGroup: 'ean-conflict', evidence: [{ sourceId: source.id, locator: 'Página 2', excerpt: 'EAN: 8435833200006' }] };
  const facts: MaterialFact[] = [brand, ean, { ...ean, id: 'ean2', value: '8435833200013', normalizedValue: '8435833200013', evidence: [{ sourceId: source.id, locator: 'Página 3', excerpt: 'EAN alternativo: 8435833200013' }] },
    { ...brand, id: 'render', field: 'resolution', canonicalField: 'resolution', label: 'Resolución del render', value: '2000 px', channel: 'production', claimType: 'nominal', reviewable: false },
    { ...brand, id: 'ce', field: 'ce', canonicalField: 'ce', label: 'Marcado CE', value: 'Visible', channel: 'safety', claimType: 'visual_observation', supportStatus: 'needs_review', supportReasons: [{ code: 'visual', message: 'Un símbolo visible no acredita una certificación.' }] },
    { ...brand, id: 'other', field: 'example', canonicalField: 'example', label: 'Ejemplo de otro producto', value: '77 piezas', channel: 'reference', reviewable: false },
  ];
  render(<MaterialAnalysisResults job={{ ...ready, facts: { version: 1, proposals: facts, rejections: [{ id: 'rejected1', label: 'Material', value: 'Haya', reason: 'La cita no identifica la especie de madera.', evidence: [{ sourceId: source.id, locator: 'Página 1', excerpt: 'Juego de madera' }] }] } }} disabled={false} onReview={vi.fn()} />);
  expect(screen.getByText('Uony aprovechará los datos de tus documentos y solo te preguntará por lo que no pueda completar para Amazon.')).toBeVisible();
  expect(screen.getByText('Datos del producto · 2')).toBeInTheDocument();
  expect(screen.getAllByRole('heading', { name: 'Marca', hidden: true })).toHaveLength(1);
  fireEvent.click(screen.getByText('Datos del producto · 2'));
  const conflict = within(screen.getByRole('region', { name: 'EAN' }));
  expect(conflict.getByText('8435833200006')).toBeVisible();
  expect(conflict.getByText('8435833200013')).toBeVisible();
  expect(conflict.getByText(/Uony los contrastará y te preguntará solo si necesita tu respuesta para completar Amazon/)).toBeVisible();
  expect(within(screen.getByRole('region', { name: 'Marca' })).getByText('Valores originales unificados · 2')).toBeVisible();
  fireEvent.click(screen.getByText('Seguridad y conformidad · 1'));
  expect(screen.getByText('Un símbolo visible no acredita una certificación.')).toBeVisible();
  expect(screen.getByText('Observación visual, por confirmar', { exact: false })).toBeVisible();
  expect(screen.getByText('Diseño y producción · 1')).toBeVisible();
  expect(screen.getByText('Referencias externas · 1')).toBeVisible();
  fireEvent.click(screen.getByText('Registro de propuestas no incorporadas · 1'));
  expect(screen.getByText('La cita no identifica la especie de madera.')).toBeVisible();
  expect(screen.getByText('Juego de madera')).toBeVisible();
});

it('no cuenta referencias y parámetros de producción como preguntas para la ficha', () => {
  render(<MaterialAnalysisResults job={{ ...ready, facts: { version: 1, proposals: [{ ...brand, channel: 'production', reviewable: false }], rejections: [] } }} disabled={false} onReview={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Completar requisitos de Amazon con Uony' })).toBeEnabled();
  expect(screen.queryByText(/datos propuestos para revisar/)).not.toBeInTheDocument();
});

it('distingue el rechazo inicial de una cita recuperada sin ocultar su motivo', () => {
  render(<MaterialAnalysisResults job={{ ...ready, facts: { ...ready.facts!, rejections: [{ id: 'r1', label: 'Marca', value: 'UONIFY', recovered: true, reason: 'La primera cita no identificaba la marca.' }] } }} disabled={false} onReview={vi.fn()} />);
  fireEvent.click(screen.getByText('Registro de propuestas no incorporadas · 1'));
  expect(screen.getByText('La primera cita no identificaba la marca.')).toBeVisible();
  expect(screen.getByText('Recuperado: se ha localizado otra cita que respalda el dato.')).toBeVisible();
});

it('no atribuye a una fuente el valor nuevo que ha escrito el cliente', () => {
  const edited = { ...brand, status: 'confirmed' as const, confirmedValue: 'Otra marca', confirmationOrigin: 'user_declared' as const, supportedValue: false };
  render(<MaterialAnalysisResults job={{ ...ready, facts: { ...ready.facts!, proposals: [edited] } }} disabled={false} onReview={vi.fn()} />);
  fireEvent.click(screen.getByText('Datos del producto · 1'));
  expect(screen.getByText('Otra marca')).toBeVisible();
  expect(screen.getByText('Declarado por ti al revisar; no acreditado por la fuente')).toBeVisible();
  expect(screen.getByText('Propuesta original: UONIFY. Las evidencias siguientes corresponden a esa propuesta.')).toBeVisible();
  expect(screen.queryByText('Respaldado por el texto de la fuente')).not.toBeInTheDocument();
});

it('permite revisar la unidad y el estado de una medida nominal en el mismo registro original', () => {
  const nominal: MaterialFact = { ...brand, id: 'length', field: 'length', canonicalField: 'length', label: 'Longitud de la pieza', value: '75 mm', claimType: 'nominal',
    evidence: [{ sourceId: source.id, locator: '$.piece.length.value', excerpt: '75', fragmentId: 'main-fragment', sourceVersion: 'source-v1', contextEvidence: [
      { sourceId: source.id, locator: '$.piece.length.unit', excerpt: 'mm', fragmentId: 'unit-fragment', sourceVersion: 'source-v1' },
      { sourceId: source.id, locator: '$.piece.length.status', excerpt: 'Diseño 3D nominal', fragmentId: 'status-fragment', sourceVersion: 'source-v1' },
      { sourceId: source.id, locator: '$.piece.length.note', excerpt: 'Medición física pendiente', fragmentId: 'note-fragment', sourceVersion: 'source-v1' },
    ] }],
  };
  render(<MaterialAnalysisResults job={{ ...ready, facts: { ...ready.facts!, proposals: [nominal] } }} disabled={false} onReview={vi.fn()} />);
  fireEvent.click(screen.getByText('Datos del producto · 1'));
  expect(screen.getByText('75 mm')).toBeVisible();
  expect(screen.getByText('75')).toBeVisible();
  expect(screen.getByText('Sin confirmar · Dato de diseño, sin medición física')).toBeVisible();
  fireEvent.click(screen.getByText('Contexto del dato · 3'));
  expect(screen.getByText('mm')).toBeVisible();
  expect(screen.getByText('Diseño 3D nominal')).toBeVisible();
  expect(screen.getByText('Medición física pendiente')).toBeVisible();
  expect(screen.queryByText(/status-fragment|source-v1|\$\.piece/)).not.toBeInTheDocument();
});

it.each([
  [`asset:${source.id}`, 'Recurso: Ficha técnica.pdf'],
  ['asset:unavailable-source-id', 'Recurso: Recurso de origen'],
  ['variant:Azul', 'Variante: Azul'],
])('identifica el recurso por su nombre y conserva las variantes (%s)', (scope, expected) => {
  render(<MaterialAnalysisResults job={{ ...ready, facts: { ...ready.facts!, proposals: [{ ...brand, scope }] } }} disabled={false} onReview={vi.fn()} />);
  fireEvent.click(screen.getByText('Datos del producto · 1'));
  expect(screen.getByText(`Sin confirmar · Dato declarado · ${expected}`)).toBeVisible();
  expect(screen.queryByText(/Variante: asset:/)).not.toBeInTheDocument();
  expect(screen.queryByText(/unavailable-source-id/)).not.toBeInTheDocument();
});

it.each([
  { facts: { ...ready.facts!, stale: true } },
  { status: 'paused' as const, operation: 'reconcile' as const },
  { status: 'error' as const, error: { code: 'permission_denied', message: 'Se ha retirado el permiso de la fuente.' } },
  { status: 'error' as const, error: { code: 'reauthorize', message: 'Vuelve a autorizar Drive.' } },
])('impide confirmar datos mientras su respaldo no esté vigente (%j)', change => {
  const review = vi.fn();
  render(<MaterialAnalysisResults job={{ ...ready, ...change }} disabled={false} onReview={review} />);
  const button = screen.getByRole('button', { name: 'Completar requisitos de Amazon con Uony' });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(review).not.toHaveBeenCalled();
});

it('explica los descartes históricos sin inventar causas ni ocultar los inválidos actuales', () => {
  render(<MaterialAnalysisResults job={{ ...ready, facts: { ...ready.facts!, historicalRejectionsWithoutCandidate: 111, rejections: [{ id: 'invalid', reason: 'La propuesta no tiene un formato válido.' }] } }} disabled={false} onReview={vi.fn()} />);
  fireEvent.click(screen.getByText('Registro de propuestas no incorporadas · 1'));
  expect(screen.getByText('El análisis anterior registró 111 descartes sin detalle. Conservamos ese registro; la verificación actual muestra sus propios motivos.')).toBeVisible();
  expect(screen.getByText('Propuesta sin formato válido')).toBeVisible();
  expect(screen.getByText('La propuesta no tiene un formato válido.')).toBeVisible();
});

it('codifica la ruta y mantiene el cuerpo de la comprobación', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({ job: queued });
  const body = { requestId: 'request', revision: 4 };
  await productMaterialsApi.reconcile('A B', 'id/unsafe', body);
  expect(post).toHaveBeenCalledWith('/products/A%20B/materials/jobs/id%2Funsafe/reconcile', body, { signal: undefined });
});
