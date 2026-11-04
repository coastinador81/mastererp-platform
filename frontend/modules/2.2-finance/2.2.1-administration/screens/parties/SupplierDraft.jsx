import React, {useState} from 'react';
const sections = [
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
    ['moneda','Moneda preferida (código de tres letras)','currency',3],
    ['condicion_pago','Condición de pago','terms',30],['plazo_pago_dias','Plazo de pago en días','days',5],
    ['medio_pago','Medio de pago preferido','payment',30],
    ['descuento_pronto_pago','Descuento por pronto pago (%)','percent',10],
    ['plazo_pronto_pago_dias','Plazo de pronto pago en días','days',5],
  ]],
];
const options = {
  person:[['natural','Persona natural'],['juridica','Persona jurídica']],
  terms:[['contado','Contado'],['credito','Crédito'],['por_acordar','Por acordar']],
  payment:[['transferencia','Transferencia bancaria'],['efectivo','Efectivo'],['tarjeta','Tarjeta'],['otro','Otro']],
};
const blankContact=()=>({nombre:'',cargo:'',email:'',telefono:''});
export default function SupplierDraft() {
  const [values,setValues]=useState({}),[contacts,setContacts]=useState([blankContact()]),[principal,setPrincipal]=useState(0);
  const [review,setReview]=useState(false),[error,setError]=useState('');
  const change=(name,value)=>{setValues(v=>({...v,[name]:value}));setError('');};
  const contactChange=(index,name,value)=>setContacts(rows=>rows.map((row,i)=>i===index?{...row,[name]:value}:row));
  const removeContact=index=>{setContacts(rows=>rows.filter((_,i)=>i!==index));setPrincipal(previous=>previous===index?0:previous>index?previous-1:previous);};
  const submit=event=>{
    event.preventDefault();
    if(!values.codigo?.trim()||!values.nombre?.trim()){setError('Completa el código y la razón social o nombre.');return;}
    if(Boolean(values.descuento_pronto_pago)!==Boolean(values.plazo_pronto_pago_dias)){
      setError('Indica juntos el descuento por pronto pago y su plazo, o deja ambos vacíos.');return;
    }
    setError('');setReview(true);window.scrollTo({top:0,behavior:'smooth'});
  };
  const field=([name,label,type,maximum,required,placeholder])=><label key={name}>
    {label}{required?' *':''}
    {options[type]?<select name={name} value={values[name]||''} onChange={e=>change(name,e.target.value)}>
      <option value="">Sin especificar</option>{options[type].map(([value,text])=><option key={value} value={value}>{text}</option>)}
    </select>:<input name={name} value={values[name]||''} required={Boolean(required)} maxLength={maximum}
      type={['days','percent'].includes(type)?'number':['country','currency'].includes(type)?'text':type}
      min={['days','percent'].includes(type)?'0':undefined} max={type==='percent'?'100':undefined}
      step={type==='days'?'1':type==='percent'?'0.000001':undefined}
      pattern={type==='country'?'[A-Z]{2}':type==='currency'?'[A-Z]{3}':name==='sitio_web'?'https?://.*':undefined}
      placeholder={placeholder} onChange={e=>change(name,['country','currency'].includes(type)?e.target.value.toUpperCase():e.target.value)}/>}</label>;
  const textValue=(name,type)=>options[type]?.find(([value])=>value===values[name])?.[1]||values[name]||'Sin especificar';
  return <section aria-labelledby="supplier-draft-title" className="supplier-draft">
    <div className="page-heading"><div><p className="eyebrow">Administración / Gestión de compras</p>
      <h1 id="supplier-draft-title">{review?'Revisar proveedor':'Ficha de proveedor'}</h1></div><a href="/">Volver a Administración</a></div>
    <p className="notice" role="status">Ficha en desarrollo. Los datos permanecen solo en esta página y no se guardan. Al recargar o salir se perderán.</p>
    {error&&<p className="notice error" role="alert">{error}</p>}
    {review?<><div className="supplier-sections">{sections.map(([title,fields])=><section className="panel detail" key={title}>
      <h2>{title}</h2><dl>{fields.map(([name,label,type])=><React.Fragment key={name}><dt>{label}</dt><dd>{textValue(name,type)}</dd></React.Fragment>)}</dl>
      </section>)}<section className="panel detail"><h2>Personas de contacto</h2>{contacts.map((contact,index)=><div key={index}>
        <h3>Contacto {index+1}{principal===index?' · Principal':''}</h3><dl>{Object.entries(contact).map(([key,value])=><React.Fragment key={key}><dt>{{nombre:'Nombre',cargo:'Cargo',email:'Correo',telefono:'Teléfono'}[key]}</dt><dd>{value||'Sin especificar'}</dd></React.Fragment>)}</dl>
      </div>)}</section><section className="panel"><h2>Observaciones</h2><p className="supplier-notes">{values.observaciones||'Sin observaciones'}</p></section></div>
      <div className="actions"><button type="button" onClick={()=>setReview(false)}>Volver a editar</button></div></>:
    <form onSubmit={submit} autoComplete="off">
      <p className="muted">* Campos obligatorios. Los demás datos pueden completarse progresivamente.</p>
      <div className="supplier-sections">{sections.map(([title,fields])=><fieldset className="panel supplier-fieldset" key={title}>
        <legend>{title}</legend><div className="supplier-fields">{fields.map(field)}</div>
        {title==='Condiciones comerciales'&&<p className="muted">Se registran como propuesta; esta ficha no calcula impuestos, concede crédito ni ejecuta pagos.</p>}
      </fieldset>)}
      <fieldset className="panel supplier-fieldset"><legend>Personas de contacto</legend>
        {contacts.map((contact,index)=><div className="supplier-contact" key={index}><div className="supplier-contact-heading"><h3>Contacto {index+1}</h3>
          {contacts.length>1&&<button className="secondary" type="button" aria-label={'Quitar contacto '+(index+1)} onClick={()=>removeContact(index)}>Quitar</button>}</div>
          <div className="supplier-fields">{[['nombre','Nombre del contacto','text',150],['cargo','Cargo','text',100],['email','Correo del contacto','email',254],['telefono','Teléfono del contacto','tel',40]].map(([name,label,type,max])=><label key={name}>{label}<input name={'contactos.'+index+'.'+name} type={type} maxLength={max} value={contact[name]} onChange={e=>contactChange(index,name,e.target.value)}/></label>)}</div>
          <label className="supplier-principal"><input type="radio" name="contacto_principal" checked={principal===index} onChange={()=>setPrincipal(index)}/>Contacto principal</label>
        </div>)}
        <button className="secondary" type="button" disabled={contacts.length>=10} onClick={()=>setContacts(rows=>[...rows,blankContact()])}>Añadir contacto</button>
      </fieldset>
      <fieldset className="panel supplier-fieldset"><legend>Observaciones</legend><label>Notas internas<textarea name="observaciones" maxLength={2000} value={values.observaciones||''} onChange={e=>change('observaciones',e.target.value)} rows={4}/></label></fieldset>
      </div><div className="actions"><button type="submit">Revisar ficha</button></div>
    </form>}
  </section>;
}
