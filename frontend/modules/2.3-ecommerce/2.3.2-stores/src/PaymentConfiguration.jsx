import React, {useCallback, useEffect, useRef, useState} from 'react';
import FinanceIcon from '../../../2.2-finance/src/FinanceIcon.jsx';
import StatusBadge from '../../../../shared/status-badge/StatusBadge.jsx';
import LoadingState from '../../../../shared/loading-state/LoadingState.jsx';
import './payment-configuration.css';

const call=(runtime,path,options={})=>runtime.request(runtime.api+path,{...options,headers:{'X-Tenant-Id':runtime.tenant,'Content-Type':'application/json',...(options.headers||{})}});
const value=(form,name)=>String(form.get(name)||'').trim();

export default function PaymentConfiguration({runtime}) {
  return <PaymentSession key={`${runtime.api}:${runtime.tenant}:${runtime.company}:${runtime.permissions.join(',')}`} runtime={runtime}/>;
}
const storeStatus = status => ({ACTIVE:'Activa',DRAFT:'Borrador',PAUSED:'Pausada'}[status] || status);
function PaymentSession({runtime}) {
  const [stores,setStores]=useState([]),[selected,setSelected]=useState(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[saving,setSaving]=useState(false),[loading,setLoading]=useState(true),[loaded,setLoaded]=useState(false),[dirty,setDirty]=useState(false);
  const runtimeRef=useRef(runtime),alive=useRef(false),lock=useRef(false),request=useRef(0);
  runtimeRef.current=runtime;
  const writable=runtime.permissions.includes('digital_sales.ecommerce.write');
  const load=useCallback(async()=>{
    const id=++request.current,r=runtimeRef.current;
    setLoading(true);setError('');
    try{
      if(!r.company)throw new Error('Missing company');
      const rows=(await call(r,`/v1/companies/${r.company}/stores`)).items;
      if(!Array.isArray(rows))throw new Error('Invalid stores response');
      if(alive.current&&id===request.current){setStores(rows);setSelected(current=>rows.find(store=>store.id===current?.id)||rows[0]||null);setLoaded(true);setDirty(false);}
    }catch{if(alive.current&&id===request.current){setLoaded(false);setError('No pudimos consultar las tiendas de esta empresa. Pulsa Actualizar para reintentar.');}}
    finally{if(alive.current&&id===request.current)setLoading(false);}
  },[]);
  useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;request.current++;};},[load]);
  useEffect(()=>{const warn=event=>{if(dirty){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  const discard=()=>!dirty||window.confirm('¿Descartar los cambios sin guardar?');
  async function save(event){
    event.preventDefault();if(!selected||!writable||lock.current)return;
    const form=new FormData(event.currentTarget),cash=form.has('cash'),mobile=form.has('mobile'),transfer=form.has('transfer');
    if(mobile&&(!value(form,'mobileDocument')||!value(form,'mobilePhone')||!value(form,'mobileBankCode')))return setError('Completa documento, teléfono y código bancario del pago móvil.');
    if(transfer&&(!value(form,'transferDocument')||!value(form,'transferAccount')||!value(form,'transferBankCode')))return setError('Completa documento, cuenta y código bancario de la transferencia.');
    const configuration={...(selected.configuration||{}),payments:{...(selected.configuration?.payments||{}),efectivo:cash,'al-recibir':cash,'pago-movil':mobile,transferencia:transfer},paymentDetails:{mobilePayment:mobile?{document:value(form,'mobileDocument'),phone:value(form,'mobilePhone'),bankCode:value(form,'mobileBankCode'),bankName:value(form,'mobileBankName'),accountHolder:value(form,'mobileHolder')}:null,bankTransfer:transfer?{document:value(form,'transferDocument'),bankCode:value(form,'transferBankCode'),bankName:value(form,'transferBankName'),accountNumber:value(form,'transferAccount'),accountHolder:value(form,'transferHolder')}:null}};
    lock.current=true;setSaving(true);setError('');setMessage('');
    try{const saved=await call(runtime,`/v1/companies/${runtime.company}/stores/${selected.id}`,{method:'PATCH',body:JSON.stringify({version:selected.version,changes:{configuration}})});if(!saved?.id||!saved.version)throw new Error('Invalid store response');if(alive.current){setStores(rows=>rows.map(store=>store.id===saved.id?saved:store));setSelected(saved);setDirty(false);setMessage('Métodos de pago guardados para esta tienda.');}}
    catch{if(alive.current)setError('No se pudo guardar. Revisa los datos y tus permisos. Si la tienda cambió, actualiza antes de reintentar.');}
    finally{lock.current=false;if(alive.current)setSaving(false);}
  }
  return <section className="canonical-module payment-config-module"><div className="page-heading"><div><nav className="supplier-breadcrumb"><span>E-commerce</span><span>/</span><span className="current">Operaciones</span></nav><h1>Métodos de pago</h1><p className="supplier-subtitle">Configura cómo pueden pagar los clientes de cada tienda.</p></div><button className="ops-button secondary" disabled={loading||saving} onClick={()=>{if(discard())void load();}}>{loading?'Actualizando…':'Actualizar'}</button></div>
    {error?<p className="notice error" role="alert">{error}</p>:null}{message?<p className="notice" role="status">{message}</p>:null}
    <div className="operation-master-detail"><aside className="panel operation-list"><header><div><h2>Tiendas</h2><p>{loaded&&!loading?`${stores.length} ${stores.length===1?'tienda disponible':'tiendas disponibles'}`:'Opciones de cobro por tienda'}</p></div></header>
      {loading?<LoadingState label="Cargando tiendas…"/>:loaded?stores.length?stores.map(store=><button type="button" key={store.id} disabled={saving} aria-pressed={selected?.id===store.id} className={`operation-list-item ${selected?.id===store.id?'selected':''}`} onClick={()=>{if(selected?.id===store.id||!discard())return;setSelected(store);setDirty(false);setError('');setMessage('');}}><span className="ops-row-icon"><FinanceIcon name="location"/></span><span className="payment-store-name"><strong>{store.name}</strong><small>{store.domain}</small></span><span className="row-action"><StatusBadge status={store.status}>{storeStatus(store.status)}</StatusBadge><span aria-hidden="true">›</span></span></button>):<div className="operation-empty"><h3>Aún no hay tiendas en esta empresa</h3><p>Cuando exista una tienda, podrás configurar aquí sus métodos de pago.</p></div>:<div className="operation-empty"><p>La lista de tiendas no está disponible.</p></div>}
      </aside><div className="panel operation-detail payment-config-detail">{loaded&&!loading&&selected?<PaymentForm key={`${selected.id}:${selected.version}`} store={selected} writable={writable} saving={saving} onSubmit={save} onChange={()=>setDirty(true)} onReset={event=>{if(!discard())event.preventDefault();else setDirty(false);}}/>:<div className="operation-empty"><span className="ops-row-icon"><FinanceIcon name="invoice"/></span><h2>{loading?'Consultando tiendas':loaded&&!stores.length?'Configura los cobros de tu tienda':'Métodos de pago por tienda'}</h2><p>{loading?'En cuanto termine la carga verás aquí su configuración.':loaded?'Elige una tienda de la lista para revisar las opciones que verá el comprador.':'Actualiza la lista para consultar la configuración.'}</p></div>}</div></div>
  </section>;
}

function PaymentForm({store,writable,saving,onSubmit,onChange,onReset}){
  const config=store.configuration||{},flags=config.payments||{},mobile=config.paymentDetails?.mobilePayment||{},transfer=config.paymentDetails?.bankTransfer||{};
  return <form onSubmit={onSubmit} onChange={onChange} onReset={onReset}><header className="node-form-heading"><div><small>CONFIGURACIÓN DE COBROS</small><h2>{store.name}</h2><p>{store.domain}</p></div><StatusBadge status={store.status}>{storeStatus(store.status)}</StatusBadge></header>
    <fieldset disabled={!writable||saving}><legend>Opciones disponibles</legend><PaymentToggle name="cash" title="Pago al recibir" detail="El comprador paga durante la entrega." defaultChecked={flags.efectivo!==false&&flags['al-recibir']!==false}/><PaymentToggle name="mobile" title="Pago móvil" detail="Publica los datos del receptor configurado." defaultChecked={flags['pago-movil']===true}/><div className="payment-fields"><Field name="mobileDocument" label="Documento" defaultValue={mobile.document}/><Field name="mobilePhone" label="Teléfono" defaultValue={mobile.phone}/><Field name="mobileBankCode" label="Código bancario" defaultValue={mobile.bankCode}/><Field name="mobileBankName" label="Banco" defaultValue={mobile.bankName}/><Field name="mobileHolder" label="Titular" defaultValue={mobile.accountHolder}/></div>
      <PaymentToggle name="transfer" title="Transferencia bancaria" detail="Publica la cuenta bancaria de la tienda." defaultChecked={flags.transferencia===true}/><div className="payment-fields"><Field name="transferDocument" label="Documento" defaultValue={transfer.document}/><Field name="transferBankCode" label="Código bancario" defaultValue={transfer.bankCode}/><Field name="transferBankName" label="Banco" defaultValue={transfer.bankName}/><Field name="transferAccount" label="Número de cuenta" defaultValue={transfer.accountNumber}/><Field name="transferHolder" label="Titular" defaultValue={transfer.accountHolder}/></div>
    </fieldset>{writable?<div className="payment-form-actions"><button type="reset" className="ops-button secondary" disabled={saving}>Descartar</button><button className="ops-button primary" disabled={saving}>{saving?'Guardando…':'Guardar cambios'}</button></div>:<p>Acceso de solo lectura.</p>}</form>;
}
function PaymentToggle({name,title,detail,defaultChecked}){return <label className="ops-switch-row"><span><strong>{title}</strong><small>{detail}</small></span><span className="ops-switch"><input type="checkbox" role="switch" name={name} defaultChecked={defaultChecked}/><i aria-hidden="true"/></span></label>;}
function Field({name,label,defaultValue}){return <label>{label}<input name={name} defaultValue={defaultValue||''}/></label>;}
