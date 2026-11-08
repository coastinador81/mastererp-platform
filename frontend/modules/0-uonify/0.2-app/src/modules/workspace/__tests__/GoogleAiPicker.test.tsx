import { useRef } from 'react';
import { render,screen,waitFor,within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { GoogleAiPicker } from '../components/composer/GoogleAiPicker';
import { useGooglePreferences } from '../hooks/googlePreferences';
import { useComposerStore } from '../hooks/composerStore';
import { setUi } from '../hooks/uiStore';
import { useWorkspaceStore } from '../hooks/workspaceStore';
const activation = vi.hoisted(() => vi.fn());
vi.mock('@/modules/auth',()=>({currentAccountEmail:()=> 'picker@example.test',useSession:()=>({user:{email:'picker@example.test'}}),openConversationActivation:activation}));
function Picker(){const form=useRef<HTMLFormElement>(null);return <form ref={form}><GoogleAiPicker form={form}/></form>;}
it('guarda niveles reales y conserva la selección si falla el guardado',async()=>{
  const user=userEvent.setup();
  useComposerStore.setState({picker:null,status:''});setUi({pendingReply:null});
  useGooglePreferences.setState({account:null,data:null,saving:false});
  vi.spyOn(api,'get').mockResolvedValue({models:[{id:'gemini-3.5-flash',label:'Gemini 3.5 Flash',short:'Flash',detail:'Trabajo habitual',efforts:['low','medium','high']}],efforts:[{id:'low',label:'Bajo'},{id:'medium',label:'Medio'},{id:'high',label:'Alto'}],preferences:{model:'auto',effort:'medium'},autoPolicy:'Auto'});
  const put=vi.spyOn(api,'put').mockResolvedValue({model:'auto',effort:'high'});
  render(<QueryClientProvider client={new QueryClient()}><Picker/></QueryClientProvider>);
  const selector=await screen.findByRole('button',{name:'Modelo: Auto. Razonamiento: Medio. Ajustar IA'});
  await waitFor(()=>expect(selector).toBeEnabled());
  expect(selector).toHaveTextContent('Auto · Medio');
  expect(screen.getAllByRole('button',{name:/Ajustar IA$/})).toHaveLength(1);
  await user.click(selector);
  const menu=screen.getByRole('menu');
  expect(within(menu).getByRole('group',{name:'Modelo de Google'})).toBeInTheDocument();
  const reasoning=within(menu).getByRole('group',{name:'Razonamiento'});
  expect(screen.queryByRole('menuitemradio',{name:/Ultra/})).not.toBeInTheDocument();
  await user.click(within(reasoning).getByRole('menuitemradio',{name:/^Alto/}));
  await waitFor(()=>expect(put).toHaveBeenCalledWith('/uony/preferences',{model:'auto',effort:'high'}));
  await waitFor(()=>expect(useGooglePreferences.getState().data?.preferences.effort).toBe('high'));
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  // Maqueta aprobada por el dueño (22-10-2026): nada bajo la caja; Uony lo dice en la conversación.
  const thread=useWorkspaceStore.getState().createThread({title:'Nueva conversación',service:null,view:'default'});
  useWorkspaceStore.getState().setActiveThread(thread.id);
  put.mockRejectedValueOnce(new Error('No se pudo guardar'));
  await user.click(screen.getByRole('button',{name:'Respuesta ágil: alternar razonamiento bajo y medio'}));
  const said=()=>useWorkspaceStore.getState().threads.find(item=>item.id===thread.id)?.messages.at(-1);
  await waitFor(()=>expect(said()?.text).toBe('No he podido guardar el cambio de IA. Sigo con Auto · Alto; puedes volver a elegirlo cuando quieras.'));
  expect(said()?.role).toBe('assistant');
  expect(useComposerStore.getState().status).toBe('');
  expect(useGooglePreferences.getState().data?.preferences.effort).toBe('high');
  vi.restoreAllMocks();
});

it('sin modelos abre la preparación en el chat sin modal, navegación ni envío al modelo', async () => {
  const { workspaceRefs } = await import('../hooks/uiStore');
  const navigate = vi.fn(); workspaceRefs.navigate = navigate;
  useGooglePreferences.setState({ account: null, data: null, saving: false });
  vi.spyOn(api, 'get').mockImplementation(async path => (path === '/uony/options' ? { models: [], efforts: [], preferences: { model: 'auto', effort: 'medium' }, autoPolicy: '' } : {connection:{status:'disconnected'},available:true,accessAllowed:true}) as never);
  const post = vi.spyOn(api, 'post');
  useComposerStore.setState({draft:'Continuar con mi producto'});
  render(<QueryClientProvider client={new QueryClient()}><Picker /></QueryClientProvider>);
  const setup = await screen.findByRole('button', { name: 'Configurar IA en esta conversación' });
  expect(screen.queryByText('Modelos por comprobar')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Ajustar IA/ })).not.toBeInTheDocument();
  await userEvent.click(setup);
  expect(activation).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(navigate).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
  expect(useComposerStore.getState().draft).toBe('Continuar con mi producto');
  vi.restoreAllMocks();
});

it('si la selección anterior no está comprobada ofrece elegir la IA disponible sin repetir su configuración', async () => {
  useGooglePreferences.setState({ account: null, data: null, saving: false });
  vi.spyOn(api, 'get').mockResolvedValue({ models: [{ id: 'gemini-3.5-flash', label: 'Flash', short: 'Flash', detail: '', efforts: ['medium'] }],
    efforts: [{ id: 'medium', label: 'Medio' }], preferences: { model: 'gemini-3.1-pro-preview', effort: 'high' }, autoPolicy: '' });
  const put = vi.spyOn(api, 'put').mockResolvedValue({ model: 'gemini-3.5-flash', effort: 'medium' });
  render(<QueryClientProvider client={new QueryClient()}><Picker /></QueryClientProvider>);
  await userEvent.click(await screen.findByRole('button', { name: /^Modelo: Elige tu IA\. Razonamiento: Alto\. Ajustar IA$/ }));
  await userEvent.click(within(screen.getByRole('group',{name:'Modelo de Google'})).getByRole('menuitemradio', { name: /^Flash/ }));
  await waitFor(() => expect(put).toHaveBeenCalledWith('/uony/preferences', { model: 'gemini-3.5-flash', effort: 'medium' }));
  expect(screen.queryByRole('button', { name: 'Configurar IA en esta conversación' })).not.toBeInTheDocument();
  vi.restoreAllMocks();
});

it('el selector único se cierra con Escape y Tab sin cambiar las preferencias', async () => {
  const user = userEvent.setup();
  useGooglePreferences.setState({ account: null, data: null, saving: false });
  useComposerStore.setState({ picker: null, status: '' });
  vi.spyOn(api, 'get').mockResolvedValue({ models: [{ id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', short: 'Flash', detail: '', efforts: ['low', 'medium', 'high'] }],
    efforts: [{ id: 'low', label: 'Bajo' }, { id: 'medium', label: 'Medio' }, { id: 'high', label: 'Alto' }], preferences: { model: 'auto', effort: 'medium' }, autoPolicy: 'Auto' });
  const put = vi.spyOn(api, 'put');
  render(<QueryClientProvider client={new QueryClient()}><Picker/></QueryClientProvider>);
  const selector = await screen.findByRole('button', { name: 'Modelo: Auto. Razonamiento: Medio. Ajustar IA' });
  await waitFor(() => expect(selector).toBeEnabled());
  await user.click(selector);
  expect(screen.getByRole('menu')).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(selector).toHaveFocus();
  await user.click(selector);
  await user.keyboard('{Tab}');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(put).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
