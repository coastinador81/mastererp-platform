import React from 'react';
import './customerProfile.css';

const labels={contado:'Contado',credito:'Crédito',por_acordar:'Por acordar',transferencia:'Transferencia bancaria',efectivo:'Efectivo',tarjeta:'Tarjeta',otro:'Otro'};
const show=value=>value===undefined||value===null||value===''?'Sin especificar':String(value);
function Group({title,description,entries}){
 return <section className="panel detail"><h2>{title}</h2>{description&&<p className="muted">{description}</p>}<dl>{entries.map(([label,value])=><React.Fragment key={label}><dt>{label}</dt><dd>{show(value)}</dd></React.Fragment>)}</dl></section>;
}
export default function CustomerOverview({data}){
 const general=data.datos_generales||{},terms=data.condiciones||{};
 return <div className="supplier-sections customer-overview">
  <section className="panel"><h2>Relación administrativa</h2><p>Origen: {data.origen==='ecommerce'?'eCommerce':'Sin canal de origen identificado'}. La ficha fiscal y de contacto es común a Clientes y Proveedores; las condiciones son específicas de la empresa activa y del rol.</p></section>
  <Group title="Identificación administrativa" description="Código y nombre pertenecen al tercero común. La información fiscal disponible se muestra sin validación ante organismos externos." entries={[
   ['Nombre comercial',general.nombre_comercial],['Tipo de persona',({natural:'Persona natural',juridica:'Persona jurídica'})[general.tipo_persona]],['País fiscal',general.pais_fiscal],['Tipo de identificación',general.tipo_identificacion],['Identificación fiscal',general.numero_identificacion],
  ]}/>
  <Group title="Contacto administrativo" description="Información disponible en la ficha actual. Las direcciones de entrega del eCommerce no se consideran direcciones fiscales automáticamente." entries={[
   ['Correo administrativo',general.email],['Teléfono',general.telefono],['Teléfono alternativo',general.telefono_alterno],['Dirección administrativa',general.direccion],['Complemento',general.direccion_complementaria],['Ciudad',general.ciudad],['Municipio',general.municipio],['Estado o provincia',general.region],['Código postal',general.codigo_postal],['País',general.pais],
  ]}/>
  <Group title="Condiciones comerciales" description="Datos del perfil de cliente de la empresa activa. Son preferencias registradas; no conceden crédito ni aplican descuentos por sí solas." entries={[
   ['Moneda preferida',terms.moneda],['Condición de pago',labels[terms.condicion_pago]||terms.condicion_pago],['Plazo de pago (días)',terms.plazo_pago_dias],['Medio de pago',labels[terms.medio_pago]||terms.medio_pago],['Descuento por pronto pago (%)',terms.descuento_pronto_pago],['Plazo de pronto pago (días)',terms.plazo_pronto_pago_dias],
  ]}/>
  <section className="panel detail"><h2>Personas de contacto</h2>{data.contactos?.length?data.contactos.map((contact,index)=><dl key={index}><dt>Contacto {index+1}{contact.principal?' · Principal':''}</dt><dd>{[contact.nombre,contact.cargo,contact.email,contact.telefono].filter(Boolean).join(' · ')}</dd></dl>):<p>Sin contactos administrativos registrados.</p>}</section>
  {data.contacto_ecommerce&&<Group title="Referencia de eCommerce" description="Datos de la cuenta del canal, solo para consulta. No sustituyen los datos fiscales ni se modifican desde esta ficha." entries={[['Correo de la cuenta',data.contacto_ecommerce.email],['Teléfono del canal',data.contacto_ecommerce.telefono]]}/>}
  <section className="panel"><h2>Notas administrativas</h2><p className="supplier-notes">{general.observaciones||'Sin observaciones'}</p></section>
  <section className="panel"><h2>Situación financiera y documentos</h2><p>La consulta integrada de saldos, vencimientos, anticipos, facturas y cobros está pendiente de conectar. Esta ficha no muestra importes simulados.</p></section>
 </div>;
}
