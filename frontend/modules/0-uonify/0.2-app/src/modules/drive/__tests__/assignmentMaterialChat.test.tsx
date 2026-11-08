import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { driveApi } from '../api/driveApi';
import { productIntakesApi, type ProductIntake } from '../api/productIntakes';
import { productMaterialsApi, type MaterialAnalysisJob } from '../api/productMaterials';
import { IntakeDriveAnalysis } from '../components/IntakeDriveAnalysis';
import { MATERIAL_START_CONSENT_SHA256, MATERIAL_START_CONSENT_TEXT,
  MATERIAL_START_CONSENT_VERSION } from '../model/materialAnalysisConsent';

const account = 'basic@example.test';
const threadId = 'basic-thread';
const intakeId = '11111111-1111-4111-8111-111111111111';
const assignmentId = '22222222-2222-4222-8222-222222222222';
const productId = '33333333-3333-4333-8333-333333333333';
const folderId = '1234567890_basic';
const job: MaterialAnalysisJob = { id: '44444444-4444-4444-8444-444444444444', sku: 'BASIC', revision: 2,
  status: 'ready', folderId, folderName: 'Basic Mini Bricks', processed: 1, total: 1,
  sources: [], proposals: [], warnings: [] };
const intake: ProductIntake = { id: intakeId, threadId, revision: 3, status: 'linked',
  folder: { id: folderId, name: 'Basic Mini Bricks' }, product: { sku: 'BASIC', revision: 2 } };
const state = vi.hoisted(() => ({ account: 'basic@example.test', active: true }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => state.account }));
vi.mock('@/shared/pim', () => ({ hasProductEdits: () => false, notifyProductChanges: vi.fn() }));
vi.mock('../components/DriveConnectionSettings', () => ({ DriveConnectionSettings: () => <div>Conectar Drive</div> }));

let focus: Record<string, unknown> | null;
let started: MaterialAnalysisJob | null;
let causal: boolean;
let post: ReturnType<typeof vi.spyOn>;

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><IntakeDriveAnalysis account={account} threadId={threadId}
    id={intakeId} revision={1} isCurrent={() => state.active} onReview={() => true} /></QueryClientProvider>);
  return client;
}

async function analyze() {
  fireEvent.change(await screen.findByLabelText('Carpeta con los materiales del producto'),
    { target: { value: folderId } });
  fireEvent.click(screen.getByRole('button', { name: 'Analizar carpeta con Uony' }));
}

beforeEach(() => {
  state.account = account; state.active = true;
  focus = { id: assignmentId, productId: null, intakeId };
  started = null; causal = false;
  vi.spyOn(driveApi, 'state').mockResolvedValue({ connection: { status: 'connected' }, available: true, accessAllowed: true });
  vi.spyOn(productIntakesApi, 'get').mockResolvedValue(intake);
  vi.spyOn(productMaterialsApi, 'latest').mockImplementation(async () =>
    ({ job: started, product: { sku: 'BASIC', revision: 2 } }));
  vi.spyOn(productMaterialsApi, 'job').mockImplementation(async () => ({ job }));
  vi.spyOn(productMaterialsApi, 'startConsent').mockResolvedValue({ version: MATERIAL_START_CONSENT_VERSION,
    text: MATERIAL_START_CONSENT_TEXT, sha256: MATERIAL_START_CONSENT_SHA256 });
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === `/uony/threads/${threadId}/assignment-focus`) return { focus: { version: 1, current: focus } };
    if (path === '/products/BASIC/preparation') return { product: { id: productId, sku: 'BASIC', revision: 2 } };
    if (path === `/uony/threads/${threadId}/assignment-return`) return {
      resolution: 'focused', focusVersion: 1, moreAvailable: false,
      assignments: [{ assignment: { id: assignmentId, label: 'Basic Mini Bricks', status: 'pending',
        nextStep: 'review_result', version: 2 }, product: { id: productId, name: 'Basic Mini Bricks', revision: 2 },
      assignmentWork: causal && started ? { id: started.id, kind: 'materials', status: started.status,
        revision: 2, currentRevision: true, scope: 'started_for_assignment' } : null,
      relatedProductWork: !causal && started ? { id: started.id, kind: 'materials', status: started.status,
        scope: 'linked_product_current_revision' } : null }],
    };
    throw new Error(`GET inesperado: ${path}`);
  });
  post = vi.spyOn(api, 'post').mockImplementation(async path => {
    started = job;
    causal = path === `/uony/assignments/${assignmentId}/materials/jobs`;
    return causal ? { job, assignmentId, assignmentWorkScope: 'started_for_assignment' } : { job };
  });
});
afterEach(() => vi.restoreAllMocks());

it('Basic iniciado desde la tarjeta del chat conserva recibo y figura en assignmentWork', async () => {
  const client = mount();
  const returnKey = ['uony-assignment-return', account, threadId, 0];
  client.setQueryData(returnKey, { assignments: [] });
  await analyze();
  await waitFor(() => expect(post).toHaveBeenCalledOnce());
  await waitFor(() => expect(client.getQueryState(returnKey)?.isInvalidated).toBe(true));
  expect(post.mock.calls[0][0]).toBe(`/uony/assignments/${assignmentId}/materials/jobs`);
  expect(post.mock.calls[0][1]).toMatchObject({ sku: 'BASIC', folderId, revision: 2,
    requestId: expect.any(String), consentVersion: MATERIAL_START_CONSENT_VERSION,
    consentText: MATERIAL_START_CONSENT_TEXT, consentSha256: MATERIAL_START_CONSENT_SHA256 });
  const view = await api.get<{ assignments: Array<{ assignmentWork: unknown; relatedProductWork: unknown }> }>(
    `/uony/threads/${threadId}/assignment-return`);
  expect(view.assignments[0].assignmentWork).toMatchObject({ id: job.id, scope: 'started_for_assignment' });
  expect(view.assignments[0].relatedProductWork).toBeNull();
});

it('sin foco válido inicia por la ruta genérica y el retorno no atribuye el trabajo', async () => {
  focus = null;
  mount(); await analyze();
  await waitFor(() => expect(post).toHaveBeenCalledOnce());
  expect(post.mock.calls[0][0]).toBe('/products/BASIC/materials/jobs');
  expect(post.mock.calls[0][1]).not.toHaveProperty('assignmentId');
  const view = await api.get<{ assignments: Array<{ assignmentWork: unknown; relatedProductWork: unknown }> }>(
    `/uony/threads/${threadId}/assignment-return`);
  expect(view.assignments[0].assignmentWork).toBeNull();
  expect(view.assignments[0].relatedProductWork).toMatchObject({ id: job.id,
    scope: 'linked_product_current_revision' });
});

it.each([
  ['otro intake', { id: assignmentId, productId: null, intakeId: '55555555-5555-4555-8555-555555555555' }],
  ['otra ficha', { id: assignmentId, productId: '55555555-5555-4555-8555-555555555555', intakeId }],
])('bloquea Basic si el foco señala %s', async (_label, otherFocus) => {
  focus = otherFocus;
  mount(); await analyze();
  expect(await screen.findByRole('alert')).toHaveTextContent('El encargo enfocado no coincide');
  expect(post).not.toHaveBeenCalled();
});

it('bloquea un intake que ahora señala otra carpeta', async () => {
  vi.mocked(productIntakesApi.get).mockResolvedValue({ ...intake,
    folder: { id: 'otro_folder', name: 'Otra carpeta' } });
  mount(); await analyze();
  expect(await screen.findByRole('alert')).toHaveTextContent('El encargo enfocado no coincide');
  expect(post).not.toHaveBeenCalled();
});

it('bloquea un foco presente que todavía carece de ficha e intake', async () => {
  focus = { id: assignmentId, productId: null, intakeId: null };
  mount(); await analyze();
  expect(await screen.findByRole('alert')).toHaveTextContent('El encargo enfocado no coincide');
  expect(post).not.toHaveBeenCalled();
});

it('no inicia una ruta genérica si falla la consulta del foco', async () => {
  vi.mocked(api.get).mockRejectedValueOnce(new ApiError(503, { message: 'No se pudo consultar el foco.' }));
  mount(); await analyze();
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo consultar el foco.');
  expect(post).not.toHaveBeenCalled();
});

it.each(['account', 'thread'])('no inicia al perder %s antes de confirmar', async kind => {
  mount();
  await screen.findByLabelText('Carpeta con los materiales del producto');
  if (kind === 'account') state.account = 'other@example.test';
  else state.active = false;
  await analyze();
  expect(post).not.toHaveBeenCalled();
});

it('un POST contextual incierto reenvía el mismo encargo, requestId y recibo aunque cambie el foco', async () => {
  post.mockRejectedValueOnce(new ApiError(503, { message: 'Consulta el resultado.' }));
  mount(); await analyze();
  await screen.findByText('Consulta el resultado.');
  focus = null;
  fireEvent.click(screen.getByRole('button', { name: 'Analizar carpeta con Uony' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  expect(post.mock.calls[1][0]).toBe(post.mock.calls[0][0]);
  expect(post.mock.calls[1][1]).toEqual(post.mock.calls[0][1]);
});

it('un conflicto contextual no se degrada a la ruta genérica', async () => {
  post.mockRejectedValue(new ApiError(409, { error: 'assignment_material_existing',
    message: 'Hay un análisis anterior.' }));
  mount(); await analyze();
  await screen.findByText('Hay un análisis anterior.');
  fireEvent.click(screen.getByRole('button', { name: 'Analizar carpeta con Uony' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  expect(post.mock.calls[0][0]).toBe(`/uony/assignments/${assignmentId}/materials/jobs`);
  expect(post.mock.calls[1][0]).toBe(`/uony/assignments/${assignmentId}/materials/jobs`);
  expect(post.mock.calls[1][1]).toEqual(post.mock.calls[0][1]);
});
