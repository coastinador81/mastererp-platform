import { act,render,waitFor } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { useLiveHistory,sendLivePrompt,useConversationRecovery,startIncidentResolution,prepareProductRequirements } from '../hooks/liveConversation';
import { useWorkspaceStore,resetWorkspaceStore } from '../hooks/workspaceStore';
import { useComposerStore } from '../hooks/composerStore';
import { useGooglePreferences } from '../hooks/googlePreferences';
import { setUi, useUiStore } from '../hooks/uiStore';
vi.mock('@/shared/api/config',()=>({USE_MOCKS:false,API_BASE:'/api'}));
const identity = vi.hoisted(() => ({ account: 'one@example.test' }));
vi.mock('@/modules/auth',()=>({currentAccountEmail:()=>identity.account,useSession:()=>({status:'ready',user:{email:identity.account}})}));
function History(){useLiveHistory();return null;}
beforeEach(() => {
  identity.account = 'one@example.test';
  resetWorkspaceStore();setUi({pendingReply:null});
  useComposerStore.setState({draft:'',status:''});
  useConversationRecovery.setState({recovery:null});
  useGooglePreferences.setState({account:identity.account,saving:false,data:{models:[],efforts:[],preferences:{model:'auto',effort:'medium'},autoPolicy:''}});
});
afterEach(()=>vi.restoreAllMocks());
it('espera la respuesta real y restaura texto en un fallo',async()=>{
  useGooglePreferences.setState({account:'one@example.test',saving:false,data:{models:[],efforts:[],preferences:{model:'auto',effort:'medium'},autoPolicy:''}});
  resetWorkspaceStore();setUi({pendingReply:null});
  vi.spyOn(api,'get').mockResolvedValue({threads:[]});
  const post=vi.spyOn(api,'post').mockResolvedValue({reply:'Respuesta real del proveedor'});
  render(<QueryClientProvider client={new QueryClient()}><History/></QueryClientProvider>);
  await waitFor(()=>expect(sendLivePrompt('Hola')).toBe(true));
  await waitFor(()=>expect(useWorkspaceStore.getState().threads[0].messages.at(-1)?.text).toBe('Respuesta real del proveedor'));
  expect(post).toHaveBeenCalledOnce();
  expect(post.mock.calls[0][1]).toMatchObject({model:'auto',effort:'medium'});
  post.mockRejectedValueOnce(new Error('Google no disponible'));
  expect(sendLivePrompt('Segundo mensaje')).toBe(true);
  // Lote 6: Uony lo dice en la conversación; el compositor recupera el texto sin mostrar el error.
  await waitFor(()=>expect(useWorkspaceStore.getState().threads[0].messages.at(-1)).toEqual({role:'assistant',text:'Google no disponible',model:'uonify-guide',requestStatus:'error'}));
  expect(useComposerStore.getState().status).toBe('');
  expect(useComposerStore.getState().draft).toBe('Segundo mensaje');
  expect(useWorkspaceStore.getState().threads[0].messages.map(message=>message.text)).toEqual(['Hola','Respuesta real del proveedor','Google no disponible']);
});

it('guarda la tarjeta real, la recupera del historial y mantiene el proyecto y la selección de hilo',async()=>{
  const actions = [{provider:'amazon',action:'manage'}];
  const saved = {id:'thread-saved',title:'Amazon',projectId:'project-1',service:'producto',view:'detail',messages:[{role:'assistant',text:'Aquí tienes tu conexión.',connectionActions:actions}]};
  vi.spyOn(api,'get').mockResolvedValue({threads:[saved]});
  const post = vi.spyOn(api,'post').mockResolvedValue({reply:'Gestiona Amazon aquí.',connectionActions:actions});
  render(<QueryClientProvider client={new QueryClient()}><History/></QueryClientProvider>);
  await waitFor(()=>expect(useWorkspaceStore.getState().threads[0]?.messages[0].connectionActions).toEqual(actions));
  expect(useWorkspaceStore.getState()).toMatchObject({activeThreadId:'thread-saved',activeProjectId:'project-1'});
  expect(sendLivePrompt('Quiero reconectar Amazon')).toBe(true);
  await waitFor(()=>expect(useWorkspaceStore.getState().threads[0].messages.at(-1)?.connectionActions).toEqual(actions));
  expect(post).toHaveBeenCalledOnce();
  expect(post.mock.calls[0]).toEqual(expect.arrayContaining(['/uony/messages',expect.objectContaining({threadId:'thread-saved',projectId:'project-1'})]));
  expect(useWorkspaceStore.getState().threads[0]).toMatchObject({service:'producto',view:'detail'});
});

it('descarta propuestas de otro hilo del historial y del POST sin ejecutar una decisión', async () => {
  const proposal = { proposalId: '11111111-1111-4111-8111-111111111111',
    threadId: 'foreign-thread', action: 'create', targetSku: 'BASIC-01', targetProductId: null,
    baseRevision: null, payload: { sku: 'BASIC-01', name: 'Basic Mini Bricks' },
    threadLinkVersion: 0, proposalHash: 'a'.repeat(64), status: 'pending',
    createdAt: '2026-10-17T10:00:00+00:00' };
  vi.spyOn(api, 'get').mockResolvedValue({ threads: [{ id: 'basic-thread', title: 'Basic',
    service: null, view: 'default', messages: [{ role: 'assistant', text: 'Revisa Basic.', productProposal: proposal }] }] });
  const post = vi.spyOn(api, 'post').mockResolvedValue({ reply: 'Esta respuesta llegó para otro hilo.', productProposal: proposal });
  render(<QueryClientProvider client={new QueryClient()}><History /></QueryClientProvider>);
  await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  expect(useWorkspaceStore.getState().threads[0].messages[0].productProposal).toBeUndefined();
  expect(post).not.toHaveBeenCalled();
  expect(sendLivePrompt('Seguimos con Basic')).toBe(true);
  await waitFor(() => expect(useWorkspaceStore.getState().threads[0].messages.at(-1)?.role).toBe('assistant'));
  expect(useWorkspaceStore.getState().threads[0].messages.at(-1)?.productProposal).toBeUndefined();
  expect(post).toHaveBeenCalledOnce();
});

it('no incorpora una respuesta de conexión pendiente de otra cuenta',async()=>{
  let finish: (value: unknown) => void = () => {};
  vi.spyOn(api,'get').mockResolvedValue({threads:[]});
  vi.spyOn(api,'post').mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const view = render(<QueryClientProvider client={new QueryClient()}><History/></QueryClientProvider>);
  await waitFor(()=>expect(sendLivePrompt('Conecta Amazon')).toBe(true));
  act(()=>{
    identity.account='two@example.test';
    window.dispatchEvent(new Event('uonify:identity-changed'));
  });
  view.rerender(<QueryClientProvider client={new QueryClient()}><History/></QueryClientProvider>);
  await act(async()=>{finish({reply:'Conexión de la primera cuenta',connectionActions:[{provider:'amazon',action:'manage'}]});});
  expect(useWorkspaceStore.getState().threads).toEqual([]);
  expect(useComposerStore.getState().draft).not.toBe('Conecta Amazon');
});

it('hidrata formularios válidos y rechaza controles ajenos o malformados del historial y respuestas',async()=>{
  const form = {id:'form-1',title:'Tu producto',fields:[{id:'name',label:'Nombre',type:'text',required:true}]};
  vi.spyOn(api,'get').mockResolvedValue({threads:[{id:'t',title:'T',service:null,view:'default',messages:[
    {role:'assistant',text:'Cuéntame',conversationForm:form}, {role:'user',text:'Hola',conversationForm:form},
  ]}]});
  vi.spyOn(api,'post').mockResolvedValue({reply:'Pregunta válida',conversationForm:form});
  render(<QueryClientProvider client={new QueryClient()}><History/></QueryClientProvider>);
  await waitFor(()=>expect(useWorkspaceStore.getState().threads[0]?.messages[0].conversationForm).toEqual(form));
  expect(useWorkspaceStore.getState().threads[0].messages[1].conversationForm).toBeUndefined();
  expect(sendLivePrompt('Seguimos')).toBe(true);
  await waitFor(()=>expect(useWorkspaceStore.getState().threads[0].messages.at(-1)?.conversationForm).toEqual(form));
});

it('los formularios conservan el borrador y notifican fallo sin copiar su respuesta al compositor',async()=>{
  vi.spyOn(api,'get').mockResolvedValue({threads:[]});
  vi.spyOn(api,'post').mockRejectedValue(new Error('No disponible'));
  render(<QueryClientProvider client={new QueryClient()}><History/></QueryClientProvider>);
  useComposerStore.setState({draft:'Mi siguiente pregunta'});
  const onSettled=vi.fn();
  await waitFor(()=>expect(sendLivePrompt('Nombre: Juego',{preserveDraft:true,onSettled})).toBe(true));
  await waitFor(()=>expect(onSettled).toHaveBeenCalledWith(false,'No disponible'));
  expect(useComposerStore.getState().draft).toBe('Mi siguiente pregunta');
});

it('reanuda los requisitos mediante una acción explícita y conserva el borrador del usuario', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ threads: [{ id: 'requirements-thread', title: 'Lámpara', service: null, view: 'default', messages: [] }] });
  let finish: (result: unknown) => void = () => {};
  const post = vi.spyOn(api, 'post').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<QueryClientProvider client={new QueryClient()}><History /></QueryClientProvider>);
  useGooglePreferences.setState({ data: null, account: null });
  useComposerStore.setState({ draft: 'Mi siguiente idea' });
  await waitFor(() => expect(prepareProductRequirements('LAMP-2', { retry: true, acknowledgeUnknown: true })).toBe(true));
  await waitFor(() => expect(post).toHaveBeenCalledOnce());
  expect(post.mock.calls[0][1]).toMatchObject({ threadId: 'requirements-thread', model: 'auto', requirementsAction: { action: 'prepare', sku: 'LAMP-2', retry: true, acknowledgeUnknown: true } });
  expect(post.mock.calls[0][1]).not.toHaveProperty('formResponse');
  expect(useUiStore.getState().pendingReply).toMatchObject({ threadId: 'requirements-thread', requirements: {} });
  expect(useComposerStore.getState().draft).toBe('Mi siguiente idea');
  await act(async () => finish({ reply: 'Revisión en curso.', model: 'uonify-guide' }));
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
});

it('conserva el UUID y el contrato CAS de una revisión explícita vinculada al hilo', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ threads: [{ id: 'basic-thread', title: 'Basic', projectId: 'stable-project', service: null, view: 'default', messages: [] }] });
  const post = vi.spyOn(api, 'post').mockResolvedValue({ reply: 'Revisión recuperada.', model: 'uonify-guide' });
  render(<QueryClientProvider client={new QueryClient()}><History /></QueryClientProvider>);
  const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const action = { retry: true, acknowledgeUnknown: true, expectedRevision: 11, expectedLinkVersion: 2,
    expectedReasoningId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as string,
    expectedReasoningStatus: 'unknown' as const, expectedSourceFingerprint: 'c'.repeat(64),
    requestId, expectedThreadId: 'basic-thread', expectedProjectId: 'stable-project' };
  await waitFor(() => expect(prepareProductRequirements('BASIC', action)).toBe(true));
  await waitFor(() => expect(post).toHaveBeenCalledOnce());
  const body = post.mock.calls[0][1];
  expect(body).toMatchObject({ requestId, threadId: 'basic-thread', projectId: 'stable-project', requirementsAction: {
    action: 'prepare', sku: 'BASIC', retry: true, acknowledgeUnknown: true,
    expectedRevision: 11, expectedLinkVersion: 2,
    expectedReasoningId: action.expectedReasoningId, expectedReasoningStatus: 'unknown',
    expectedSourceFingerprint: action.expectedSourceFingerprint,
  } });
  expect(body).not.toHaveProperty('productContext');
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  expect(prepareProductRequirements('BASIC', action)).toBe(true);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  expect(post.mock.calls[1][1]).toEqual(body);
  useWorkspaceStore.getState().setActiveThread('other-thread');
  expect(prepareProductRequirements('BASIC', action)).toBe(false);
  expect(post).toHaveBeenCalledTimes(2);
});

it('no crea un hilo nuevo si el hilo CAS desapareció o cambió de proyecto', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ threads: [{ id: 'basic-thread', title: 'Basic', projectId: 'stable-project',
    service: null, view: 'default', messages: [] }] });
  const post = vi.spyOn(api, 'post');
  render(<QueryClientProvider client={new QueryClient()}><History /></QueryClientProvider>);
  await waitFor(() => expect(useWorkspaceStore.getState().activeThreadId).toBe('basic-thread'));
  const action = { retry: true, expectedThreadId: 'basic-thread', expectedProjectId: 'otro-proyecto' };
  expect(prepareProductRequirements('BASIC', action)).toBe(false);
  expect(post).not.toHaveBeenCalled();
  useWorkspaceStore.setState({ threads: [] });
  expect(prepareProductRequirements('BASIC', { ...action, expectedProjectId: 'stable-project' })).toBe(false);
  expect(useWorkspaceStore.getState().threads).toEqual([]);
  expect(post).not.toHaveBeenCalled();
});

it('inicia una incidencia en el hilo actual sin depender del modelo y conserva el borrador', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ threads: [{ id: 'incident-thread', title: 'Mi trabajo', service: null, view: 'default', messages: [] }] });
  const post = vi.spyOn(api, 'post').mockResolvedValue({ reply: 'Revisa el peso.', model: 'uonify-guide' });
  render(<QueryClientProvider client={new QueryClient()}><History /></QueryClientProvider>);
  useGooglePreferences.setState({ data: null, account: null });
  useComposerStore.setState({ draft: 'Siguiente idea' });
  await waitFor(() => expect(startIncidentResolution('11111111-1111-4111-8111-111111111111')).toBe(true));
  await waitFor(() => expect(post).toHaveBeenCalledOnce());
  expect(post.mock.calls[0][1]).toMatchObject({ threadId: 'incident-thread', model: 'auto', incidentAction: { incidentId: '11111111-1111-4111-8111-111111111111', action: 'start' } });
  expect(useComposerStore.getState().draft).toBe('Siguiente idea');
});

it('descarta una respuesta anterior aunque se vuelva a iniciar sesión con el mismo correo',async()=>{
  let finish: (value: unknown) => void = () => {};
  vi.spyOn(api,'get').mockResolvedValue({threads:[]});
  vi.spyOn(api,'post').mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  render(<QueryClientProvider client={new QueryClient()}><History/></QueryClientProvider>);
  const onSettled=vi.fn();
  await waitFor(()=>expect(sendLivePrompt('Pregunta antigua',{preserveDraft:true,onSettled})).toBe(true));
  act(()=>{ window.dispatchEvent(new Event('uonify:identity-changed')); });
  await act(async()=>{ finish({reply:'Respuesta de sesión anterior'}); });
  expect(useWorkspaceStore.getState().threads).toEqual([]);
  expect(onSettled).not.toHaveBeenCalled();
});

it.each(['google_required','reauthorize'])('presenta recuperación %s sin fabricar un mensaje del asistente ni perder el borrador',async(error)=>{
  vi.spyOn(api,'get').mockResolvedValue({threads:[]});
  vi.spyOn(api,'post').mockRejectedValue(new ApiError(error==='google_required'?409:503,{error,message:'Revisa tu conexión con Google.',connectionActions:[{provider:'cloud',action:'manage'},{provider:'external',action:'execute'}]}));
  render(<QueryClientProvider client={new QueryClient()}><History/></QueryClientProvider>);
  await waitFor(()=>expect(sendLivePrompt('Mi producto')).toBe(true));
  await waitFor(()=>expect(useConversationRecovery.getState().recovery).toEqual({account:identity.account,threadId:null,message:'Revisa tu conexión con Google.',actions:[{provider:'cloud',action:'manage'}]}));
  expect(useWorkspaceStore.getState().threads).toEqual([]);
  expect(useComposerStore.getState().draft).toBe('Mi producto');
  act(()=>{window.dispatchEvent(new Event('uonify:identity-changed'));});
  expect(useConversationRecovery.getState().recovery).toBeNull();
});
