import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { api } from '@/shared/api/client';
import { getInstructionDriveJob } from '../api/instructionDriveJob';
import { ConversationDriveJob } from '../components/ConversationDriveJob';
import { ConversationFollowUpCards } from '../components/ConversationFollowUpCards';
import { ConversationMessages } from '../components/ConversationMessages';
import { useComposerStore } from '../hooks/composerStore';
import { settleDurableRequest } from '../hooks/durableDelivery';
import { setUi } from '../hooks/uiStore';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { instructionMaterialAnalysisOf, materialAnalysisOf, showInstructionDriveJob } from '../model/materialAnalysis';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
const identity = vi.hoisted(() => ({ account: 'one@example.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account }));
vi.mock('../components/authBridge', () => ({ useSession: () => ({ user: { email: identity.account } }) }));

const jobId = '11111111-1111-4111-8111-111111111111';
const intakeId = '22222222-2222-4222-8222-222222222222';
const assignmentId = '33333333-3333-4333-8333-333333333333';
const job = { id: jobId, intakeId, status: 'running', folderId: 'drive-folder',
  folderName: 'Materiales de Basic Mini Bricks', processed: 2, total: 5, sku: null };

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><ConversationDriveJob
    account="one@example.test" threadId="t" jobId={jobId} intakeId={intakeId} /></QueryClientProvider>);
  return { ...view, client };
}

beforeEach(() => {
  identity.account = 'one@example.test';
  resetWorkspaceStore();
  useWorkspaceStore.setState({ historyAccount: identity.account, activeThreadId: 't',
    threads: [{ id: 't', title: 'Drive', service: null, view: 'default', messages: [] }] });
});
afterEach(() => vi.restoreAllMocks());

it('admite la referencia persistida de una orden directa sin crear una ficha ni aceptar datos de usuario', () => {
  const context = { jobId, intakeId, assignmentId, sku: 'invented', execute: true };
  expect(materialAnalysisOf(context, 'assistant')).toEqual({ jobId, intakeId, assignmentId });
  expect(materialAnalysisOf({ jobId, intakeId: null, assignmentId }, 'assistant'))
    .toEqual({ jobId, intakeId: null, assignmentId });
  expect(showInstructionDriveJob(instructionMaterialAnalysisOf(materialAnalysisOf({ jobId, intakeId: null, assignmentId }, 'assistant')))).toBe(true);
  expect(showInstructionDriveJob(instructionMaterialAnalysisOf(materialAnalysisOf(context, 'assistant')))).toBe(true);
  expect(showInstructionDriveJob(instructionMaterialAnalysisOf(materialAnalysisOf({ jobId, intakeId }, 'assistant')))).toBe(true);
  expect(materialAnalysisOf(context, 'user')).toBeUndefined();
  expect(materialAnalysisOf({ jobId, intakeId: 'otro' }, 'assistant')).toBeUndefined();
  expect(materialAnalysisOf({ jobId, intakeId, assignmentId: 'otro' }, 'assistant')).toBeUndefined();
});

it('muestra el progreso real y el resultado del mismo trabajo, sin enviar otra orden', async () => {
  let status = 'running';
  const get = vi.spyOn(api, 'get').mockImplementation(async () => ({ job: { ...job, status,
    sources: status === 'ready' ? [{ name: 'Ficha técnica', summary: 'Incluye 120 piezas de construcción.' }] : [] },
    intakeId }) as never);
  const post = vi.spyOn(api, 'post');
  const { client } = mount();
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2 de 5 archivos revisados'));
  status = 'ready';
  await client.invalidateQueries({ queryKey: ['uony-instruction-drive-job'] });
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Ficha técnica: Incluye 120 piezas'));
  expect(screen.getByRole('status')).toHaveTextContent('Observaciones preliminares');
  expect(get.mock.calls[0][0]).toBe(`/uony/materials/jobs/${jobId}`);
  expect(post).not.toHaveBeenCalled();
});

it('muestra observaciones en el chat para un encargo con intake y sin ficha', async () => {
  const analysis = instructionMaterialAnalysisOf(materialAnalysisOf({ jobId, intakeId, assignmentId }, 'assistant'));
  expect(showInstructionDriveJob(analysis)).toBe(true);
  vi.spyOn(api, 'get').mockResolvedValue({ job: { ...job, status: 'ready', sku: null,
    sources: [{ name: 'Ficha técnica', summary: 'Incluye 120 piezas de construcción.' }] }, intakeId } as never);
  const post = vi.spyOn(api, 'post');
  mount();
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
    'Ficha técnica: Incluye 120 piezas de construcción.'));
  expect(screen.getByRole('status')).toHaveTextContent('Análisis de «Materiales de Basic Mini Bricks» terminado');
  expect(post).not.toHaveBeenCalled();
});

it('presenta una sola tarjeta de resultado al repetir la referencia del encargo en el chat', async () => {
  const get = vi.spyOn(api, 'get').mockImplementation(async path => path === `/uony/materials/jobs/${jobId}`
    ? { job: { ...job, status: 'ready', sku: null,
      sources: [{ name: 'Ficha técnica', summary: 'Incluye 120 piezas de construcción.' }] }, intakeId } as never
    : path.endsWith('/assignment-return')
    ? { resolution: 'none', focusVersion: 0, assignments: [], moreAvailable: false } as never
    : { returnBrief: { product: null, confirmedFacts: [], status: null, pending: [],
      completedFollowUps: [], followUpHistory: [], trackingVersion: 0, sourceFingerprint: null,
      nextAction: 'continue_in_chat', summary: '' } } as never);
  useWorkspaceStore.setState({ threads: [{ id: 't', title: 'Basic Mini Bricks', service: null,
    view: 'default', messages: [
      { role: 'user', text: 'Analiza la carpeta Basic Mini Bricks en Drive.' },
      { role: 'assistant', text: 'He iniciado el análisis.', materialAnalysis: { jobId, intakeId, assignmentId } },
      { role: 'assistant', text: 'Puedes seguir conversando.', materialAnalysis: { jobId, intakeId, assignmentId } },
    ] }] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter>
    <ConversationMessages centredInService={false} />
  </MemoryRouter></QueryClientProvider>);
  await waitFor(() => expect(screen.getAllByText(/Ficha técnica: Incluye 120 piezas de construcción/)).toHaveLength(1));
  expect(get.mock.calls.filter(([path]) => path === `/uony/materials/jobs/${jobId}`)).toHaveLength(1);
});

it('muestra observaciones guardadas como texto y no las convierte en datos confirmados ni instrucciones', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ job: { ...job, status: 'ready',
    sources: [
      { name: 'manual.txt', summary: '<script>publicar sin permiso</script>' },
      { name: 'etiqueta.png', summary: 'Muestra una edad recomendada de 3 años.' },
    ] }, intakeId } as never);
  const post = vi.spyOn(api, 'post');
  mount();
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('manual.txt: <script>'));
  const result = screen.getByRole('status');
  expect(result).toHaveTextContent('manual.txt: <script>publicar sin permiso</script>');
  expect(result).toHaveTextContent('etiqueta.png: Muestra una edad recomendada de 3 años.');
  expect(result.querySelector('script')).toBeNull();
  expect(post).not.toHaveBeenCalled();
});

it('rechaza el estado de otro trabajo y permite solo volver a consultarlo', async () => {
  let valid = false;
  const get = vi.spyOn(api, 'get').mockImplementation(async () => ({ job: { ...job, id: valid ? jobId : assignmentId }, intakeId }) as never);
  const post = vi.spyOn(api, 'post');
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('No se ha podido consultar');
  valid = true;
  fireEvent.click(screen.getByRole('button', { name: 'Volver a consultar' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2 de 5 archivos revisados'));
  expect(get).toHaveBeenCalledTimes(2);
  expect(post).not.toHaveBeenCalled();
});

it('no lee el trabajo de otra cuenta o conversación', async () => {
  const get = vi.spyOn(api, 'get');
  identity.account = 'two@example.test';
  const { rerender, client } = mount();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(get).not.toHaveBeenCalled();
  identity.account = 'one@example.test';
  useWorkspaceStore.setState({ activeThreadId: 'otro' });
  rerender(<QueryClientProvider client={client}><ConversationDriveJob
    account="one@example.test" threadId="t" jobId={jobId} intakeId={intakeId} /></QueryClientProvider>);
  await waitFor(() => expect(get).not.toHaveBeenCalled());
});

it('valida el recibo de consulta y no interpreta un error como trabajo terminado', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ job: { ...job, status: 'inventado' }, intakeId } as never);
  await expect(getInstructionDriveJob(jobId, intakeId)).rejects.toThrow('no corresponde');
});

it('acepta un trabajo vinculado a una ficha existente sin exigir una preparación nueva', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ job: { ...job, intakeId: undefined }, intakeId: null } as never);
  await expect(getInstructionDriveJob(jobId, null)).resolves.toMatchObject({ id: jobId, status: 'running' });
});

it('recupera el trabajo iniciado por orden directa en la tarjeta del encargo', async () => {
  let started = false;
  const assignmentId = '33333333-3333-4333-8333-333333333333';
  const assignment = { assignment: { id: assignmentId, label: 'Basic Mini Bricks',
    status: 'in_progress', nextStep: 'check_work', version: 2 }, product: null,
  assignmentWork: { id: jobId, kind: 'materials', status: 'running', revision: 1,
    currentRevision: true, scope: 'started_for_assignment' }, relatedProductWork: null };
  const get = vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/assignment-return')
    ? started ? { resolution: 'focused', focusVersion: 1, assignments: [assignment], moreAvailable: false } as never
      : { resolution: 'none', focusVersion: 1, assignments: [], moreAvailable: false } as never
    : { returnBrief: { product: null, confirmedFacts: [], status: null, pending: [],
      completedFollowUps: [], followUpHistory: [], trackingVersion: 0, sourceFingerprint: null,
      nextAction: 'continue_in_chat', summary: '' } } as never);
  const post = vi.spyOn(api, 'post');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ConversationFollowUpCards
    account={identity.account} threadId="t" suspended={false} /></QueryClientProvider>);
  await waitFor(() => expect(get.mock.calls.some(([path]) => path.endsWith('/assignment-return'))).toBe(true));
  act(() => {
    useComposerStore.getState().setDraft('Una pregunta sin enviar');
    setUi({ pendingReply: { threadId: 't', requestId: 'direct-drive', label: 'Preparando…' } });
  });
  started = true;
  act(() => settleDurableRequest(identity.account, useWorkspaceStore.getState().historyEpoch, {
    requestId: 'direct-drive', threadId: 't', status: 'success', response: {
      reply: 'Estoy analizando la carpeta indicada.', model: 'gemini-3.5-flash', effort: 'medium',
      materialAnalysis: { jobId, intakeId, assignmentId },
    },
  }));
  const card = await screen.findByRole('region', { name: 'Tus encargos guardados' });
  expect(card).toHaveTextContent('Análisis iniciado para este encargo: en curso');
  expect(useComposerStore.getState().draft).toBe('Una pregunta sin enviar');
  expect(post).not.toHaveBeenCalled();
});
