import React,{useState} from 'react';
export const purchaseKinds={
 'solicitudes-compra':{title:'Solicitudes de compra',singular:'solicitud',api:'solicitudes'},
 'ordenes-compra':{title:'Órdenes de compra',singular:'orden',api:'ordenes',source:'solicitudes',sourceLabel:'Solicitud de origen'},
 'facturas-proveedores':{title:'Facturas de proveedores',singular:'factura',api:'facturas',source:'ordenes',sourceLabel:'Orden de origen'},
};
const day=()=>new Date().toLocaleDateString('en-CA');
export function emptyPurchase(base){return {proveedor_id:'',origen_id:'',fecha:day(),numero:'',serie:'',moneda:base,tipo_cambio:'1',cambio_fecha:day(),cambio_fuente:'misma moneda',lineas:[{descripcion:'',cantidad:'1',precio_unitario:'0'}]};}
export function purchasePayload(row){return Object.fromEntries(['proveedor_id','origen_id','fecha','numero','serie','moneda','tipo_cambio','cambio_fecha','cambio_fuente','lineas'].map(k=>[k,k==='lineas'?row.lineas.map(l=>({descripcion:l.descripcion,cantidad:l.cantidad,precio_unitario:l.precio_unitario})):row[k]??'']));}

export default function PurchaseForm({kind,draft,setDraft,options,sources,onSource,moreSuppliers,moreSources,save,busy,cancel,editing}){
 const [loadingSource,setLoadingSource]=useState(false);
 const update=(key,value)=>setDraft(d=>({...d,[key]:value}));
 const line=(index,key,value)=>setDraft(d=>({...d,lineas:d.lineas.map((l,i)=>i===index?{...l,[key]:value}:l)}));
 return <form className="supplier-form purchase-form" onSubmit={save}>
  <section className="panel"><h2>Datos del borrador</h2><div className="supplier-fields">
   {kind.source&&<label>{kind.sourceLabel}<select aria-label={kind.sourceLabel} required disabled={editing||busy||loadingSource} value={draft.origen_id} onChange={async e=>{setLoadingSource(true);try{await onSource(e.target.value);}finally{setLoadingSource(false);}}}><option value="">Selecciona el documento</option>{sources.map(s=><option key={s.id} value={s.id}>{s.numero||s.id} · {s.proveedor} · {s.moneda} {s.total}</option>)}</select></label>}
   {kind.source&&moreSources&&<button type="button" className="secondary" disabled={busy} onClick={moreSources}>Cargar más documentos</button>}
   <label>Proveedor<select aria-label="Proveedor" required value={draft.proveedor_id} disabled={Boolean(kind.source)||busy} onChange={e=>update('proveedor_id',e.target.value)}><option value="">Selecciona un proveedor</option>{options.proveedores.map(s=><option key={s.id} value={s.id}>{s.codigo} · {s.nombre}</option>)}</select></label>
   {moreSuppliers&&<button type="button" className="secondary" disabled={busy} onClick={moreSuppliers}>Cargar más proveedores</button>}
   <label>Fecha<input required type="date" value={draft.fecha} onChange={e=>update('fecha',e.target.value)}/></label>
   <label>Referencia / número<input maxLength={80} value={draft.numero} onChange={e=>update('numero',e.target.value)} placeholder="Referencia del borrador"/></label>
   <label>Serie<input maxLength={40} value={draft.serie} onChange={e=>update('serie',e.target.value)}/></label>
   <label>Moneda<select aria-label="Moneda" required value={draft.moneda} disabled={Boolean(kind.source)} onChange={e=>{const same=e.target.value===options.moneda_base;setDraft(d=>({...d,moneda:e.target.value,tipo_cambio:same?'1':'',cambio_fuente:same?'misma moneda':''}));}}>{options.monedas.map(m=><option key={m.codigo}>{m.codigo}</option>)}</select></label>
   <label>Tipo de cambio a {options.moneda_base}<input required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,12})?" value={draft.tipo_cambio} readOnly={draft.moneda===options.moneda_base} onChange={e=>update('tipo_cambio',e.target.value)}/></label>
   <label>Fecha del cambio<input type="date" required value={draft.cambio_fecha} onChange={e=>update('cambio_fecha',e.target.value)}/></label>
   <label>Fuente del cambio<input required maxLength={120} value={draft.cambio_fuente} onChange={e=>update('cambio_fuente',e.target.value)}/></label>
  </div></section>
  <section className="panel"><h2>Detalles</h2><p className="muted">Importes en {draft.moneda}. Usa punto decimal. El servidor calcula el total y valida la precisión de la moneda; no se calculan impuestos.</p>
   {draft.lineas.map((l,i)=><fieldset key={i}><legend>Línea {i+1}</legend><div className="supplier-fields">
    <label>Descripción<input required maxLength={500} value={l.descripcion} onChange={e=>line(i,'descripcion',e.target.value)}/></label>
    <label>Cantidad<input required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,6})?" value={l.cantidad} onChange={e=>line(i,'cantidad',e.target.value)}/></label>
    <label>Precio unitario<input required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,6})?" value={l.precio_unitario} onChange={e=>line(i,'precio_unitario',e.target.value)}/></label>
    <button type="button" className="secondary" disabled={draft.lineas.length===1||busy} onClick={()=>setDraft(d=>({...d,lineas:d.lineas.filter((_,j)=>j!==i)}))}>Quitar línea {i+1}</button>
   </div></fieldset>)}
   <button type="button" className="secondary" disabled={draft.lineas.length>=100||busy} onClick={()=>setDraft(d=>({...d,lineas:[...d.lineas,{descripcion:'',cantidad:'1',precio_unitario:'0'}]}))}>Añadir línea</button>
  </section>
  <p className="notice">Se guarda un borrador. No aprueba, emite, mueve inventario ni crea cuentas por pagar.</p>
  <div className="actions"><button disabled={busy||loadingSource}>{busy?'Guardando…':'Guardar borrador'}</button><button type="button" className="secondary" disabled={busy} onClick={cancel}>Cancelar</button></div>
 </form>;
}
