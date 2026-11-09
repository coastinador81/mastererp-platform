import React, {useCallback, useEffect, useState} from 'react';
import './payment-configuration.css';

const call=(runtime,path,options={})=>runtime.request(runtime.api+path,{...options,headers:{'X-Tenant-Id':runtime.tenant,'Content-Type':'application/json',...(options.headers||{})}});
const value=(form,name)=>String(form.get(name)||'').trim();

export default function PaymentConfiguration({runtime}) {
  const [stores,setStores]=useState([]),[selected,setSelected]=useState(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[saving,setSaving]=useState(false);
  const writable=runtime.permissions.includes('digital_sales.ecommerce.write');
  const load=useCallback(async()=>{try{const rows=(await call(runtime,`/v1/companies/${runtime.company}/stores`)).items;setStores(rows);setSelected(current=>rows.find(store=>store.id===current?.id)||rows[0]||null);setError('');}catch{setError('No se pudieron cargar las tiendas.');}},[runtime]);
  useEffect(()=>{if(runtime.company)void load();},[runtime.company,load]);
  async function save(event){
    event.preventDefault();if(!selected||!writable)return;
    const form=new FormData(event.currentTarget),cash=form.has('cash'),mobile=form.has('mobile'),transfer=form.has('transfer');
    if(mobile&&(!value(form,'mobileDocument')||!value(form,'mobilePhone')||!value(form,'mobileBankCode')))return setError('Completa documento, teléfono y código bancario del pago móvil.');
    if(transfer&&(!value(form,'transferDocument')||!value(form,'transferAccount')||!value(form,'transferBankCode')))return setError('Completa documento, cuenta y código bancario de la transferencia.');
    const configuration={...(selected.configuration||{}),payments:{...(selected.configuration?.payments||{}),efectivo:cash,'al-recibir':cash,'pago-movil':mobile,transferencia:transfer},paymentDetails:{mobilePayment:mobile?{document:value(form,'mobileDocument'),phone:value(form,'mobilePhone'),bankCode:value(form,'mobileBankCode'),bankName:value(form,'mobileBankName'),accountHolder:value(form,'mobileHolder')}:null,bankTransfer:transfer?{document:value(form,'transferDocument'),bankCode:value(form,'transferBankCode'),bankName:value(form,'transferBankName'),accountNumber:value(form,'transferAccount'),accountHolder:value(form,'transferHolder')}:null}};
    setSaving(true);setError('');setMessage('');
    try{await call(runtime,`/v1/companies/${runtime.company}/stores/${selected.id}`,{method:'PATCH',body:JSON.stringify({version:selected.version,changes:{configuration}})});await load();setMessage('Métodos de pago actualizados.');}
    catch(problem){setError(problem?.message||'No se pudo guardar la configuración.');}
    finally{setSaving(false);}
  }
  return <section className="canonical-module payment-config-module"><div className="page-heading"><div><nav className="supplier-breadcrumb"><span>E-commerce</span><span>/</span><span className="current">Operaciones</span></nav><h1>Métodos de pago</h1><p className="supplier-subtitle">Define las opciones y datos que verá el comprador en cada tienda.</p></div><button onClick={()=>void load()}>Actualizar</button></div>
    {error?<p className="notice error" role="alert">{error}</p>:null}{message?<p className="notice" role="status">{message}</p>:null}
    <div className="payment-config-layout"><aside className="panel payment-store-list"><h2>Tiendas</h2>{stores.map(store=><button key={store.id} className={selected?.id===store.id?'selected':''} onClick={()=>{setSelected(store);setError('');setMessage('');}}><span>{store.name}</span><small>{store.domain}</small></button>)}{!stores.length?<p>No hay tiendas configuradas.</p>:null}</aside>
      <div className="panel payment-config-detail">{selected?<PaymentForm key={`${selected.id}:${selected.version}`} store={selected} writable={writable} saving={saving} onSubmit={save}/>:<p>Selecciona una tienda para configurar sus cobros.</p>}</div></div>
  </section>;
}

function PaymentForm({store,writable,saving,onSubmit}){
  const config=store.configuration||{},flags=config.payments||{},mobile=config.paymentDetails?.mobilePayment||{},transfer=config.paymentDetails?.bankTransfer||{};
  return <form onSubmit={onSubmit}><header><div><small>TIENDA</small><h2>{store.name}</h2><p>{store.domain}</p></div><span className="payment-store-status">{store.status}</span></header>
    <fieldset disabled={!writable||saving}><legend>Opciones disponibles</legend><PaymentToggle name="cash" title="Pago al recibir" detail="El comprador paga durante la entrega." defaultChecked={flags.efectivo!==false&&flags['al-recibir']!==false}/><PaymentToggle name="mobile" title="Pago móvil" detail="Publica los datos del receptor configurado." defaultChecked={flags['pago-movil']===true}/><div className="payment-fields"><Field name="mobileDocument" label="Documento" defaultValue={mobile.document}/><Field name="mobilePhone" label="Teléfono" defaultValue={mobile.phone}/><Field name="mobileBankCode" label="Código bancario" defaultValue={mobile.bankCode}/><Field name="mobileBankName" label="Banco" defaultValue={mobile.bankName}/><Field name="mobileHolder" label="Titular" defaultValue={mobile.accountHolder}/></div>
      <PaymentToggle name="transfer" title="Transferencia bancaria" detail="Publica la cuenta bancaria de la tienda." defaultChecked={flags.transferencia===true}/><div className="payment-fields"><Field name="transferDocument" label="Documento" defaultValue={transfer.document}/><Field name="transferBankCode" label="Código bancario" defaultValue={transfer.bankCode}/><Field name="transferBankName" label="Banco" defaultValue={transfer.bankName}/><Field name="transferAccount" label="Número de cuenta" defaultValue={transfer.accountNumber}/><Field name="transferHolder" label="Titular" defaultValue={transfer.accountHolder}/></div>
    </fieldset>{writable?<button className="primary" disabled={saving}>{saving?'Guardando…':'Guardar métodos de pago'}</button>:<p>Acceso de solo lectura.</p>}</form>;
}
function PaymentToggle({name,title,detail,defaultChecked}){return <label className="payment-toggle"><input type="checkbox" name={name} defaultChecked={defaultChecked}/><span><strong>{title}</strong><small>{detail}</small></span></label>;}
function Field({name,label,defaultValue}){return <label>{label}<input name={name} defaultValue={defaultValue||''}/></label>;}
