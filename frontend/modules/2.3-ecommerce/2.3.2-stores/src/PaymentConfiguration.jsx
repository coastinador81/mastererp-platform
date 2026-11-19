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
    const form=new FormData(event.currentTarget),cash=form.has('cash'),mobile=form.has('mobile'),transfer=form.has('transfer'),posDelivery=form.has('posDelivery'),posPickup=form.has('posPickup');
    const storeName=value(form,'storeName');
    if(storeName.length<2||storeName.length>120)return setError('El nombre de la tienda debe tener entre 2 y 120 caracteres.');
    const companyProfile={legal_name:value(form,'legalName'),trade_name:value(form,'tradeName'),tax_identifier:value(form,'taxIdentifier'),address:value(form,'fiscalAddress'),phone:value(form,'companyPhone'),email:value(form,'companyEmail'),logo_url:value(form,'companyLogo'),primary_color:value(form,'companyColor')};
    if(companyProfile.legal_name.length<2||companyProfile.legal_name.length>250)return setError('La razón social debe tener entre 2 y 250 caracteres.');
    if(companyProfile.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(companyProfile.email))return setError('Indica un correo válido para la empresa.');
    if(companyProfile.logo_url&&!/^https:\/\//.test(companyProfile.logo_url))return setError('El logo debe usar una dirección HTTPS.');
    const customMethods=JSON.parse(value(form,'customMethods')||'[]').map(item=>({id:item.id,name:item.name.trim(),instructions:item.instructions.trim(),enabled:item.enabled}));
    if(mobile&&(!value(form,'mobileDocument')||!value(form,'mobilePhone')||!value(form,'mobileBankCode')))return setError('Completa documento, teléfono y código bancario del pago móvil.');
    if(transfer&&(!value(form,'transferDocument')||!value(form,'transferAccount')||!value(form,'transferBankCode')))return setError('Completa documento, cuenta y código bancario de la transferencia.');
    if(customMethods.some(item=>item.name.length<2||item.name.length>60||!item.instructions||item.instructions.length>500))return setError('Cada método agregado necesita un nombre (2 a 60 caracteres) e instrucciones para el comprador (hasta 500).');
    const configuration={...(selected.configuration||{}),payments:{...(selected.configuration?.payments||{}),efectivo:cash,'al-recibir':cash,'pago-movil':mobile,transferencia:transfer,'punto-venta-entrega':posDelivery,'punto-venta-retiro':posPickup},paymentDetails:{...(selected.configuration?.paymentDetails||{}),customMethods,mobilePayment:mobile?{document:value(form,'mobileDocument'),phone:value(form,'mobilePhone'),bankCode:value(form,'mobileBankCode'),bankName:value(form,'mobileBankName'),accountHolder:value(form,'mobileHolder')}:null,bankTransfer:transfer?{document:value(form,'transferDocument'),bankCode:value(form,'transferBankCode'),bankName:value(form,'transferBankName'),accountNumber:value(form,'transferAccount'),accountHolder:value(form,'transferHolder')}:null}};
    lock.current=true;setSaving(true);setError('');setMessage('');
    try{const saved=await call(runtime,`/v1/companies/${runtime.company}/stores/${selected.id}`,{method:'PATCH',body:JSON.stringify({version:selected.version,name:storeName,changes:{configuration},company_profile:companyProfile})});if(!saved?.id||!saved.version)throw new Error('Invalid store response');if(alive.current){setStores(rows=>rows.map(store=>store.id===saved.id?saved:store));setSelected(saved);setDirty(false);setMessage('Configuración y datos fiscales guardados.');}await runtime.refresh?.(true);}
    catch{if(alive.current)setError('No se pudo guardar. Revisa los datos y tus permisos. Si la tienda cambió, actualiza antes de reintentar.');}
    finally{lock.current=false;if(alive.current)setSaving(false);}
  }
  return <section className="canonical-module payment-config-module"><div className="page-heading"><div><nav className="supplier-breadcrumb"><span>E-commerce</span><span>/</span><span className="current">Operaciones</span></nav><h1>Configuración de tienda</h1><p className="supplier-subtitle">Administra la identidad visible y los métodos de pago de cada tienda.</p></div><button className="ops-button secondary" disabled={loading||saving} onClick={()=>{if(discard())void load();}}>{loading?'Actualizando…':'Actualizar'}</button></div>
    {error?<p className="notice error" role="alert">{error}</p>:null}{message?<p className="notice" role="status">{message}</p>:null}
    <div className="operation-master-detail"><aside className="panel operation-list"><header><div><h2>Tiendas</h2><p>{loaded&&!loading?`${stores.length} ${stores.length===1?'tienda disponible':'tiendas disponibles'}`:'Opciones de cobro por tienda'}</p></div></header>
      {loading?<LoadingState label="Cargando tiendas…"/>:loaded?stores.length?stores.map(store=><button type="button" key={store.id} disabled={saving} aria-pressed={selected?.id===store.id} className={`operation-list-item ${selected?.id===store.id?'selected':''}`} onClick={()=>{if(selected?.id===store.id||!discard())return;setSelected(store);setDirty(false);setError('');setMessage('');}}><span className="ops-row-icon"><FinanceIcon name="location"/></span><span className="payment-store-name"><strong>{store.name}</strong><small>{store.domain}</small></span><span className="row-action"><StatusBadge status={store.status}>{storeStatus(store.status)}</StatusBadge><span aria-hidden="true">›</span></span></button>):<div className="operation-empty"><h3>Aún no hay tiendas en esta empresa</h3><p>Cuando exista una tienda, podrás configurar aquí sus métodos de pago.</p></div>:<div className="operation-empty"><p>La lista de tiendas no está disponible.</p></div>}
      </aside><div className="panel operation-detail payment-config-detail">{loaded&&!loading&&selected?<PaymentForm key={`${selected.id}:${selected.version}`} store={selected} writable={writable} saving={saving} onSubmit={save} onChange={()=>setDirty(true)} onReset={event=>{if(!discard())event.preventDefault();else setDirty(false);}}/>:<div className="operation-empty"><span className="ops-row-icon"><FinanceIcon name="invoice"/></span><h2>{loading?'Consultando tiendas':loaded&&!stores.length?'Configura los cobros de tu tienda':'Métodos de pago por tienda'}</h2><p>{loading?'En cuanto termine la carga verás aquí su configuración.':loaded?'Elige una tienda de la lista para revisar las opciones que verá el comprador.':'Actualiza la lista para consultar la configuración.'}</p></div>}</div></div>
  </section>;
}

const initialFlags=flags=>({cash:flags.efectivo!==false&&flags['al-recibir']!==false,mobile:flags['pago-movil']===true,transfer:flags.transferencia===true,posDelivery:flags['punto-venta-entrega']===true,posPickup:flags['punto-venta-retiro']===true});
const initialCustom=config=>Array.isArray(config.paymentDetails?.customMethods)?config.paymentDetails.customMethods:[];
function PaymentForm({store,writable,saving,onSubmit,onChange,onReset}){
  const config=store.configuration||{},mobile=config.paymentDetails?.mobilePayment||{},transfer=config.paymentDetails?.bankTransfer||{};
  const company=store.company_profile||{};
  const [active,setActive]=useState(()=>initialFlags(config.payments||{})),[custom,setCustom]=useState(()=>initialCustom(config)),[added,setAdded]=useState('');
  const toggle=key=>event=>setActive(current=>({...current,[key]:event.target.checked}));
  const changeCustom=(id,patch)=>{setCustom(rows=>rows.map(row=>row.id===id?{...row,...patch}:row));onChange();};
  const add=()=>{const id=`m-${Date.now().toString(36)}`;setCustom(rows=>[...rows,{id,name:'',instructions:'',enabled:true}]);setAdded(id);onChange();};
  const reset=event=>{onReset(event);if(!event.defaultPrevented){setActive(initialFlags(config.payments||{}));setCustom(initialCustom(config));}};
  return <form onSubmit={onSubmit} onChange={onChange} onReset={reset}><header className="node-form-heading"><div><small>CONFIGURACIÓN DE TIENDA</small><h2>{store.name}</h2><p>{store.domain}</p></div><StatusBadge status={store.status}>{storeStatus(store.status)}</StatusBadge></header>
    <fieldset disabled={!writable||saving}><legend>Identidad visible</legend><div className="payment-fields"><label className="payment-field-wide">Nombre de la tienda<input name="storeName" defaultValue={store.name} minLength={2} maxLength={120} required/><small>Se muestra en la cabecera del Storefront.</small></label></div></fieldset>
    <fieldset disabled={!writable||saving}><legend>Datos fiscales y documentos</legend><p className="payment-fieldset-help">Información legal de la empresa activa. Se utiliza en facturas y comprobantes, sin duplicarse por tienda.</p><div className="payment-fields">
      <Field name="legalName" label="Razón social *" defaultValue={company.legal_name} required maxLength={250}/><Field name="tradeName" label="Nombre comercial" defaultValue={company.trade_name} maxLength={250}/>
      <Field name="taxIdentifier" label="RIF" defaultValue={company.tax_identifier} maxLength={100}/><Field name="companyPhone" label="Teléfono" defaultValue={company.phone} maxLength={40}/>
      <label className="payment-field-wide">Dirección fiscal<textarea name="fiscalAddress" defaultValue={company.address||''} maxLength={500} rows={3}/></label>
      <Field name="companyEmail" label="Correo" defaultValue={company.email} type="email" maxLength={254}/><Field name="companyColor" label="Color corporativo" defaultValue={company.primary_color||'#0758b3'} type="color"/>
      <label className="payment-field-wide">Logo de la empresa<input name="companyLogo" type="url" defaultValue={company.logo_url||''} maxLength={1000} placeholder="https://…"/><small>Usa una imagen HTTPS accesible públicamente para incluirla en el PDF.</small></label>
    </div></fieldset>
    <fieldset disabled={!writable||saving}><legend>Métodos de pago</legend>
      <Accordion title="Pago al recibir" detail="Efectivo durante la entrega." active={active.cash}><PaymentToggle name="cash" title="Activar pago al recibir" detail="El comprador paga en efectivo cuando recibe su pedido." checked={active.cash} onChange={toggle('cash')}/></Accordion>
      <Accordion title="Punto de venta" detail="Pago con tarjeta en el punto de venta." active={active.posDelivery||active.posPickup}><PaymentToggle name="posDelivery" title="Pago al entregar" detail="Se cobra con el punto de venta al entregar el pedido." checked={active.posDelivery} onChange={toggle('posDelivery')}/><PaymentToggle name="posPickup" title="Pago al retirar" detail="Se cobra cuando el cliente retira en tienda. El comprador lo verá cuando la tienda ofrezca retiro." checked={active.posPickup} onChange={toggle('posPickup')}/></Accordion>
      <Accordion title="Pago móvil" detail="Publica los datos del receptor configurado." active={active.mobile}><PaymentToggle name="mobile" title="Activar pago móvil" detail="El comprador indica la referencia del pago." checked={active.mobile} onChange={toggle('mobile')}/><div className="payment-fields"><Field name="mobileDocument" label="Documento" defaultValue={mobile.document}/><Field name="mobilePhone" label="Teléfono" defaultValue={mobile.phone}/><Field name="mobileBankCode" label="Código bancario" defaultValue={mobile.bankCode}/><Field name="mobileBankName" label="Banco" defaultValue={mobile.bankName}/><Field name="mobileHolder" label="Titular" defaultValue={mobile.accountHolder}/></div></Accordion>
      <Accordion title="Transferencia bancaria" detail="Publica la cuenta bancaria de la tienda." active={active.transfer}><PaymentToggle name="transfer" title="Activar transferencia" detail="El comprador indica la referencia de la transferencia." checked={active.transfer} onChange={toggle('transfer')}/><div className="payment-fields"><Field name="transferDocument" label="Documento" defaultValue={transfer.document}/><Field name="transferBankCode" label="Código bancario" defaultValue={transfer.bankCode}/><Field name="transferBankName" label="Banco" defaultValue={transfer.bankName}/><Field name="transferAccount" label="Número de cuenta" defaultValue={transfer.accountNumber}/><Field name="transferHolder" label="Titular" defaultValue={transfer.accountHolder}/></div></Accordion>
      {custom.map(item=><Accordion key={item.id} title={item.name.trim()||'Nuevo método de pago'} detail="Pide referencia y se verifica manualmente." active={item.enabled} defaultOpen={item.id===added}><label className="ops-switch-row"><span><strong>Activar este método</strong><small>Se muestra en el checkout con tus instrucciones.</small></span><span className="ops-switch"><input type="checkbox" role="switch" checked={item.enabled} onChange={event=>changeCustom(item.id,{enabled:event.target.checked})}/><i aria-hidden="true"/></span></label><div className="payment-fields payment-custom-fields"><label>Nombre<input value={item.name} maxLength={60} placeholder="Ej. Zelle" onChange={event=>changeCustom(item.id,{name:event.target.value})}/></label><label className="payment-field-wide">Instrucciones para el comprador<textarea value={item.instructions} maxLength={500} rows={3} placeholder="Datos de la cuenta o pasos para pagar" onChange={event=>changeCustom(item.id,{instructions:event.target.value})}/></label></div><button type="button" className="ops-button secondary payment-remove" onClick={()=>{setCustom(rows=>rows.filter(row=>row.id!==item.id));onChange();}}>Quitar método</button></Accordion>)}
      <input type="hidden" name="customMethods" value={JSON.stringify(custom)}/>
      {custom.length<10?<button type="button" className="ops-button secondary payment-add" onClick={add}>+ Agregar método de pago</button>:<p className="payment-limit">Puedes tener hasta 10 métodos agregados.</p>}
    </fieldset>{writable?<div className="payment-form-actions"><button type="reset" className="ops-button secondary" disabled={saving}>Descartar</button><button className="ops-button primary" disabled={saving}>{saving?'Guardando…':'Guardar cambios'}</button></div>:<p>Acceso de solo lectura.</p>}</form>;
}
function Accordion({title,detail,active,defaultOpen=false,children}){return <details className="payment-accordion" open={defaultOpen}><summary><span className="payment-accordion-title"><strong>{title}</strong><small>{detail}</small></span><StatusBadge status={active?'ACTIVE':'INACTIVE'}>{active?'Activo':'Inactivo'}</StatusBadge><span className="payment-accordion-chevron" aria-hidden="true">›</span></summary><div className="payment-accordion-body">{children}</div></details>;}
function PaymentToggle({name,title,detail,checked,onChange}){return <label className="ops-switch-row"><span><strong>{title}</strong><small>{detail}</small></span><span className="ops-switch"><input type="checkbox" role="switch" name={name} checked={checked} onChange={onChange}/><i aria-hidden="true"/></span></label>;}
function Field({name,label,defaultValue,...props}){return <label>{label}<input name={name} defaultValue={defaultValue||''} {...props}/></label>;}
