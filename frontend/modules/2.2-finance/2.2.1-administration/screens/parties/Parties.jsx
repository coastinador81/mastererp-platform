import CustomerOverview from './CustomerOverview.jsx';
import SupplierWizardHeader from './SupplierWizardHeader.jsx';
import SupplierFields,{SupplierSummary,emptySupplier,supplierFromParty,supplierPayload} from './SupplierFields.jsx';
import SupplierDirectory from './SupplierDirectory.jsx';
import FinanceIcon from '../../../src/FinanceIcon.jsx';
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
  const [supplier,setSupplier]=useState(emptySupplier);
  const [supplierStep,setSupplierStep]=useState(0);
  const supplierWizard=create&&capacity==='proveedores';
  const key=useRef(null), active=useRef(true), local=useRef(0);
  useEffect(()=>{active.current=true;return()=>{active.current=false;local.current++;};},[]);
  const endpoint=API+'/v1/administration/'+capacity;
  const headers={'X-MasterERP-Tenant-Id':tenant};
  useEffect(()=>{
    let live=true;setError('');setSaved('');setData(null);setCode('');setName('');setExisting('');setSupplier(emptySupplier());setSupplierStep(0);key.current=null;
    if(create){setLoading(false);return()=>{live=false;};}
    setLoading(true);
    const query=new URLSearchParams({company_id:company,limit:'10',...(cursor?{after:cursor}:{})});
    request(endpoint+(id?'/'+encodeURIComponent(id):'')+'?'+query,{headers}).then(result=>{
      if(!live)return;
      const rows=id?[result.data]:result.data?.items;
      if(!Array.isArray(rows)||rows.some(x=>!x||typeof x.id!=='string'||typeof x.codigo!=='string'||typeof x.nombre!=='string'||!Array.isArray(x.roles)))throw new Error('invalid_response');
      setData(result.data);if(id){setCode(result.data.codigo);setName(result.data.nombre);setSupplier(supplierFromParty(result.data));}
    }).catch(e=>{if(live && e.name!=='AbortError'){setError(messages[e.status]||'No se pudo cargar. Vuelve a intentarlo.');if(e.status===403)denied();}})
      .finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[path,cursor,reload,tenant,company]);
  const send=async(event,attach=false)=>{
    event?.preventDefault();if(busy || !canWrite)return;
    const stamp=++local.current;setBusy(true);setError('');setSaved('');
    const body={company_id:company,...(attach?{tercero_id:data.id}:create&&existing?{tercero_id:existing}:{codigo:code.trim(),nombre:name.trim(),...(!create?{version:data.version}:{})})};
    if(!attach&&!existing){
      if(Boolean(supplier.values.descuento_pronto_pago)!==Boolean(supplier.values.plazo_pronto_pago_dias)){setBusy(false);setError('Indica juntos el descuento por pronto pago y su plazo.');return;}
      try { const details=supplierPayload(supplier);if(capacity==='clientes')delete details.condiciones.tipo_suministro;Object.assign(body,details,...(!create?[{profile_version:data.profile_version,catalog_version:data.catalog_version}]:[])); }
      catch(error){setBusy(false);setError(error.message);return;}
    }
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
  const supplierListing=capacity==='proveedores'&&!id&&!create;
  const identityFields=<><label>{capacity==='proveedores'?'Código interno':'Código'}<input name="codigo" required maxLength={80} value={code} onChange={e=>setCode(e.target.value)}/></label><label>{capacity==='proveedores'?'Razón social o nombre':'Nombre'}<input name="nombre" required maxLength={200} value={name} onChange={e=>setName(e.target.value)}/></label></>;
  return <section className={capacity==='clientes'?'customer-view':supplierListing?'supplier-directory':undefined} aria-labelledby="parties-title">
    <div className="page-heading"><div>{supplierListing?<nav className="supplier-breadcrumb" aria-label="Ruta de navegación"><a href="/" onClick={event=>{if(!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey){event.preventDefault();navigate('/modulos/finanzas');}}}>Finanzas</a><span>/</span><span>Administración</span><span>/</span><span className="current">Gestión de compras</span></nav>:<p className="eyebrow">Finanzas / Administración</p>}<h1 id="parties-title">{create?(capacity==='proveedores'?'Crear proveedor':'Crear cliente'):id?(edit?(capacity==='clientes'?'Editar cliente':'Editar tercero'):data?.nombre||'Detalle'):label}</h1>{supplierListing&&<p className="supplier-subtitle">Gestiona la información de tus proveedores.</p>}</div>
      {!id&&!create&&canWrite&&<button className={supplierListing?'supplier-create':undefined} onClick={()=>navigate(base+'/nuevo')}>{supplierListing&&<FinanceIcon name="plus"/>}Crear {capacity==='clientes'?'cliente':'proveedor'}</button>}
    </div>
    {error&&<div className="notice error" role="alert">{error} <button className="secondary" onClick={()=>setReload(x=>x+1)}>Recargar datos</button></div>}
    {saved&&<p role="status">{saved}</p>}
    {(create||edit)&&canWrite&&<form className={'supplier-form'+(supplierWizard?' supplier-create-wizard':'')+(capacity==='clientes'?' customer-form':'')} onSubmit={event=>{if(supplierWizard&&supplierStep<2){event.preventDefault();setSupplierStep(step=>step+1);}else send(event);}}>
      {supplierWizard&&<SupplierWizardHeader step={supplierStep}/>}

      {!existing&&(!supplierWizard||supplierStep===0)&&(supplierWizard||capacity==='clientes'?<div className="supplier-fields supplier-wizard-identity">{identityFields}</div>:identityFields)}
      {!existing&&<SupplierFields draft={supplier} onChange={setSupplier} role={capacity==='clientes'?'cliente':'proveedor'} step={supplierWizard?supplierStep:undefined}/>}
      {create&&(!supplierWizard||supplierStep===0)&&<details className="panel"><summary>Usar una ficha existente (opcional)</summary><p>Vincula su identificador para reutilizar la misma ficha, sin duplicarla.</p><label>Identificador de la ficha existente<input name="tercero_id" value={existing} onChange={e=>setExisting(e.target.value)} pattern="[0-9a-fA-F-]{36}" placeholder="Reutiliza el maestro sin duplicarlo"/></label></details>}
      {supplierWizard&&existing&&supplierStep>0&&<div className="panel"><p>Se vinculará la ficha existente. Sus datos se conservan; podrás consultarlos después de crear el vínculo.</p></div>}
      {supplierWizard&&supplierStep===2&&<section className="panel supplier-wizard-review" aria-label="Resumen del proveedor"><h3>Antes de crear el proveedor</h3><dl><dt>{existing?'Ficha existente':'Proveedor'}</dt><dd>{existing||name}</dd>{!existing&&<><dt>Código interno</dt><dd>{code}</dd><dt>Contactos</dt><dd>{supplier.contacts.filter(contact=>Object.values(contact).some(value=>String(value).trim())).length} · {supplier.principal>=0?'Principal seleccionado':'Sin principal'}</dd></>}</dl><p>Puedes volver a los pasos anteriores para revisar los datos. No se guardará nada hasta pulsar «Crear proveedor».</p></section>}
      {edit&&data&&<p>Versión {data.version}. Los cambios del maestro afectan a sus perfiles vinculados.</p>}
      <div className={supplierWizard?'actions supplier-wizard-actions':'actions'}>{supplierWizard&&supplierStep>0&&<button type="button" className="secondary" disabled={busy} onClick={()=>setSupplierStep(step=>step-1)}>Anterior</button>}<button disabled={busy}>{busy?'Guardando…':supplierWizard?(supplierStep<2?'Continuar':'Crear proveedor'):'Guardar'}</button><button type="button" className="secondary" onClick={()=>navigate(id?base+'/'+id:base)}>Cancelar</button></div>
    </form>}
    {(create||edit)&&!canWrite&&<p className="notice" role="alert">No tienes permiso para modificar terceros.</p>}
    {id&&!edit&&data&&<div className="panel detail"><dl><dt>Código</dt><dd>{data.codigo}</dd><dt>Nombre</dt><dd>{data.nombre}</dd><dt>Roles en esta empresa</dt><dd>{data.roles.join(', ')}</dd><dt>Versión</dt><dd>{data.version}</dd></dl>
      <div className="actions"><button className="secondary" onClick={()=>navigate(base)}>Volver al listado</button>{canWrite&&<button onClick={()=>navigate(base+'/'+id+'/editar')}>Editar</button>}
      {canWrite&&!data.roles.includes(capacity==='clientes'?'proveedor':'cliente')&&<button className="secondary" disabled={busy} onClick={()=>send(null,true)}>Añadir rol {capacity==='clientes'?'proveedor':'cliente'}</button>}</div></div>}
    {capacity==='clientes'&&id&&!edit&&data&&<CustomerOverview data={data}/>}
    {capacity==='proveedores'&&id&&!edit&&data&&<SupplierSummary data={data}/>}
    {supplierListing&&data&&<SupplierDirectory {...{data,workspace,base,navigate,reload,endpoint}} hasPrevious={pages.length>0} onPrevious={()=>{setCursor(pages[pages.length-1]);setPages(p=>p.slice(0,-1));}} onNext={()=>{setPages(p=>[...p,cursor]);setCursor(data.next_cursor);}}/>}
    {capacity==='clientes'&&!id&&!create&&data&&<SupplierDirectory plural="clientes" {...{data,workspace,base,navigate,reload,endpoint}} hasPrevious={pages.length>0} onPrevious={()=>{setCursor(pages[pages.length-1]);setPages(p=>p.slice(0,-1));}} onNext={()=>{setPages(p=>[...p,cursor]);setCursor(data.next_cursor);}}/>}
  </section>;
}
