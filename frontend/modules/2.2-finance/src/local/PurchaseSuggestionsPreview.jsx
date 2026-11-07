import React,{useEffect,useState} from 'react';
import ReviewTime from './ReviewTime.jsx';

const suggestions=[
 {id:'001',node:'preview-node-a',product:'Papel para oficina DEMO',supplier:'Suministros Horizonte DEMO',stock:4,quantity:20,price:150},
 {id:'002',node:'preview-node-b',product:'Cajas para despacho DEMO',supplier:'Empaques Río Claro DEMO',stock:12,quantity:100,price:85},
 {id:'003',node:'preview-node-c',product:'Insumos de limpieza DEMO',supplier:'Limpieza Brisa DEMO',stock:3,quantity:15,price:240},
];
const money=value=>'Bs. '+value.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2});
export default function PurchaseSuggestionsPreview({nodes=[],approvedPurchases=[],onApprove,nodeReviews={},onNodeReview,nodeNotes={},onNoteChange}){
 const readId=()=>new URLSearchParams(window.location.search).get('sugerencia_demo');
 const [node,setNode]=useState(''),[id,setId]=useState(readId),[confirmed,setConfirmed]=useState(false);
 useEffect(()=>{const back=()=>{setId(readId());setConfirmed(false);};window.addEventListener('popstate',back);return()=>window.removeEventListener('popstate',back);},[]);
 const open=id=>{const url=new URL(window.location.href);if(id)url.searchParams.set('sugerencia_demo',id);else url.searchParams.delete('sugerencia_demo');window.history.pushState({},'',url);setId(id);setConfirmed(false);};
 const review=suggestions.find(s=>s.id===id),nodeDone=review&&Boolean(nodeReviews[review.id]),approved=review&&approvedPurchases.some(p=>p.source==='DEMO-SUG-'+review.id);
 const rowClick=(e,s)=>{if(e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey||e.target.closest('a,button,input,select,textarea')||window.getSelection()?.toString())return;open(s.id);};
 if(id&&!review)return <section><h1>Sugerencia no disponible</h1><button onClick={()=>open(null)}>Volver a sugerencias</button></section>;
 return <section className="purchase-summary" aria-labelledby="purchase-suggestions-title">
  <p className="purchase-summary-breadcrumb">Finanzas <span>/</span> Administración <span>/</span> Gestión de compras</p>
  <header className="purchase-summary-heading"><div>{review&&<button className="secondary" onClick={()=>open(null)}>← Volver a sugerencias</button>}<h1 id="purchase-suggestions-title">{review?'Compra sugerida · DEMO-SUG-'+review.id:'Sugerencias de compras'}</h1><p>Revisión del nodo → Jefe de compras → Compras.</p></div><span className="purchase-summary-preview">DEMO · IA no conectada</span></header>
  {!review?<>
  <form className="purchase-summary-filters" onSubmit={e=>e.preventDefault()}><label>Nodo<select aria-label="Nodo" value={node} onChange={e=>setNode(e.target.value)}><option value="">Todos los nodos</option>{nodes.map(n=><option key={n.id} value={n.id}>{n.name}</option>)}</select></label></form>
  <div className="panel"><div className="table-scroll"><table><thead><tr>{['Sugerencia','Nodo','Producto','Stock de ejemplo','Cantidad sugerida','Proveedor sugerido','Estimado','Revisión del nodo','Jefe de compras'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{suggestions.filter(s=>!node||s.node===node).map(s=>{const approvedPurchase=approvedPurchases.find(p=>p.source==='DEMO-SUG-'+s.id);const done=Boolean(approvedPurchase);return <tr key={s.id} className="demo-purchase-row" onClick={e=>rowClick(e,s)}><td><a href={'/?demo=compras&vista=sugerencias-compras&sugerencia_demo='+s.id} onClick={e=>{if(!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey){e.preventDefault();open(s.id);}}}>DEMO-SUG-{s.id}</a></td><td>{nodes.find(n=>n.id===s.node)?.name}</td><td>{s.product}</td><td>{s.stock} unidades</td><td>{s.quantity} unidades</td><td>{s.supplier}</td><td>{money(s.quantity*s.price)}</td><td>{nodeReviews[s.id]?'Revisada':'Pendiente'}{nodeReviews[s.id]&&<small className="demo-review-time"><ReviewTime value={nodeReviews[s.id].at}/></small>}</td><td>{done?'Pasada a Compras':nodeReviews[s.id]?'Pendiente':'Espera revisión del nodo'}{done&&<small className="demo-review-time"><ReviewTime value={approvedPurchase.approvedAt}/></small>}</td></tr>})}</tbody></table></div></div>
  </>:<>
   <section className="panel"><h2>Detalle de la propuesta</h2><dl className="demo-purchase-fields"><div><dt>Nodo de destino</dt><dd>{nodes.find(n=>n.id===review.node)?.name}</dd></div><div><dt>Proveedor sugerido</dt><dd>{review.supplier}</dd></div><div><dt>Origen</dt><dd>Ejemplo de reposición por stock · sin algoritmo</dd></div><div><dt>Moneda</dt><dd>Bolívares (Bs.)</dd></div></dl>
   <div className="table-scroll"><table><thead><tr>{['Producto','Stock de ejemplo','Cantidad propuesta','Unidad','Precio estimado','Total estimado'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody><tr><td>{review.product}</td><td>{review.stock}</td><td>{review.quantity}</td><td>Unidad</td><td>{money(review.price)}</td><td>{money(review.quantity*review.price)}</td></tr></tbody></table></div><p>Impuestos, descuentos y condiciones de entrega: sin definir.</p></section>
   <section className="panel demo-suggestion-review"><h2>Observaciones del Jefe de nodo</h2><label htmlFor="node-observation">Observaciones</label><textarea id="node-observation" rows={4} maxLength={2000} placeholder="Indica necesidades del nodo, prioridades o aclaraciones de esta propuesta." value={nodeDone?nodeReviews[review.id].note:nodeNotes[review.id]||''} readOnly={nodeDone} onChange={e=>onNoteChange(review.id,e.target.value)}/><p>{nodeDone?'Observaciones conservadas con la revisión del nodo.':'Opcional · se conservarán al enviar la propuesta al jefe de compras.'}</p></section>
   <section className="panel"><h2>{approved?'Revisiones completadas':nodeDone?'2. Revisión del Jefe de compras':'1. Revisión del operador del nodo'}</h2>
   <dl className="demo-purchase-fields"><div><dt>Fecha y hora · revisión del nodo</dt><dd><ReviewTime value={nodeReviews[review.id]?.at}/></dd></div><div><dt>Fecha y hora · Jefe de compras</dt><dd><ReviewTime value={approvedPurchases.find(p=>p.source==='DEMO-SUG-'+review.id)?.approvedAt}/></dd></div></dl><p className="purchase-summary-footnote">Hora local del navegador · registro DEMO.</p>
   <p>{approved?'Esta sugerencia ya pasó a Compras como borrador.':nodeDone?'Revisa la propuesta y las observaciones del Jefe de nodo antes de aprobar.':'Comprueba la necesidad, las cantidades y el destino antes de enviar al Jefe de compras.'}</p>
   {!approved&&<><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Confirmo la revisión de esta propuesta DEMO.</label><div className="actions"><button disabled={!confirmed} onClick={()=>{if(nodeDone)onApprove(review);else{onNodeReview(review);setConfirmed(false);}}}>{nodeDone?'Aprobar y pasar a Compras':'Validar y enviar al jefe de compras'}</button></div></>}
   </section>
  </>}
  <p className="purchase-summary-footnote">Stock, cantidades y precios ficticios. Dos revisiones visuales sin autenticación ni permisos reales; IA y reglas pendientes. Solo memoria de esta pestaña: al recargar se pierden observaciones, revisiones y borradores. No se envían órdenes ni se genera deuda.</p>
 </section>;
}
