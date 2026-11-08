import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { ProductDriveAnalysis } from '../components/ProductDriveAnalysis';
import { productMaterialsApi, type MaterialAnalysisJob, type ProductMaterials } from '../api/productMaterials';
import { driveApi } from '../api/driveApi';
import { MATERIAL_CONTROL_CONSENT, materialControlConsentText } from '../model/materialControlConsent';

let account = 'one@example.test';
let dirty = false;
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => account }));
vi.mock('@/shared/pim', () => ({ hasProductEdits: () => dirty }));
const ready: MaterialAnalysisJob = { id: 'repair-test', sku: 'BASIC', revision: 3, status: 'ready', folderId: 'folder1234567', folderName: 'Basic Mini Bricks', processed: 1, total: 1, sources: [], proposals: [], warnings: [], repairAvailable: true };
const queued: MaterialAnalysisJob = { ...ready, status: 'queued', operation: 'repair_evidence', repairAvailable: false };
const action = 'Resolver lectura pendiente con Uony';
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ProductDriveAnalysis account={account} sku="BASIC" revision={1} onReview={vi.fn(() => true)} /></QueryClientProvider>);
  return client;
}
beforeEach(() => {
  account = 'one@example.test'; dirty = false;
  vi.spyOn(driveApi, 'state').mockResolvedValue({ connection: { status: 'connected' }, available: true, accessAllowed: true });
  vi.spyOn(productMaterialsApi, 'latest').mockResolvedValue({ job: ready, product: { sku: 'BASIC', revision: 3 } });
  vi.spyOn(productMaterialsApi, 'job').mockResolvedValue({ job: ready });
  vi.spyOn(productMaterialsApi, 'controlConsent').mockResolvedValue({
    version: MATERIAL_CONTROL_CONSENT.repairEvidence.version,
    text: materialControlConsentText('repairEvidence'),
    sha256: MATERIAL_CONTROL_CONSENT.repairEvidence.sha256 });
});
afterEach(() => vi.restoreAllMocks());

it('repara solo tras el clic desde el chat con revisión actual y conserva el trabajo', async () => {
  const repair = vi.spyOn(productMaterialsApi, 'repairEvidence').mockResolvedValue({ job: queued });
  const client = mount();
  const button = await screen.findByRole('button', { name: action });
  expect(repair).not.toHaveBeenCalled();
  expect(screen.getByText(/Puede requerir nuevas llamadas de análisis/)).toBeVisible();
  vi.mocked(productMaterialsApi.latest).mockResolvedValue({ job: ready, product: { sku: 'BASIC', revision: 5 } });
  fireEvent.click(button);
  await screen.findByText(/Uony está resolviendo las comprobaciones pendientes/);
  expect(repair).toHaveBeenCalledWith('BASIC', ready.id, { requestId: expect.any(String), revision: 5,
    consentVersion: MATERIAL_CONTROL_CONSENT.repairEvidence.version,
    consentText: materialControlConsentText('repairEvidence'),
    consentSha256: MATERIAL_CONTROL_CONSENT.repairEvidence.sha256 }, expect.any(AbortSignal));
  expect(client.getQueryData(['product-drive-materials', account, 'BASIC'])).toEqual({ job: queued, product: { sku: 'BASIC', revision: 5 } });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('reutiliza el identificador si se pierde la respuesta de reparación', async () => {
  const repair = vi.spyOn(productMaterialsApi, 'repairEvidence').mockRejectedValueOnce(new ApiError(503, { message: 'Respuesta no recibida.' })).mockResolvedValue({ job: queued });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: action }));
  await screen.findByText('Respuesta no recibida.');
  fireEvent.click(screen.getByRole('button', { name: action }));
  await screen.findByText(/Uony está resolviendo las comprobaciones pendientes/);
  expect(repair.mock.calls[0][2]).toEqual(repair.mock.calls[1][2]);
});

it('bloquea texto de consentimiento distinto antes de reparar', async () => {
  vi.mocked(productMaterialsApi.controlConsent).mockResolvedValue({
    version: MATERIAL_CONTROL_CONSENT.repairEvidence.version,
    text: materialControlConsentText('repairEvidence'), sha256: '0'.repeat(64) });
  const repair = vi.spyOn(productMaterialsApi, 'repairEvidence');
  mount();
  fireEvent.click(await screen.findByRole('button', { name: action }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Las condiciones de esta acción han cambiado.');
  expect(repair).not.toHaveBeenCalled();
});

it('no repara si no se puede comprobar el consentimiento actual', async () => {
  vi.mocked(productMaterialsApi.controlConsent).mockRejectedValue(new ApiError(503, { message: 'Servicio no disponible.' }));
  const repair = vi.spyOn(productMaterialsApi, 'repairEvidence');
  mount();
  fireEvent.click(await screen.findByRole('button', { name: action }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Servicio no disponible.');
  expect(repair).not.toHaveBeenCalled();
});

it('no repara si el servidor antiguo no ofrece el texto verificable', async () => {
  vi.mocked(productMaterialsApi.controlConsent).mockRejectedValue(new ApiError(404, { detail: 'Not Found' }));
  const repair = vi.spyOn(productMaterialsApi, 'repairEvidence');
  mount();
  fireEvent.click(await screen.findByRole('button', { name: action }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Recarga la página para revisar las condiciones');
  expect(repair).not.toHaveBeenCalled();
});

it.each([{ ...ready, repairAvailable: false }, queued])('no repite una reparación ya aplicada en otra vista', async fresh => {
  const repair = vi.spyOn(productMaterialsApi, 'repairEvidence');
  mount();
  const button = await screen.findByRole('button', { name: action });
  vi.mocked(productMaterialsApi.latest).mockResolvedValue({ job: fresh });
  fireEvent.click(button);
  await waitFor(() => expect(screen.queryByRole('button', { name: action })).not.toBeInTheDocument());
  expect(repair).not.toHaveBeenCalled();
});

it('protege las ediciones manuales antes de reparar', async () => {
  dirty = true;
  const repair = vi.spyOn(productMaterialsApi, 'repairEvidence');
  mount();
  fireEvent.click(await screen.findByRole('button', { name: action }));
  expect(await screen.findByText('Guarda los cambios de la ficha antes de reanudar el análisis.')).toBeVisible();
  expect(repair).not.toHaveBeenCalled();
});

it('no aplica una respuesta tardía de otra cuenta', async () => {
  let finish: (value: ProductMaterials) => void = () => {};
  vi.spyOn(productMaterialsApi, 'repairEvidence').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const client = mount();
  fireEvent.click(await screen.findByRole('button', { name: action }));
  await waitFor(() => expect(productMaterialsApi.repairEvidence).toHaveBeenCalled());
  account = 'two@example.test';
  act(() => window.dispatchEvent(new Event('uonify:identity-changed')));
  await act(async () => finish({ job: queued }));
  expect(client.getQueryData(['product-drive-materials', 'one@example.test', 'BASIC'])).toEqual({ job: ready, product: { sku: 'BASIC', revision: 3 } });
});

it('no permite reparar con conexión ausente o consumo sin confirmar', async () => {
  vi.mocked(productMaterialsApi.latest).mockResolvedValue({ job: { ...ready, pauseReason: 'consumption_unknown' } });
  vi.mocked(productMaterialsApi.job).mockResolvedValue({ job: { ...ready, pauseReason: 'consumption_unknown' } });
  mount();
  expect(await screen.findByRole('button', { name: action })).toBeDisabled();
});

it('codifica la ruta de reparación y conserva el cuerpo del control', async () => {
  vi.restoreAllMocks();
  const post = vi.spyOn(api, 'post').mockResolvedValue({ job: queued });
  await productMaterialsApi.repairEvidence('A B', 'id/path', { requestId: 'req', revision: 3 });
  expect(post).toHaveBeenCalledWith('/products/A%20B/materials/jobs/id%2Fpath/repair-evidence', { requestId: 'req', revision: 3 }, { signal: undefined });
});
