import React, {useEffect, useRef, useState} from 'react';
const API=window.location.origin==='https://finanzas-dev.uonify.com'?window.location.origin:'https://qx8nmypdhi.execute-api.us-west-1.amazonaws.com';
const messages={400:'Revisa los campos de la solicitud.',401:'Tu sesión ha caducado.',403:'Acceso denegado.',404:'El tercero no está disponible en esta empresa.',409:'Conflicto: la versión o el contenido ya cambió. Recarga el detalle antes de volver a editar.',503:'El servicio no está disponible. Puedes volver a intentarlo.'};
export default function Parties({workspace,capacity,path,navigate}) {
  const {tenant,company,context,request,denied}=workspace;
  const canWrite=context.permissions.includes('administration.parties.write');
  const label=capacity==='clientes'?'Clientes':'Proveedores';
  const base='/modulos/finanzas/administracion/'+capacity;
  const tail=path.slice(base.length).split('/').filter(Boolean), id=tail[0] && tail[0]!=='nuevo'?tail[0]:null;
  const create=tail[0]==='nuevo',edit=tail[1]==='editar';
  const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[saved,setSaved]=useState('');
  const [cursor,setCursor]=useState(''),[pages,setPages]=useState([]),[reload,setReload]=useState(0);
  const [code,setCode]=useState(''),[name,setName]=useState(''),[existing,setExisting]=useState(''),[busy,setBusy]=useState(false);
  const key=useRef(null), active=useRef(true), local=useRef(0);
  useEffect(()=>{active.current=true;return()=>{active.current=false;local.current++;};},[]);
  const endpoint=API+'/v1/administration/'+capacity;
  const headers={'X-MasterERP-Tenant-Id':tenant};
  useEffect(()=>{
    let live=true;setError('');setSaved('');setData(null);setCode('');setName('');setExisting('');key.current=null;
    if(create){setLoading(false);return()=>{live=false;};}
    setLoading(true);
    const query=new URLSearchParams({company_id:company,limit:'10',...(cursor?{after:cursor}:{})});
    request(endpoint+(id?'/'+encodeURIComponent(id):'')+'?'+query,{headers}).then(result=>{
      if(!live)return;setData(result.data);if(id){setCode(result.data.codigo);setName(result.data.nombre);}
    }).catch(e=>{if(live && e.name!=='AbortError'){setError(messages[e.status]||'No se pudo cargar. Vuelve a intentarlo.');if(e.status===403)denied();}})
      .finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[path,cursor,reload,tenant,company]);
  const send=async(event,attach=false)=>{
    event?.preventDefault();if(busy || !canWrite)return;
    const stamp=++local.current;setBusy(true);setError('');setSaved('');
    const body={company_id:company,...(attach?{tercero_id:data.id}:create&&existing?{tercero_id:existing}:{codigo:code.trim(),nombre:name.trim(),...(!create?{version:data.version}:{})})};
    const fingerprint=JSON.stringify(body), target=attach?(capacity==='clientes'?'proveedores':'clientes'):capacity;
    const newRecord=create||attach;
    if(!key.current || key.current.fingerprint!==fingerprint || key.current.target!==target)key.current={fingerprint,target,value:crypto.randomUUID()};
    try {
      const result=await request(API+'/v1/administration/'+target+(!newRecord?'/'+data.id:''),{
        method:newRecord?'POST':'PATCH',headers:{...headers,'Content-Type':'application/json',...(newRecord?{'Idempotency-Key':key.current.value}:{})},body:fingerprint});
      if(!active.current||stamp!==local.current)return;
      key.current=null;
      if(attach){setSaved('Rol añadido al mismo tercero.');setReload(x=>x+1);}
      else navigate(base+'/'+result.data.id);
    } catch(e){if(active.current && stamp===local.current && e.name!=='AbortError'){setError(messages[e.status]||'No se pudo confirmar la operación. Reintenta el mismo contenido para conservar la clave de idempotencia.');if(e.status===403)denied();}}
    finally{if(active.current && stamp===local.current)setBusy(false);}
  };
  if(loading)return <p role="status">Cargando {label.toLowerCase()}…</p>;
  return <section aria-labelledby="parties-title">
    <div className="page-heading"><div><p className="eyebrow">Finanzas / Administración</p><h1 id="parties-title">{create?'Nuevo registro':id?(edit?'Editar tercero':data?.nombre||'Detalle'):label}</h1></div>
      {!id&&!create&&canWrite&&<button onClick={()=>navigate(base+'/nuevo')}>Crear {capacity==='clientes'?'cliente':'proveedor'}</button>}
    </div>
    {error&&<div className="notice error" role="alert">{error} <button className="secondary" onClick={()=>setReload(x=>x+1)}>Recargar datos</button></div>}
    {saved&&<p role="status">{saved}</p>}
    {(create||edit)&&canWrite&&<form className="panel record-form" onSubmit={send}>
      {create&&<label>Vincular tercero existente (UUID, opcional)<input name="tercero_id" value={existing} onChange={e=>setExisting(e.target.value)} pattern="[0-9a-fA-F-]{36}" placeholder="Reutiliza el maestro sin duplicarlo"/></label>}
      {!existing&&<><label>Código<input name="codigo" required maxLength={80} value={code} onChange={e=>setCode(e.target.value)}/></label>
        <label>Nombre<input name="nombre" required maxLength={200} value={name} onChange={e=>setName(e.target.value)}/></label></>}
      {edit&&data&&<p>Versión {data.version}. Los cambios del maestro afectan a sus perfiles vinculados.</p>}
      <div className="actions"><button disabled={busy}>{busy?'Guardando…':'Guardar'}</button><button type="button" className="secondary" onClick={()=>navigate(id?base+'/'+id:base)}>Cancelar</button></div>
    </form>}
    {(create||edit)&&!canWrite&&<p className="notice" role="alert">No tienes permiso para modificar terceros.</p>}
    {id&&!edit&&data&&<div className="panel detail"><dl><dt>Código</dt><dd>{data.codigo}</dd><dt>Nombre</dt><dd>{data.nombre}</dd><dt>Roles en esta empresa</dt><dd>{data.roles.join(', ')}</dd><dt>Versión</dt><dd>{data.version}</dd></dl>
      <div className="actions"><button className="secondary" onClick={()=>navigate(base)}>Volver al listado</button>{canWrite&&<button onClick={()=>navigate(base+'/'+id+'/editar')}>Editar</button>}
      {canWrite&&!data.roles.includes(capacity==='clientes'?'proveedor':'cliente')&&<button className="secondary" disabled={busy} onClick={()=>send(null,true)}>Añadir rol {capacity==='clientes'?'proveedor':'cliente'}</button>}</div></div>}
    {!id&&!create&&data&&<div className="panel"><div className="table-scroll"><table><thead><tr><th>Código</th><th>Nombre</th><th>Roles</th><th>Acción</th></tr></thead><tbody>
      {data.items.map(row=><tr key={row.id}><td>{row.codigo}</td><td>{row.nombre}</td><td>{row.roles.join(', ')}</td><td><a href={'#'+base+'/'+row.id}>Ver detalle</a></td></tr>)}</tbody></table></div>
      {data.items.length===0&&<p className="empty">No hay {label.toLowerCase()} registrados en esta empresa.</p>}
      <div className="pagination"><button className="secondary" disabled={!pages.length} onClick={()=>{setCursor(pages[pages.length-1]);setPages(p=>p.slice(0,-1));}}>Anterior</button><span>Máximo 10 registros por página</span><button className="secondary" disabled={!data.next_cursor} onClick={()=>{setPages(p=>[...p,cursor]);setCursor(data.next_cursor);}}>Siguiente</button></div>
    </div>}
  </section>;
}
