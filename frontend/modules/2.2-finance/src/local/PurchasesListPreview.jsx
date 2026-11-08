import React,{useEffect,useState} from 'react';
import PurchasesFilters from './PurchasesFilters.jsx';
import ReviewTime from './ReviewTime.jsx';
import SuggestionComparison from './SuggestionComparison.jsx';

// Fixtures exclusivas del montaje local DEV; nunca respaldo del servicio.
const demoPurchases=[
 ['001','2026-11-07','a','Suministros Horizonte DEMO','Material de oficina','VES',18450.50,'Borrador'],
 ['002','2026-11-06','b','Empaques Río Claro DEMO','Empaques para despacho','VES',32800,'Borrador'],
 ['003','2026-11-05','c','Tecnología Andina DEMO','Mantenimiento de equipos','VES',12500.75,'Borrador'],
 ['004','2026-11-04','a','Limpieza Brisa DEMO','Insumos de limpieza','VES',6840,'Borrador'],
 ['005','2026-11-03','b','Servicios Contables Aurora DEMO','Servicio administrativo','VES',22100,'Borrador'],
 ['006','2026-11-02','c','Logística Ruta Azul DEMO','Material de embalaje','VES',9700.25,'Borrador'],
 ['007','2026-11-01','a','Tecnología Andina DEMO','Accesorios informáticos','USD',245.50,'Borrador'],
 ['008','2026-10-30','b','Empaques Río Claro DEMO','Cajas de cartón','USD',680,'Borrador'],
 ['009','2026-10-29','c','Suministros Horizonte DEMO','Consumibles de oficina','USD',132.75,'Borrador'],
 ['010','2026-11-06','a','Mantenimiento Faro DEMO','Repuestos de mantenimiento','EUR',320,'Borrador'],
 ['011','2026-11-04','b','Soluciones Integrales Nube DEMO','Servicio técnico','EUR',185.50,'Borrador'],
 ['012','2026-10-28','c','Limpieza Brisa DEMO','Utensilios de limpieza','EUR',96.20,'Borrador'],
].map(([id,date,node,supplier,concept,currency,total,status])=>({reference:'DEMO-COM-'+id,date,node:'preview-node-'+node,supplier,concept,currency,total,status}));
const orderStatuses=['Borrador','Pendiente de aprobación','En tránsito','Completado','Recibida parcialmente','Aprobada','Enviada al proveedor','Cancelada'];
const statusTone=status=>({'Completado':'success','Aprobada':'success','En tránsito':'info','Enviada al proveedor':'info','Recibida parcialmente':'warning','Pendiente de aprobación':'warning','Cancelada':'danger'}[status]||'neutral');
const normalize=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const money=value=>value.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2});
const dateLabel=value=>value.split('-').reverse().join('/');
const empty={node:'',from:'',to:'',currency:'VES',search:'',status:''};
function DetailFields({items}){return <dl className="demo-purchase-fields">{items.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;}
function PurchaseDetail({purchase,nodes,back,orders=false}){
 const title=orders?'Órdenes de compra':'Compras';
 if(!purchase)return <section><h1>Documento no disponible</h1><p>La referencia no corresponde a un documento DEMO.</p><button className="secondary" onClick={back}>Volver a {title}</button></section>;
 const currency=purchase.currency==='VES'?'Bs.':purchase.currency;
 const cents=Math.round(purchase.total*100),first=Math.floor(cents*.6),second=cents-first;
 const service=/servicio|mantenimiento/i.test(purchase.concept);
 const lines=purchase.suggestion?[{code:'DEMO-STOCK-'+purchase.suggestion.id,description:purchase.concept,quantity:purchase.suggestion.quantity,price:purchase.suggestion.price,amount:purchase.total}]:[{code:'DEMO-ITEM-01',description:purchase.concept,amount:first/100},{code:'DEMO-ITEM-02',description:service?'Servicio complementario DEMO':'Suministros complementarios DEMO',amount:second/100}];
 return <section className="purchase-summary demo-purchase-detail" aria-labelledby="purchase-detail-title">
  <p className="purchase-summary-breadcrumb">Finanzas <span>/</span> Administración <span>/</span> Gestión de compras <span>/</span> {title}</p>
  <header className="purchase-summary-heading"><div><button className="secondary" onClick={back}>← Volver a {title}</button><h1 id="purchase-detail-title">{purchase.reference}</h1><p>{purchase.concept}</p></div><span className="purchase-summary-preview">Datos ficticios · {purchase.status}</span></header>
  <div className="demo-purchase-detail-grid">
   <section className="panel"><h2>Información general</h2><DetailFields items={[
    ['Referencia',purchase.reference],['Estado',purchase.status],[orders?'Fecha de la orden':'Fecha de compra',dateLabel(purchase.date)],['Empresa','Empresa de ejemplo DEMO'],['Nodo',nodes.find(node=>node.id===purchase.node)?.name||'Nodo de ejemplo'],['Responsable','Comprador de ejemplo DEMO'],['Origen',purchase.source||'Registro manual DEMO'],['Moneda',currency],['Tipo de cambio','Sin definir · no se convierte a moneda base'],['Versión','1 · ejemplo visual']
   ]}/></section>
   <section className="panel"><h2>Proveedor</h2><DetailFields items={[
    ['Nombre',purchase.supplier],['Código interno','DEMO-PROV-'+purchase.reference.slice(-3)],['Identificación fiscal','DEMO · no válida para uso fiscal'],['Dirección','Dirección de ejemplo · sin datos reales'],['Contacto','Contacto de compras DEMO'],['Correo','compras@example.invalid'],['Teléfono','No especificado']
   ]}/></section>
  </div>
  <section className="panel"><h2>Productos y servicios</h2><div className="table-scroll"><table><thead><tr>{['Código','Descripción','Tipo','Cantidad','Unidad','Precio unitario','Descuento','Impuestos','Total'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{lines.map(line=><tr key={line.code}><td>{line.code}</td><td>{line.description}</td><td>{service?'Servicio':'Producto'}</td><td>{line.quantity||1}</td><td>{service?'Servicio':'Unidad'}</td><td>{currency} {money(line.price??line.amount)}</td><td>Sin definir</td><td>Sin definir</td><td>{currency} {money(line.amount)}</td></tr>)}</tbody></table></div><p className="purchase-summary-footnote">{purchase.suggestion?'Valores finales de la propuesta revisada.':'Distribución ilustrativa del importe.'} Descuentos e impuestos sin configurar; no se asumen tasas ni reglas fiscales.</p></section>
  <div className="demo-purchase-detail-grid">
   <section className="panel"><h2>Condiciones y entrega</h2><DetailFields items={[
    ['Forma de pago','Pendiente de acordar'],['Plazo y vencimiento','Sin definir'],['Pronto pago','Sin condiciones definidas'],['Entrega prevista','Sin programar'],['Destino',nodes.find(node=>node.id===purchase.node)?.name||'Nodo de ejemplo'],['Dirección de entrega','Por confirmar'],['Recepción',orders?'Consultar detalle de recepción · no conectado':'No registrada'],['Reserva financiera','No vinculada']
   ]}/></section>
   <section className="panel"><h2>Resumen de importes</h2><DetailFields items={[
    ['Importe de líneas',currency+' '+money(purchase.total)],['Descuentos','Sin definir'],['Impuestos y otros cargos','Sin definir'],['Total de ejemplo',currency+' '+money(purchase.total)],['Importe en moneda base','Sin calcular'],['Cuenta por pagar','No generada'],['Pagos','No registrados']
   ]}/><p className="purchase-summary-footnote">Esta ficha no genera deuda, pagos, reservas ni movimientos de inventario.</p></section>
  </div>
  <section className="panel"><h2>Documentos relacionados y soportes</h2><DetailFields items={[
   ['Compra de origen',purchase.source||'No vinculada'],['Orden de compra',orders?purchase.reference:'No vinculada'],['Factura de proveedor','No vinculada'],['Recepciones','Sin documentos'],['Notas de crédito y devoluciones','Sin documentos'],['Archivos adjuntos','Sin archivos']
  ]}/></section>
  {purchase.originalProposal&&<SuggestionComparison original={purchase.originalProposal} node={purchase.nodeProposal} final={purchase.suggestion}/>}
  <section className="panel"><h2>Observaciones y trazabilidad</h2><p>Compra ficticia para revisar la ficha y su navegación. No representa una operación real.</p><DetailFields items={[
   ['Creado por','Usuario DEMO'],['Fecha de ejemplo',dateLabel(purchase.date)],['Última modificación','Sin modificaciones'],['Aprobación',purchase.suggestion?'Jefe de nodo + Jefe de compras · DEMO sin identidad autenticada':orders?'Estado ilustrativo · sin aprobación real':'Sin registrar'],['Fecha y hora · revisión del nodo DEMO',purchase.suggestion?<ReviewTime value={purchase.nodeReviewedAt}/>:'No aplica'],['Observaciones del Jefe de nodo',purchase.nodeObservation||'Sin observaciones'],['Observaciones del Jefe de compras',purchase.purchasingObservation||'Sin observaciones'],['Prioridad',purchase.priority?'Prioritaria':'Normal'],['Fecha y hora · Jefe de compras DEMO',purchase.suggestion?<ReviewTime value={purchase.approvedAt}/>:'No aplica']
  ]}/></section>
 </section>;
}
export default function PurchasesListPreview({nodes=[],kind='purchases',approvedPurchases=[]}){
 const orders=kind==='orders',title=orders?'Órdenes de compra':'Compras',route=orders?'ordenes-compra':'solicitudes-compra',detailParam=orders?'orden_demo':'compra_demo';
 const documents=orders?demoPurchases.map((row,index)=>({...row,status:orderStatuses[index%orderStatuses.length],source:row.reference,reference:row.reference.replace('COM','OC')})):[...approvedPurchases,...demoPurchases];
 const [draft,setDraft]=useState({...empty}),[filters,setFilters]=useState({...empty}),[error,setError]=useState('');
 const readPurchase=()=>new URLSearchParams(window.location.search).get(detailParam);
 const [selected,setSelected]=useState(readPurchase);
 useEffect(()=>{const back=()=>setSelected(readPurchase());window.addEventListener('popstate',back);return()=>window.removeEventListener('popstate',back);},[]);
 const openPurchase=reference=>{const url=new URL(window.location.href);if(reference)url.searchParams.set(detailParam,reference);else url.searchParams.delete(detailParam);window.history.pushState({},'',url);setSelected(reference);};
 const rowClick=(event,reference)=>{if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.target.closest('a,button,input,select,textarea')||window.getSelection()?.toString())return;openPurchase(reference);};
 const purchase=documents.find(row=>row.reference===selected);
 const rows=documents.filter(row=>(!filters.node||row.node===filters.node)&&(!filters.from||row.date>=filters.from)&&(!filters.to||row.date<=filters.to)&&row.currency===filters.currency&&(!filters.status||row.status===filters.status)&&normalize([row.reference,row.supplier,row.concept].join(' ')).includes(normalize(filters.search.trim())));
 const change=(name,value)=>{const next={...draft,[name]:value};setDraft(next);if(!orders){if(next.from&&next.to&&next.to<next.from){setError('La fecha hasta debe ser igual o posterior a la fecha desde.');return;}setFilters(next);}setError('');};
 const suggestionRows=documents.filter(row=>(!draft.node||row.node===draft.node)&&(!draft.from||row.date>=draft.from)&&(!draft.to||row.date<=draft.to)&&row.currency===draft.currency&&(!draft.status||row.status===draft.status));
 const suggestions=[...new Set(suggestionRows.flatMap(row=>[row.supplier,row.reference,row.concept]))].filter(value=>normalize(value).includes(normalize(draft.search.trim()))).slice(0,6);
 const apply=event=>{event.preventDefault();if(draft.from&&draft.to&&draft.to<draft.from){setError('La fecha hasta debe ser igual o posterior a la fecha desde.');return;}setFilters({...draft});};
 if(selected)return <PurchaseDetail orders={orders} purchase={purchase} nodes={nodes} back={()=>openPurchase(null)}/>;
 return <section className="purchase-summary" aria-labelledby="purchases-list-title">
  <p className="purchase-summary-breadcrumb">Finanzas <span>/</span> Administración <span>/</span> Gestión de compras</p>
  <header className="purchase-summary-heading"><div><h1 id="purchases-list-title">{title}</h1><p>{orders?'Consulta las órdenes, sus proveedores y destinos de entrega.':'Consulta las compras y su estado por nodo.'}</p></div>{orders&&<span className="purchase-summary-preview">Vista local · Datos ficticios</span>}</header>
  {!orders?<PurchasesFilters draft={draft} onChange={change} error={error} nodes={nodes} suggestions={suggestions} statuses={[...new Set(documents.map(row=>row.status))]}/>:<form className="purchase-summary-filters" onSubmit={apply} noValidate aria-label="Filtros de compras">
   <div className="purchase-filter-fields">
    <label>Nodo<select aria-label="Nodo" value={draft.node} onChange={e=>change('node',e.target.value)}><option value="">Todos los nodos</option>{nodes.map(node=><option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
    <label>Fecha desde<input type="date" value={draft.from} onChange={e=>change('from',e.target.value)}/></label>
    <label>Fecha hasta<input type="date" min={draft.from||undefined} value={draft.to} onChange={e=>change('to',e.target.value)}/></label>
    <label>Moneda<select aria-label="Moneda" value={draft.currency} onChange={e=>change('currency',e.target.value)}><option value="VES">Bolívares (Bs.)</option><option value="USD">Dólares (USD)</option><option value="EUR">Euros (EUR)</option></select></label>
   </div>
   <label>{orders?'Buscar orden':'Buscar compra'}<input type="search" placeholder="Referencia, proveedor o concepto" value={draft.search} onChange={e=>change('search',e.target.value)}/></label>
   {orders&&<label>Estado<select aria-label="Estado" value={draft.status} onChange={e=>change('status',e.target.value)}><option value="">Todos los estados</option>{orderStatuses.map(status=><option key={status} value={status}>{status}</option>)}</select></label>}
   {error&&<p role="alert">{error}</p>}
   <div className="actions"><button type="submit">Aplicar</button><button type="button" className="secondary" onClick={()=>{setDraft({...empty});setFilters({...empty});setError('');}}>Restablecer</button></div>
  </form>}
  {orders&&<p className="purchase-summary-scope" role="status">{nodes.find(n=>n.id===filters.node)?.name||'Todos los nodos'} · {filters.from||'Sin fecha inicial'} — {filters.to||'Sin fecha final'} · {filters.currency==='VES'?'Bs.':filters.currency}{filters.search?' · Búsqueda: '+filters.search:''}</p>}
  <div className="panel"><div className="table-scroll"><table><caption className="demo-purchase-table-caption">{title}</caption><thead><tr>{['Referencia','Fecha','Nodo','Proveedor','Concepto','Moneda','Importe total','Estado',...(orders?['Compra de origen','Entrega prevista']:[])].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.reference} className="demo-purchase-row" onClick={event=>rowClick(event,row.reference)}><td><a href={'/?demo=compras&vista='+route+'&'+detailParam+'='+row.reference} onClick={event=>{if(!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey){event.preventDefault();openPurchase(row.reference);}}}>{row.reference}</a></td><td>{row.date.split('-').reverse().join('/')}</td><td>{nodes.find(node=>node.id===row.node)?.name||'Nodo de ejemplo'}</td><td>{row.supplier}</td><td>{row.concept}</td><td>{row.currency==='VES'?'Bs.':row.currency}</td><td>{row.total.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td><span className={'demo-order-status demo-order-status-'+statusTone(row.status)}>{row.status}</span></td>{orders&&<><td>{row.source}</td><td>Sin programar</td></>}</tr>)}{!rows.length&&<tr><td colSpan={orders?10:8} className="empty">No hay documentos DEMO que coincidan con los filtros.</td></tr>}</tbody></table></div>
   <div className={'pagination '+(!orders?'demo-purchase-pagination':'')}><span>{rows.length} {orders?'órdenes':'compras'} ficticias · Vista local</span><div className="demo-purchase-pagination-buttons"><button className="secondary" disabled>Anterior</button><button className="secondary" disabled>Siguiente</button></div></div>
  </div>
  {orders&&<p className="purchase-summary-footnote">Datos DEMO ficticios únicamente para revisar el diseño local. Los filtros actúan sobre estos ejemplos, sin consultas ni persistencia. No representan compras, estados ni saldos reales.</p>}
 </section>;
}
