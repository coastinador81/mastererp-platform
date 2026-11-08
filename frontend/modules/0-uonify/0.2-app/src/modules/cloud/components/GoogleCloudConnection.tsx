import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '@/shared/api/client';
import { useOwnedRequest } from '@/shared/hooks';
import { currentAccountEmail } from '@/modules/auth';
import '../styles/connection.css';
import { GoogleAccountRule } from './GoogleAccountRule';
import { useCloudWindow } from '../hooks/useCloudWindow';

type Check = 'enabled' | 'missing' | 'unknown';
interface Connection {
  status: 'disconnected' | 'connected' | 'reauthorize' | 'account_mismatch';
  email?: string;
  projectId?: string | null;
  projectName?: string | null;
  checks?: { billing: Check; vertex: Check; permissions: Check; credits: 'unverified'; ready: boolean } | null;
}
interface State { connection: Connection; available: boolean; accessAllowed: boolean }
interface Project { id: string; name: string }
const label = { enabled: 'Comprobado', missing: 'Por configurar', unknown: 'No se ha podido comprobar' };

interface Props { account: string; onBusyChange?: (busy: boolean) => void }
export function GoogleCloudConnection(props: Props) {
  return <AccountGoogleCloudConnection key={props.account} {...props} />;
}

function AccountGoogleCloudConnection({ account, onBusyChange }: Props) {
  const owner = useOwnedRequest(account, currentAccountEmail);
  const state = useQuery({ queryKey: ['google-cloud', account], queryFn: ({ signal }) => owner.read(inner => api.get<State>('/connections/google-cloud', { signal: inner }), signal), retry: false, staleTime: 0 });
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const run = async (action: (task: NonNullable<ReturnType<typeof owner.begin>>) => Promise<void>) => {
    if (busy) return;
    const task = owner.begin(); if (!task) return;
    setBusy(true); setMessage('');
    try { await action(task); } catch (error) { if (task.valid()) setMessage(errorMessage(error)); }
    finally { if (task.valid()) setBusy(false); task.finish(); }
  };
  const googleWindow = useCloudWindow(async mode => {
    const task = owner.begin(); if (!task) return;
    try {
      const refreshed = await state.refetch({ throwOnError: true }); task.check();
      setProjects([]); setLoaded(false); setSelected('');
      if (mode === 'billing' && refreshed.data?.connection.status === 'connected' && refreshed.data.accessAllowed) {
        const result = await api.get<{ projects: Project[] }>('/connections/google-cloud/projects', { signal: task.signal }); task.check();
        setProjects(result.projects); setLoaded(true);
      }
    } finally { task.finish(); }
  });
  useEffect(() => { onBusyChange?.(busy || !!googleWindow.pending); }, [busy, googleWindow.pending, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  if (state.isPending) return <p role="status">Recuperando tus herramientas…</p>;
  if (state.isError) return <section className="cld-connect"><p>No hemos podido recuperar tu conexión con Google.</p><button className="uon-onboard-back" onClick={() => void state.refetch()}>Reintentar</button></section>;
  const { connection, accessAllowed, available } = state.data;
  const load = () => run(async task => {
    const result = await api.get<{ projects: Project[] }>('/connections/google-cloud/projects', { signal: task.signal }); task.check();
    setProjects(result.projects); setLoaded(true); setSelected(connection.projectId ?? '');
  });
  const save = () => run(async task => {
    await api.put('/connections/google-cloud/project', { projectId: selected }, { signal: task.signal }); task.check();
    await state.refetch({ throwOnError: true }); task.check();
    setMessage('Proyecto guardado. Revisa las comprobaciones antes de continuar.');
  });
  const disconnect = () => run(async task => {
    await api.delete('/connections/google-cloud', { signal: task.signal }); task.check();
    setProjects([]); setLoaded(false); setSelected(''); setConfirmDisconnect(false);
    await state.refetch({ throwOnError: true }); task.check();
    setMessage('Uonify ha eliminado esta conexión. Tu trabajo sigue guardado. Puedes retirar también el permiso desde tu cuenta de Google.');
  });
  const returned = new URLSearchParams(window.location.search).get('cloud');
  const connected = connection.status === 'connected';
  const disabled = !!googleWindow.pending || busy || !accessAllowed;
  const empty = loaded && projects.length === 0;
  return <section className="cld-connect" aria-label="Conexión con Google Cloud">
    <p className="cld-intro">Conecta Google para preparar tus imágenes y contenido con Gemini y Vertex AI.</p>
    <GoogleAccountRule account={account} />
    {!accessAllowed && <p role="status">Necesitas una prueba o suscripción vigente de Uonify para utilizar esta conexión.</p>}
    {returned && returned !== 'return' && !connected && <p role="status">{returned === 'account_mismatch' ? 'La cuenta elegida no coincide con tu sesión de Uonify. Autoriza la cuenta indicada arriba.' : 'La autorización no se ha completado. Puedes volver a conectar tu cuenta.'}</p>}
    <div className="cld-account-row">
      <span className="cld-step" aria-hidden="true">{connected ? '✓' : '1'}</span>
      <div><strong>{connected ? 'Cuenta de Google conectada' : 'Conecta tu cuenta de Google'}</strong><p>{connected ? connection.email : account}</p></div>
      {connected && <span className="cld-badge">Conectada</span>}
    </div>
    {googleWindow.pending ? <div className="cld-window" role="region" aria-label="Continuar con Google">
      <span className="cld-window-icon" aria-hidden="true">↗</span>
      <h3>Seguimos aquí, en Uonify</h3>
      <p role="status">{googleWindow.pending.mode === 'authorization' ? 'Completa la conexión en la ventana de Google. Al terminar, seguiremos automáticamente desde aquí.' : 'Completa la configuración en la ventana de Google. Cuando termines, comprobaremos tu cuenta.'}</p>
      <div className="cld-actions"><button className="uon-onboard-back" onClick={googleWindow.focus}>Ver ventana de Google</button>
      <button className="uon-profile-submit" onClick={() => void googleWindow.resume()}>{googleWindow.pending.mode === 'billing' ? 'Ya he terminado · comprobar cuenta' : 'He cerrado la ventana · reintentar'}</button></div>
    </div> : !connected ? <div className="cld-primary-action">
      <button className="uon-profile-submit" disabled={disabled || !available} onClick={() => void googleWindow.open('authorization')}>{connection.status === 'reauthorize' ? 'Volver a autorizar Google' : 'Conectar Google Cloud'}</button>
      <small>Google se abrirá en una ventana. Tu progreso permanece aquí.</small>
    </div> : <div className="cld-project-card">
      <header><span className="cld-step" aria-hidden="true">2</span><div><h3>{connection.checks?.ready ? 'Proyecto comprobado' : empty ? 'Prepara Google Cloud' : 'Elige tu proyecto'}</h3><p>{empty ? 'Todavía no encontramos un proyecto. Completa el alta en Google y después lo comprobaremos aquí.' : connection.projectId ? 'Este proyecto se utilizará para los servicios de Google.' : 'Es el espacio de Google donde se gestionarán tus recursos y su consumo.'}</p></div></header>
      {connection.projectId && <p className="cld-project-name"><strong>{connection.projectName}</strong><span>{connection.projectId}</span></p>}
      {connection.checks && <dl className="cld-checks">{(['billing','vertex','permissions'] as const).map(key => <div key={key}><dt>{key === 'billing' ? 'Facturación de Google' : key === 'vertex' ? 'Vertex AI' : 'Permisos de uso'}</dt><dd>{label[connection.checks![key]]}</dd></div>)}</dl>}
      {loaded && projects.length > 0 && <><label className="cld-project-label" htmlFor="cld-project">Proyecto de Google Cloud</label>
        <select id="cld-project" value={selected} disabled={disabled} onChange={event => setSelected(event.target.value)}><option value="">Elige un proyecto</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name} · {project.id}</option>)}</select></>}
      <div className="cld-actions">
        {empty ? <button className="uon-profile-submit" disabled={disabled} onClick={() => void googleWindow.open('billing', account)}>Configurar Google Cloud ↗</button> : loaded ? <button className="uon-profile-submit" disabled={disabled || !selected} onClick={() => void save()}>{busy ? 'Comprobando…' : 'Guardar y comprobar proyecto'}</button> : <button className="uon-profile-submit" disabled={disabled} onClick={() => void load()}>{busy ? 'Consultando…' : connection.projectId ? 'Revisar proyectos' : 'Ver mis proyectos'}</button>}
        {loaded && <button className="uon-onboard-back" disabled={disabled} onClick={() => void load()}>{busy ? 'Consultando…' : 'Actualizar proyectos'}</button>}
      </div>
      {empty && <small>Se abre en una ventana de Google. Uonify seguirá abierta.</small>}
    </div>}
    {(message || googleWindow.message) && <p className="cld-feedback" role="status">{message || googleWindow.message}</p>}
    <details className="cld-details"><summary>Consumo y créditos de Google</summary>
      <p>Tu suscripción da acceso a Uonify. El consumo de Google se gestiona y factura en tu propia cuenta, según sus condiciones.</p>
      <p>Los créditos promocionales dependen de las condiciones y elegibilidad de Google. Conectar una cuenta no confirma su saldo ni garantiza generación gratuita.</p>
      <p>Los permisos, las condiciones y los datos de pago se gestionan directamente en Google.</p>
      <button className="uon-onboard-back" disabled={disabled} onClick={() => void googleWindow.open('billing', account)}>Revisar facturación y créditos ↗</button>
    </details>
    {connected && <details className="cld-details"><summary>Gestionar la conexión</summary>
      {confirmDisconnect && <p>¿Desconectar Google de Uonify? Tu trabajo se conserva. Esto no cancela la facturación de Google.</p>}
      <button className="uon-onboard-back" disabled={disabled} onClick={() => confirmDisconnect ? void disconnect() : setConfirmDisconnect(true)}>{confirmDisconnect ? 'Confirmar desconexión' : 'Desconectar Google'}</button>
      {confirmDisconnect && <button className="uon-onboard-back" disabled={disabled} onClick={() => setConfirmDisconnect(false)}>Mantener conexión</button>}
    </details>}
  </section>;
}
