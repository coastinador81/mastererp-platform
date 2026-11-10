import { Link } from 'react-router';
import { Icon } from '@/shared/ui';
import { useBlenderProduct } from '../hooks/useBlenderProduct';
import { BlenderJobResult, BlenderPreview, blenderJobError } from './BlenderJobResult';
import '../styles/blender.css';
import '../styles/blender-product.css';

interface Props { account: string; productId: string }

/** Trabajo 3D del producto actual; Nexus conserva conexión, permisos y uso. */
export function BlenderProductWorkspace({ account, productId }: Props) {
  const view = useBlenderProduct(account, productId);
  const { state, connected, access, busy, working, currentJob, preview } = view;
  const paired = state.data?.status === 'offline' || connected;
  const version = state.data?.blenderVersion?.trim();
  const disabled = !connected || !access || busy || working || state.isError;
  return <section className="bln-product" aria-label="Blender del producto">
    <div className={`bln-product-overview${preview ? ' has-preview' : ''}`}>
    {preview && <section className="pim-card bln-product-preview" aria-label="Última vista previa del producto"><h3>Última vista previa del producto</h3><BlenderPreview job={preview} account={account} /></section>}
    <section className="pim-card bln-product-connection" aria-label="Estado de Blender">
      <div className="bln-product-heading"><img src="/assets/brands/blender-logo.svg" alt="" /><div><h3>Blender local</h3><p>{state.isPending ? 'Comprobando tu equipo…' : state.isError ? 'No se puede comprobar la conexión' : connected ? 'Conectado' : paired ? 'Equipo sin conexión' : 'Sin conectar'}</p></div>
        <Link to="/espacio/nexus" className="pim-btn pim-btn-outline">Gestionar en Nexus</Link>
      </div>
      {state.isError ? <p role="alert">No hemos podido comprobar Blender. <button type="button" className="pim-btn pim-btn-outline" onClick={view.refresh}>Reintentar conexión</button></p> : <>
        {paired && <p className="pim-modelos3d-text">{state.data?.deviceName} · {version && version !== 'unknown' ? `Blender ${version}` : 'Versión por comprobar'}</p>}
        {!state.isPending && !connected && <p className="pim-modelos3d-text">{paired ? 'Abre Blender, inicia su complemento MCP y mantén abierto el conector de Uonify.' : 'Conecta tu Blender desde Nexus para trabajar con este producto.'}</p>}
        {state.data && !access && <p className="pim-modelos3d-text">Necesitas una prueba o suscripción vigente de Uonify para usar Blender.</p>}
      </>}
    </section>
    </div>
    <section className="bln-product-work" aria-label="Escena y vistas previas del producto">
      <div className="bln-product-heading"><div><h3>Escena y vistas previas</h3><p>La próxima tarea usa la escena abierta en Blender. Comprueba que corresponde a este producto.</p></div>
        <button type="button" className="pim-btn pim-btn-ghost pim-btn-icon" onClick={view.refresh} disabled={state.isFetching || view.job.isFetching} aria-label="Actualizar trabajo 3D" title="Actualizar trabajo 3D"><Icon name="refresh-cw" size={16} /></button>
      </div>
      {connected && state.data?.scene && <p className="bln-product-open-scene">Abierta en tu equipo: <strong>{state.data.scene.name}</strong>{state.data.scene.fileName ? ` · ${state.data.scene.fileName}` : ' · Sin guardar'}</p>}
      <div className="pim-modelos3d-actions-main">
        <button type="button" className="pim-btn pim-btn-primary" disabled={disabled || !state.data?.capabilities.includes('render_preview')} onClick={() => void view.run('preview')}><Icon name="image" size={16} />Preparar vista previa</button>
        <button type="button" className="pim-btn pim-btn-outline" disabled={disabled || !state.data?.capabilities.includes('inspect_scene')} onClick={() => void view.run('inspect')}>Consultar escena</button>
      </div>
      {view.message && <p role="alert" className="pim-modelos3d-text">{view.message}</p>}
      {currentJob && <BlenderJobResult job={currentJob} account={account} showPreview={false} />}
      {view.job.isError && <p role="alert">{blenderJobError(view.job.error)} <button type="button" className="pim-btn pim-btn-outline" onClick={() => void view.job.refetch()}>Actualizar tarea</button></p>}
      {!preview && <div className="pim-card pim-card-dashed pim-modelos3d-empty bln-product-empty"><Icon name="box" size={32} /><h3>Tu vista previa aparecerá aquí</h3><p className="pim-modelos3d-text">Las vistas previas que prepares desde esta ficha se guardarán en este producto.</p></div>}
    </section>
    <div className="pim-modelos3d-notes"><div className="pim-modelos3d-note"><Icon name="info" size={16} /><div><h4>Tu archivo permanece en Blender</h4><p>La consulta y la vista previa no guardan ni sustituyen tu archivo .blend. Cada resultado queda asociado a este producto.</p></div></div><div className="pim-modelos3d-note"><Icon name="box" size={16} /><div><h4>Con esta conexión</h4><p>Consulta de escena y vistas previas PNG de hasta 320 px. La edición de modelos, la exportación 3D y los renders de alta resolución se activan bajo solicitud.</p></div></div></div>
    <p className="pim-modelos3d-text bln-product-cost">Incluido en tu suscripción. Blender se ejecuta en tu ordenador. El consumo de IA sigue las condiciones de tu proveedor.</p>
  </section>;
}
