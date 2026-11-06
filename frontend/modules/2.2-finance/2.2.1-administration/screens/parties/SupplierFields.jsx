import React from 'react';
import {contactHasData,contactPayload,contactsFromParty} from './supplierContacts.mjs';
export const supplierSections = [
  ['Datos generales', [
    ['codigo','Código interno','text',80,true],['nombre','Razón social o nombre','text',200,true],
    ['nombre_comercial','Nombre comercial','text',200],['tipo_persona','Tipo de persona','person',30],
  ]],
  ['Identificación fiscal', [
    ['pais_fiscal','País fiscal (código de dos letras)','country',2],
    ['tipo_identificacion','Tipo de identificación','text',30,false,'RIF, NIF, RUC u otro'],
    ['numero_identificacion','Número de identificación','text',50],
  ]],
  ['Dirección', [
    ['direccion','Dirección','text',250],['direccion_complementaria','Dirección complementaria','text',250],
    ['ciudad','Ciudad','text',100],['municipio','Municipio','text',100],['region','Estado o provincia','text',100],
    ['codigo_postal','Código postal','text',20],['pais','País (código de dos letras)','country',2],
  ]],
  ['Comunicación', [
    ['email','Correo principal','email',254],['telefono','Teléfono principal','tel',40],
    ['telefono_alterno','Teléfono alternativo','tel',40],['sitio_web','Sitio web','url',300,false,'https://'],
  ]],
  ['Condiciones comerciales', [
    ['tipo_suministro','Tipo de suministro','supply',30],
    ['moneda','Moneda preferida (código de tres letras)','currency',3],
    ['condicion_pago','Condición de pago','terms',30],['plazo_pago_dias','Plazo de pago en días','days',5],
    ['medio_pago','Medio de pago preferido','payment',30],
    ['descuento_pronto_pago','Descuento por pronto pago (%)','percent',10],
    ['plazo_pronto_pago_dias','Plazo de pronto pago en días','days',5],
  ]],
];
export const supplierOptions = {
  supply:[['productos','Productos'],['servicios','Servicios'],['ambos','Productos y servicios']],
  person:[['natural','Persona natural'],['juridica','Persona jurídica']],
  terms:[['contado','Contado'],['credito','Crédito'],['por_acordar','Por acordar']],
  payment:[['transferencia','Transferencia bancaria'],['efectivo','Efectivo'],['tarjeta','Tarjeta'],['otro','Otro']],
};
export const blankContact=()=>({nombre:'',cargo:'',email:'',telefono:''});

export function emptySupplier(){return {values:{},contacts:[],principal:-1};}
export function supplierFromParty(data){
 return {values:{...data.datos_generales,...data.condiciones},...contactsFromParty(data.contactos)};
}
export function supplierPayload(draft){
 const general={};for(const [title,fields] of supplierSections)if(title!=='Condiciones comerciales')for(const [key] of fields)if(!['codigo','nombre'].includes(key))general[key]=draft.values[key]||'';
 general.observaciones=draft.values.observaciones||'';
 const conditions={};for(const [key] of supplierSections.find(([title])=>title==='Condiciones comerciales')[1])conditions[key]=draft.values[key]||'';
 return {datos_generales:general,contactos:contactPayload(draft.contacts,draft.principal),condiciones:conditions};
}
export default function SupplierFields({draft,onChange,step,role='proveedor'}){
 const {values,contacts,principal}=draft;
 const change=(name,value)=>onChange({...draft,values:{...values,[name]:value}});
 const contactChange=(index,name,value)=>onChange({...draft,contacts:contacts.map((row,i)=>i===index?{...row,[name]:value}:row)});
 const remove=index=>onChange({...draft,contacts:contacts.filter((_,i)=>i!==index),principal:principal===index?-1:principal>index?principal-1:principal});
 const field=([name,label,type,maximum,required,placeholder])=><label key={name}>{label}{required?' *':''}
  {supplierOptions[type]?<select name={name} value={values[name]||''} onChange={e=>change(name,e.target.value)}><option value="">Sin especificar</option>{supplierOptions[type].map(([value,text])=><option key={value} value={value}>{text}</option>)}</select>:
   <input name={name} value={values[name]||''} required={Boolean(required)} maxLength={maximum} type={['days','percent'].includes(type)?'number':['country','currency'].includes(type)?'text':type}
    min={['days','percent'].includes(type)?'0':undefined} max={type==='percent'?'100':type==='days'?'2147483647':undefined} step={type==='days'?'1':type==='percent'?'0.000001':undefined}
    pattern={type==='country'?'[A-Z]{2}':type==='currency'?'[A-Z]{3}':name==='sitio_web'?'https?://.*':undefined} placeholder={placeholder}
    onChange={e=>change(name,['country','currency'].includes(type)?e.target.value.toUpperCase():e.target.value)}/>}</label>;
 return <div className="supplier-sections">{supplierSections.filter(([title])=>step===undefined||(step===0?['Datos generales','Identificación fiscal']:step===1?['Dirección','Comunicación']:['Condiciones comerciales']).includes(title)).map(([title,fields])=><fieldset className="panel supplier-fieldset" key={title}><legend>{title}</legend>
  <p className="supplier-subtitle">{title==='Condiciones comerciales'?'Solo para la empresa activa: estas preferencias de pago y suministro pueden ser diferentes en cada empresa.':'Compartido entre las empresas de este espacio: los cambios actualizan la ficha común del tercero, también si es cliente y proveedor.'}</p><div className="supplier-fields">{fields.filter(([key])=>!['codigo','nombre'].includes(key)).filter(([key])=>role!=='cliente'||key!=='tipo_suministro').map(field)}</div>
 </fieldset>)}
 {(step===undefined||step===1)&&<fieldset className="panel supplier-fieldset"><legend>Personas de contacto</legend><p className="supplier-subtitle">Contactos compartidos entre las empresas de este espacio. Puedes guardar sin contactos y sin principal.</p>{contacts.length===0&&<p>Sin contactos.</p>}{contacts.length>0&&<label><input type="radio" name="contacto_principal" checked={principal===-1} onChange={()=>onChange({...draft,principal:-1})}/>Sin contacto principal</label>}{contacts.map((contact,index)=><div className="supplier-contact" key={index}>
  <div className="supplier-contact-heading"><h3>Contacto {index+1}</h3>{<button className="secondary" type="button" aria-label={'Quitar contacto '+(index+1)} onClick={()=>remove(index)}>Quitar</button>}</div>
  <div className="supplier-fields">{[['nombre','Nombre del contacto','text',150],['cargo','Cargo','text',100],['email','Correo del contacto','email',254],['telefono','Teléfono del contacto','tel',40]].map(([key,label,type,max])=><label key={key}>{label}<input name={'contactos.'+index+'.'+key} type={type} maxLength={max} value={contact[key]||''} onChange={e=>contactChange(index,key,e.target.value)}/></label>)}</div>
  <label className="supplier-principal"><input type="radio" name="contacto_principal" disabled={!contactHasData(contact)} checked={principal===index} onChange={()=>onChange({...draft,principal:index})}/>Contacto principal</label>
 </div>)}<button className="secondary" type="button" disabled={contacts.length>=10} onClick={()=>onChange({...draft,contacts:[...contacts,blankContact()]})}>Añadir contacto</button></fieldset>}
 {(step===undefined||step===2)&&<fieldset className="panel supplier-fieldset"><legend>Observaciones</legend><p className="supplier-subtitle">Notas compartidas entre las empresas de este espacio para ambos roles.</p><label>Notas internas<textarea name="observaciones" rows={4} maxLength={2000} value={values.observaciones||''} onChange={e=>change('observaciones',e.target.value)}/></label></fieldset>}
 </div>;
}
export function SupplierSummary({data}){
 const draft=supplierFromParty(data),values=draft.values;
 const value=(key,type)=>supplierOptions[type]?.find(([v])=>v===values[key])?.[1]||values[key]||'Sin especificar';
 return <div className="supplier-sections">{supplierSections.map(([title,fields])=><section className="panel detail" key={title}><h2>{title}</h2><p className="supplier-subtitle">{title==='Condiciones comerciales'?'Preferencias de la empresa activa.':'Datos compartidos entre las empresas de este espacio.'}</p><dl>{fields.filter(([key])=>!['codigo','nombre'].includes(key)).map(([key,label,type])=><React.Fragment key={key}><dt>{label}</dt><dd>{value(key,type)}</dd></React.Fragment>)}</dl></section>)}
 <section className="panel detail"><h2>Personas de contacto</h2>{draft.contacts.length===0&&<p>Sin contactos.</p>}{draft.contacts.map((contact,index)=><div key={index}><h3>Contacto {index+1}{index===draft.principal?' · Principal':''}</h3><dl>{Object.entries(contact).map(([key,text])=><React.Fragment key={key}><dt>{{nombre:'Nombre',cargo:'Cargo',email:'Correo',telefono:'Teléfono'}[key]}</dt><dd>{text||'Sin especificar'}</dd></React.Fragment>)}</dl></div>)}</section>
 <section className="panel"><h2>Observaciones</h2><p className="supplier-notes">{values.observaciones||'Sin observaciones'}</p></section></div>;
}
