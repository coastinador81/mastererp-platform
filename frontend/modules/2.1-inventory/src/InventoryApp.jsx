import React,{useEffect,useRef,useState} from 'react';
import ModuleLauncher from '../../../shared/module-launcher/ModuleLauncher.jsx';
import RelatedServicesRail from '../../../shared/module-launcher/RelatedServicesRail.jsx';
import UonifyChatLink from '../../2.2-finance/src/UonifyChatLink.jsx';
import FinanceIcon from '../../2.2-finance/src/FinanceIcon.jsx';

const groups=[
 {name:'Existencias',icon:'inventory',items:[['existencias','Por producto'],['existencias-sucursal','Por sucursal']]},
 {name:'Movimientos',icon:'movements',items:[['entradas','Entradas'],['salidas','Salidas'],['transferencias','Transferencias']]},
 {name:'Recepciones',icon:'receipt',items:[['recepciones-pendientes','Pendientes'],['recepciones-recibidas','Recibidas']]},
 {name:'Conteos y ajustes',icon:'count',items:[['conteos','Conteos físicos'],['ajustes','Ajustes']]},
];
const pages={
 resumen:{title:'Resumen',description:'Indicadores generales del inventario.'},
 existencias:{title:'Existencias por producto',description:'Consulta stock físico, reservado y disponible.',columns:['Código','Producto','Unidad','Stock físico','Reservado','Disponible']},
 'existencias-sucursal':{title:'Existencias por sucursal',description:'La consulta por sucursal estará disponible al activar Nodos en Ecommerce.',nodes:true},
 entradas:{title:'Entradas',description:'Consulta los ingresos de productos y sus documentos de origen.',columns:['Referencia','Fecha','Producto','Cantidad','Origen','Estado']},
 salidas:{title:'Salidas',description:'Consulta las salidas de productos y su documento de origen.',columns:['Referencia','Fecha','Producto','Cantidad','Destino','Estado']},
 transferencias:{title:'Transferencias',description:'Las transferencias entre sucursales requieren la capacidad Nodos.',nodes:true},
 'recepciones-pendientes':{title:'Recepciones pendientes',description:'Recibe los productos de las órdenes de compra autorizadas.',columns:['Orden de compra','Proveedor','Entrega prevista','Líneas pendientes','Estado']},
 'recepciones-recibidas':{title:'Recepciones recibidas',description:'Consulta las recepciones y sus documentos de origen.',columns:['Recepción','Fecha','Orden de compra','Proveedor','Estado']},
 conteos:{title:'Conteos físicos',description:'Compara las existencias registradas con las cantidades contadas.',columns:['Referencia','Fecha','Alcance','Responsable','Estado']},
 ajustes:{title:'Ajustes',description:'Consulta diferencias de inventario con su motivo y trazabilidad.',columns:['Referencia','Fecha','Producto','Diferencia','Motivo','Estado']},
 configuracion:{title:'Configuración',description:'Parámetros y capacidades del inventario.'},
};
const mockInventoryNodes=[
 {id:'central',name:'Nodo Centro',inventory:48500,supplierDebt:19750,good:46500,damaged:2000},
 {id:'north',name:'Nodo Norte',inventory:32750,supplierDebt:13900,good:31400,damaged:1350},
 {id:'south',name:'Nodo Sur',inventory:68900,supplierDebt:27600,good:66000,damaged:2900},
];
const mockTacticalItems=[
 {id:'yogur-natural',product:'Yogur natural 500 g',nodeId:'central',node:'Nodo Centro',priority:'Urgente',expiry:'16 nov 2026 · 2 días',daysToExpiry:2,stock:8,minimum:20,rotation:5.8,consumption:88,coverage:2,action:'Revisar lote y reponer'},
 {id:'leche-uht',product:'Leche UHT 1 L',nodeId:'north',node:'Nodo Norte',priority:'Alta',expiry:'18 nov 2026 · 4 días',daysToExpiry:4,stock:14,minimum:24,rotation:4.2,consumption:74,coverage:5,action:'Reponer hoy'},
 {id:'queso-semicurado',product:'Queso semicurado 250 g',nodeId:'south',node:'Nodo Sur',priority:'Alta',expiry:'20 nov 2026 · 6 días',daysToExpiry:6,stock:12,minimum:18,rotation:3.6,consumption:69,coverage:7,action:'Aplicar FEFO y reponer'},
];
const mockProductRecords=[
 {id:'yogur-natural',sku:'LAC-001',name:'Yogur natural 500 g',category:'Lácteos',unit:'unidad',unitCost:10,expiryDays:2,expiry:'16 nov 2026',coverage:2,nodes:{central:{physical:200,reserved:10,minimum:220},north:{physical:125,reserved:3,minimum:160},south:{physical:300,reserved:10,minimum:320}},sales:[{nodeId:'central',date:'2025-11-04',quantity:1200},{nodeId:'central',date:'2026-10-12',quantity:1150},{nodeId:'north',date:'2025-08-19',quantity:740},{nodeId:'north',date:'2026-10-29',quantity:820},{nodeId:'south',date:'2024-05-20',quantity:1800},{nodeId:'south',date:'2026-11-09',quantity:2200}]},
 {id:'leche-uht',sku:'LAC-002',name:'Leche UHT 1 L',category:'Lácteos',unit:'unidad',unitCost:20,expiryDays:4,expiry:'18 nov 2026',coverage:5,nodes:{central:{physical:500,reserved:20,minimum:480},north:{physical:300,reserved:10,minimum:320},south:{physical:750,reserved:20,minimum:700}},sales:[{nodeId:'central',date:'2025-03-10',quantity:3200},{nodeId:'central',date:'2026-10-21',quantity:2900},{nodeId:'north',date:'2025-06-15',quantity:2400},{nodeId:'north',date:'2026-10-27',quantity:2500},{nodeId:'south',date:'2024-11-12',quantity:4400},{nodeId:'south',date:'2026-11-11',quantity:5100}]},
 {id:'queso-semicurado',sku:'LAC-003',name:'Queso semicurado 250 g',category:'Lácteos',unit:'unidad',unitCost:25,expiryDays:6,expiry:'20 nov 2026',coverage:7,nodes:{central:{physical:1000,reserved:35,minimum:850},north:{physical:720,reserved:20,minimum:750},south:{physical:1320,reserved:30,minimum:1300}},sales:[{nodeId:'central',date:'2025-02-14',quantity:840},{nodeId:'central',date:'2026-09-17',quantity:920},{nodeId:'north',date:'2025-05-23',quantity:590},{nodeId:'north',date:'2026-10-03',quantity:610},{nodeId:'south',date:'2024-07-06',quantity:1220},{nodeId:'south',date:'2026-10-25',quantity:1360}]},
 {id:'cafe-molido',sku:'ABA-104',name:'Café molido 500 g',category:'Abarrotes',unit:'paquete',unitCost:5,expiryDays:null,expiry:'—',coverage:21,nodes:{central:{physical:2300,reserved:50,minimum:1200},north:{physical:1500,reserved:25,minimum:900},south:{physical:3580,reserved:80,minimum:2200}},sales:[{nodeId:'central',date:'2025-01-25',quantity:900},{nodeId:'central',date:'2026-08-02',quantity:1000},{nodeId:'north',date:'2025-07-08',quantity:750},{nodeId:'north',date:'2026-10-31',quantity:820},{nodeId:'south',date:'2024-04-03',quantity:1700},{nodeId:'south',date:'2026-11-01',quantity:1800}]},
];
const formatInventoryCurrency=value=>new Intl.NumberFormat('es-VE',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(value);
const normalizeInventorySearch=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es-VE').trim();
function Icon({name}){
 const paths={inventory:<><path d="M3 21V8l9-5 9 5v13M7 21V11h10v10M3 21h18m-11-6h4"/></>,movements:<><path d="M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4"/></>,receipt:<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6m-6 4h3"/></>,count:<><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v4H9V3Zm0 10 2 2 4-4"/></>,settings:<><circle cx="12" cy="12" r="4"/><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.5 5.5 7 7m10 10 1.5 1.5m0-13L17 7M7 17l-1.5 1.5"/></>};
 return <svg className="inventory-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]||paths.inventory}</svg>;
}
function InventoryDashboard({onOpenTacticalProducts}){
 const [scope,setScope]=useState('total'),[selectedNodeId,setSelectedNodeId]=useState(mockInventoryNodes[0].id);
 const [presentation,setPresentation]=useState('cards');
 const nodes=scope==='total'?mockInventoryNodes:[mockInventoryNodes.find(node=>node.id===selectedNodeId)||mockInventoryNodes[0]];
 const inventory=nodes.reduce((total,node)=>total+node.inventory,0);
 const supplierDebt=nodes.reduce((total,node)=>total+node.supplierDebt,0);
 const good=nodes.reduce((total,node)=>total+node.good,0);
 const damaged=nodes.reduce((total,node)=>total+node.damaged,0);
 const debtRatio=supplierDebt/inventory*100;
 const conditionRatio=value=>value/inventory*100;
 const scopeLabel=scope==='total'?`Consolidado de ${nodes.length} nodos`:nodes[0].name;
 const tacticalItems=scope==='total'?mockTacticalItems:mockTacticalItems.filter(item=>item.nodeId===selectedNodeId);
 const tacticalShare=value=>tacticalItems.length?value/tacticalItems.length*100:0;
 const lowStockCount=tacticalItems.filter(item=>item.stock<item.minimum).length;
 const expiringCount=tacticalItems.filter(item=>item.daysToExpiry<=7).length;
 const lowCoverageCount=tacticalItems.filter(item=>item.coverage<=7).length;
 return <>
  <div className="inventory-summary-filters">
   <div className="inventory-summary-filter"><span className="inventory-filter-label" id="inventory-scope-label">Alcance</span><div className="inventory-scope-toggle" role="group" aria-labelledby="inventory-scope-label"><button type="button" aria-pressed={scope==='total'} onClick={()=>setScope('total')}>Total</button><button type="button" aria-pressed={scope==='node'} onClick={()=>setScope('node')}>Por nodo</button></div></div>
   <div className="inventory-summary-filter"><span className="inventory-filter-label" id="inventory-presentation-label">Vista</span><div className="inventory-scope-toggle" role="group" aria-labelledby="inventory-presentation-label"><button type="button" aria-pressed={presentation==='cards'} onClick={()=>setPresentation('cards')}>Tarjetas</button><button type="button" aria-pressed={presentation==='records'} onClick={()=>setPresentation('records')}>Registros</button></div></div>
   {scope==='node'&&<label className="inventory-node-filter"><span className="inventory-filter-label">Nodo</span><select value={selectedNodeId} onChange={event=>setSelectedNodeId(event.target.value)}>{mockInventoryNodes.map(node=><option key={node.id} value={node.id}>{node.name}</option>)}</select></label>}
  </div>
  {presentation==='cards'?<div className="inventory-summary-grid">
   <section className="inventory-summary-card" aria-label="Valor del inventario y deuda a proveedores">
    <div className="inventory-summary-card-top"><span className="inventory-summary-icon"><Icon name="inventory"/></span><span className="inventory-summary-tag">Datos mock</span></div>
    <p className="inventory-summary-label">Valor total del inventario</p><p className="inventory-summary-value">{formatInventoryCurrency(inventory)}</p><p className="inventory-summary-meta">{scopeLabel}</p>
    <div className="inventory-supplier-debt"><div className="inventory-supplier-debt-heading"><span>Deuda a proveedores</span><strong>{formatInventoryCurrency(supplierDebt)}</strong></div><div className="inventory-supplier-debt-track" role="progressbar" aria-label="Porcentaje del inventario adeudado a proveedores" aria-valuemin="0" aria-valuemax="100" aria-valuenow={debtRatio}><span style={{width:`${debtRatio}%`}}/></div><div className="inventory-supplier-debt-footer"><span>{debtRatio.toLocaleString('es-VE',{maximumFractionDigits:1})}% del valor del inventario</span><span>Contabilidad · Mock</span></div></div>
   </section>
   <section className="inventory-summary-card" aria-label="Estado del inventario">
    <div className="inventory-summary-card-top"><span className="inventory-summary-icon inventory-condition-icon"><Icon name="inventory"/></span><span className="inventory-summary-tag">Datos mock</span></div>
    <p className="inventory-summary-label">Estado del inventario</p><p className="inventory-summary-meta">Distribución del valor · {scopeLabel}</p>
    <div className="inventory-condition-list">
     <div className="inventory-condition-row"><div className="inventory-condition-heading"><span><i className="inventory-condition-dot inventory-condition-dot-good"/>Buen estado</span><strong>{formatInventoryCurrency(good)}</strong></div><div className="inventory-supplier-debt-track" role="progressbar" aria-label="Inventario en buen estado" aria-valuemin="0" aria-valuemax="100" aria-valuenow={conditionRatio(good)}><span className="inventory-condition-fill-good" style={{width:`${conditionRatio(good)}%`}}/></div><p>{conditionRatio(good).toLocaleString('es-VE',{maximumFractionDigits:1})}% del valor del inventario</p></div>
     <div className="inventory-condition-row"><div className="inventory-condition-heading"><span><i className="inventory-condition-dot inventory-condition-dot-loss"/>Dañados o pérdidas (mermas)</span><strong>{formatInventoryCurrency(damaged)}</strong></div><div className="inventory-supplier-debt-track" role="progressbar" aria-label="Productos dañados o pérdidas por merma" aria-valuemin="0" aria-valuemax="100" aria-valuenow={conditionRatio(damaged)}><span className="inventory-condition-fill-loss" style={{width:`${conditionRatio(damaged)}%`}}/></div><p>{conditionRatio(damaged).toLocaleString('es-VE',{maximumFractionDigits:1})}% del valor del inventario</p></div>
    </div>
   </section>
  </div>:<section className="inventory-panel inventory-records"><div className="inventory-records-heading"><div><h2>Registros de inventario</h2><p>{scopeLabel} · Datos mock</p></div></div><div className="inventory-table-scroll" role="region" aria-label="Registros de inventario por nodo" tabIndex={0}><table><caption className="inventory-sr-only">Valor, deuda y estado del inventario por nodo</caption><thead><tr><th scope="col">Nodo</th><th scope="col">Valor inventario</th><th scope="col">Deuda proveedores</th><th scope="col">Buen estado</th><th scope="col">Dañados / mermas</th></tr></thead><tbody>{nodes.map(node=><tr key={node.id}><th scope="row">{node.name}</th><td>{formatInventoryCurrency(node.inventory)}</td><td>{formatInventoryCurrency(node.supplierDebt)}</td><td>{formatInventoryCurrency(node.good)}</td><td>{formatInventoryCurrency(node.damaged)}</td></tr>)}</tbody><tfoot><tr><th scope="row">Total visible</th><td>{formatInventoryCurrency(inventory)}</td><td>{formatInventoryCurrency(supplierDebt)}</td><td>{formatInventoryCurrency(good)}</td><td>{formatInventoryCurrency(damaged)}</td></tr></tfoot></table></div></section>}
  <section className="inventory-panel inventory-tactical"><div className="inventory-tactical-heading"><div><p className="inventory-tactical-kicker">SEGUIMIENTO OPERATIVO</p><h2>Tabla Táctica de Inventario</h2><p>Indicadores de productos que requieren acción inmediata · {scopeLabel}</p></div><span className="inventory-summary-tag">Datos mock</span></div><div className="inventory-tactical-indicators"><article className="inventory-tactical-indicator inventory-tactical-indicator-primary"><span>Productos con acción inmediata</span><strong>{tacticalItems.length}</strong><small>Productos prioritarios en esta vista</small></article><article className="inventory-tactical-indicator"><span>Bajo stock mínimo</span><strong>{lowStockCount}</strong><small>{tacticalShare(lowStockCount).toLocaleString('es-VE',{maximumFractionDigits:1})}% de los productos prioritarios</small></article><article className="inventory-tactical-indicator"><span>Vencen en los próximos 7 días</span><strong>{expiringCount}</strong><small>{tacticalShare(expiringCount).toLocaleString('es-VE',{maximumFractionDigits:1})}% de los productos prioritarios</small></article><article className="inventory-tactical-indicator"><span>Cobertura de 7 días o menos</span><strong>{lowCoverageCount}</strong><small>{tacticalShare(lowCoverageCount).toLocaleString('es-VE',{maximumFractionDigits:1})}% de los productos prioritarios</small></article></div><a className="inventory-tactical-detail" href="/?vista=existencias&filtro=accion-inmediata" onClick={onOpenTacticalProducts}>Ver detalle de productos <span aria-hidden="true">→</span></a><p className="inventory-tactical-note">Mock · Rotación basada en salidas frente al stock promedio de los últimos 30 días; cobertura estimada según el consumo medio diario. FEFO prioriza la salida del lote con vencimiento más próximo.</p></section> </>;
}
function ProductInventorySection({tacticalOnly=false,onClearFilter}){
 const [scope,setScope]=useState('total'),[selectedNodeId,setSelectedNodeId]=useState(mockInventoryNodes[0].id);
 const [searchTerm,setSearchTerm]=useState('');
 const [dateFrom,setDateFrom]=useState(''),[dateTo,setDateTo]=useState('');
 const nodes=scope==='total'?mockInventoryNodes:[mockInventoryNodes.find(node=>node.id===selectedNodeId)||mockInventoryNodes[0]];
 const rows=mockProductRecords.map(product=>{
  const stockByNode=nodes.map(node=>({node,...product.nodes[node.id]}));
  const physical=stockByNode.reduce((sum,item)=>sum+item.physical,0);
  const reserved=stockByNode.reduce((sum,item)=>sum+item.reserved,0);
  const minimum=stockByNode.reduce((sum,item)=>sum+item.minimum,0);
  const available=physical-reserved;
  const value=physical*product.unitCost;
  const rotationQuantity=product.sales.filter(sale=>nodes.some(node=>node.id===sale.nodeId)&&(!dateFrom||sale.date>=dateFrom)&&(!dateTo||sale.date<=dateTo)).reduce((sum,sale)=>sum+sale.quantity,0);
  const lowStockNodes=stockByNode.filter(item=>item.physical-item.reserved<item.minimum).length;
  const isTactical=(product.expiryDays!==null&&product.expiryDays<=7)||lowStockNodes>0||product.coverage<=7;
  const status=product.expiryDays!==null&&product.expiryDays<=7?{label:'Vence pronto',tone:'urgent'}:lowStockNodes?{label:`Bajo mínimo${scope==='total'?` en ${lowStockNodes} nodo${lowStockNodes===1?'':'s'}`:''}`,tone:'warning'}:{label:'Disponible',tone:'good'};
  return {...product,physical,reserved,minimum,available,value,rotationQuantity,lowStockNodes,isTactical,status};
 }).filter(product=>!tacticalOnly||product.isTactical);
 const normalizedQuery=normalizeInventorySearch(searchTerm);
 const filteredRows=rows.filter(product=>normalizeInventorySearch(`${product.name} ${product.sku} ${product.category}`).includes(normalizedQuery));
 const visibleRows=filteredRows.filter(product=>(!dateFrom&&!dateTo)||product.rotationQuantity>0);
 const totals=visibleRows.reduce((sum,row)=>({physical:sum.physical+row.physical,reserved:sum.reserved+row.reserved,available:sum.available+row.available,minimum:sum.minimum+row.minimum,value:sum.value+row.value,rotationQuantity:sum.rotationQuantity+row.rotationQuantity}),{physical:0,reserved:0,available:0,minimum:0,value:0,rotationQuantity:0});
 const scopeLabel=scope==='total'?`Total de ${nodes.length} nodos`:nodes[0].name;
 const invalidDateRange=Boolean(dateFrom&&dateTo&&dateFrom>dateTo);
 return <section className="inventory-panel inventory-products">
  <div className="inventory-products-heading"><div><p className="inventory-tactical-kicker">INVENTARIO</p><h2>Existencias por producto</h2><p>{tacticalOnly?'Productos priorizados para acción inmediata.':'Consulta consolidada de cantidades y valoración.'} · Datos mock</p></div>{tacticalOnly&&<span className="inventory-summary-tag">Filtro táctico aplicado</span>}</div>
  <div className="inventory-product-filters">
   <div className="inventory-summary-filter"><span className="inventory-filter-label" id="products-scope-label">Alcance</span><div className="inventory-scope-toggle" role="group" aria-labelledby="products-scope-label"><button type="button" aria-pressed={scope==='total'} onClick={()=>setScope('total')}>Total</button><button type="button" aria-pressed={scope==='node'} onClick={()=>setScope('node')}>Por nodo</button></div></div>
   {scope==='node'&&<label className="inventory-node-filter"><span className="inventory-filter-label">Nodo</span><select value={selectedNodeId} onChange={event=>setSelectedNodeId(event.target.value)}>{mockInventoryNodes.map(node=><option key={node.id} value={node.id}>{node.name}</option>)}</select></label>}
   <label className="inventory-product-search"><span className="inventory-filter-label">Buscar producto, SKU o categoría</span><input type="search" value={searchTerm} onChange={event=>setSearchTerm(event.target.value)} placeholder="Ej. yogur, LAC-001"/></label>
   <label className="inventory-product-date-filter"><span>Desde</span><input type="date" value={dateFrom} max={dateTo||undefined} onChange={event=>setDateFrom(event.target.value)}/></label>
   <label className="inventory-product-date-filter"><span>Hasta</span><input type="date" value={dateTo} min={dateFrom||undefined} onChange={event=>setDateTo(event.target.value)}/></label>
   <button type="button" onClick={()=>{setDateFrom('');setDateTo('');}} disabled={!dateFrom&&!dateTo}>Restablecer fechas</button>
   <span className="inventory-products-scope">{scopeLabel} · {visibleRows.length} de {rows.length} productos</span>
  </div>
  {invalidDateRange&&<p className="inventory-date-error" role="alert">La fecha inicial debe ser anterior o igual a la fecha final.</p>}
  <div className="inventory-table-scroll" role="region" aria-label="Existencias por producto" tabIndex={0}><table><caption className="inventory-sr-only">Existencias mock por producto, con disponibilidad, valoración y rotación en el periodo seleccionado</caption><thead><tr><th scope="col">Producto / SKU</th><th scope="col">Stock</th><th scope="col">Reservado</th><th scope="col">Disponible</th><th scope="col">Stock mínimo</th><th scope="col">Costo promedio</th><th scope="col">Valor inventario</th><th scope="col">Rotación</th><th scope="col">Vencimiento</th><th scope="col">Estado</th></tr></thead><tbody><tr className="inventory-products-total-row"><th scope="row">Total</th><td>{totals.physical.toLocaleString('es-VE')}</td><td>{totals.reserved.toLocaleString('es-VE')}</td><td>{totals.available.toLocaleString('es-VE')}</td><td>{totals.minimum.toLocaleString('es-VE')}</td><td>—</td><td>{formatInventoryCurrency(totals.value)}</td><td>{totals.rotationQuantity.toLocaleString('es-VE')}</td><td colSpan="2">{visibleRows.length} productos</td></tr>{visibleRows.length?visibleRows.map(product=><tr key={product.id}><th scope="row"><strong>{product.name}</strong><small>{product.sku} · {product.category} · {product.unit}</small></th><td>{product.physical.toLocaleString('es-VE')}</td><td>{product.reserved.toLocaleString('es-VE')}</td><td><strong>{product.available.toLocaleString('es-VE')}</strong></td><td>{product.minimum.toLocaleString('es-VE')}</td><td>{formatInventoryCurrency(product.unitCost)}</td><td>{formatInventoryCurrency(product.value)}</td><td><strong>{product.rotationQuantity.toLocaleString('es-VE')}</strong></td><td>{product.expiry}</td><td><span className={'inventory-product-status inventory-product-status-'+product.status.tone}>{product.status.label}</span></td></tr>):<tr><td colSpan="10"><div className="inventory-products-empty"><h3>No encontramos productos</h3><p>Prueba con otro nombre, SKU o categoría.</p></div></td></tr>}</tbody></table></div>  {tacticalOnly&&<button className="inventory-filter-reset" type="button" onClick={onClearFilter}>Quitar filtro táctico</button>}
  <p className="inventory-products-note">Disponible = stock físico − reservado. Rotación muestra las ventas registradas en el rango seleccionado. Los datos son mock y el total visible aparece antes del listado.</p>
 </section>;
}export default function InventoryApp(){
 const readView=()=>new URLSearchParams(window.location.search).get('vista')||'resumen';
 const [view,setView]=useState(readView),[menu,setMenu]=useState(false);
 const [productFilter,setProductFilter]=useState(()=>new URLSearchParams(window.location.search).get('filtro')||'');
 const content=useRef(null),menuButton=useRef(null),page=pages[view];
 useEffect(()=>{const escape=e=>{if(menu&&e.key==='Escape'){setMenu(false);menuButton.current?.focus();}};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[menu]);
 useEffect(()=>{const back=()=>{setView(readView());setProductFilter(new URLSearchParams(window.location.search).get('filtro')||'');setMenu(false);};window.addEventListener('popstate',back);return()=>window.removeEventListener('popstate',back);},[]);
 useEffect(()=>{document.title=(page?.title||'Página no disponible')+' · Inventario — MasterERP DEV';},[view]);
 const navigate=(event,next)=>{if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();window.history.pushState({},'','/?vista='+next);setView(next);setProductFilter('');setMenu(false);content.current?.focus();};
 const openTacticalProducts=event=>{if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();window.history.pushState({},'','/?vista=existencias&filtro=accion-inmediata');setView('existencias');setProductFilter('accion-inmediata');setMenu(false);content.current?.focus();};
 const clearProductFilter=()=>{window.history.pushState({},'','/?vista=existencias');setView('existencias');setProductFilter('');content.current?.focus();};
 const link=(key,label)=> <a key={key} href={'/?vista='+key} aria-current={view===key?'page':undefined} onClick={event=>navigate(event,key)}>{label}</a>;
 return <div className="inventory-app"><a className="inventory-skip" href="#inventory-content">Saltar al contenido</a>
  <header className="inventory-header"><button ref={menuButton} className="inventory-menu-toggle" type="button" aria-label={menu?'Cerrar menú':'Abrir menú'} aria-expanded={menu} aria-controls="inventory-navigation" onClick={()=>setMenu(!menu)}>☰</button><a className="inventory-brand" href="/" onClick={event=>navigate(event,'resumen')}>Inventario<span>MasterERP · {import.meta.env.VITE_ENVIRONMENT_LABEL||'Desarrollo'}</span></a><div className="inventory-tools"><UonifyChatLink/><ModuleLauncher currentApp="inventory"/><span className="inventory-badge">Base visual</span></div></header>
  {menu&&<button className="inventory-overlay" aria-label="Cerrar menú de navegación" onClick={()=>setMenu(false)}/>}
  <div className="inventory-layout"><div className="inventory-service-rail"><RelatedServicesRail currentApp="inventory"/></div><aside id="inventory-navigation" className={'inventory-sidebar '+(menu?'is-open':'')}><nav aria-label="Inventario"><p className="inventory-caption">INVENTARIO</p><div className="inventory-nav-summary"><FinanceIcon name="summary"/>{link('resumen','Resumen')}</div>{groups.map(group=><details key={group.name} open><summary><Icon name={group.icon}/>{group.name}<span aria-hidden="true">⌄</span></summary><div className="inventory-nav-items">{group.items.map(([key,label])=>link(key,label))}</div></details>)}<div className="inventory-nav-summary"><Icon name="settings"/>{link('configuracion','Configuración')}</div></nav></aside>
   <main id="inventory-content" ref={content} tabIndex={-1} className="inventory-content"><p className="inventory-breadcrumb">Inventario / {page?.title||'No disponible'}</p><div className="inventory-heading"><div><h1>{page?.title||'Página no disponible'}</h1><p>{page?.description||'Esta dirección no corresponde a una pantalla de Inventario.'}</p></div><span className="inventory-badge">Desarrollo</span></div>
    {!page?<section className="inventory-panel"><p>Vuelve al Resumen para continuar.</p>{link('resumen','Ir a Resumen')}</section>:view==='resumen'?<InventoryDashboard onOpenTacticalProducts={openTacticalProducts}/>:view==='configuracion'?<section className="inventory-panel"><h2>Operación por sucursal</h2><dl><dt>Modo inicial</dt><dd>Una sucursal predeterminada, sin selector de nodos.</dd><dt>Multinodo</dt><dd>Disponible cuando se active Nodos en Ecommerce y se valide el acceso a sus sucursales.</dd><dt>Productos</dt><dd>Se reutilizará el maestro de Catálogo, sin duplicarlo.</dd></dl><p>Esta pantalla no activa capacidades ni cambia configuración real.</p></section>:view==='existencias'?<ProductInventorySection tacticalOnly={productFilter==='accion-inmediata'} onClearFilter={clearProductFilter}/>:page.nodes?<section className="inventory-panel inventory-empty"><Icon name="inventory"/><h2>Requiere Nodos</h2><p>Al activar esta capacidad en Ecommerce, Inventario podrá operar por sucursal según los permisos del usuario.</p><p>No se muestran sucursales ficticias ni un selector sin datos autorizados.</p></section>:<section className="inventory-panel"><div className="inventory-table-scroll"><table><caption className="inventory-sr-only">{page.title}</caption><thead><tr>{page.columns.map(column=><th scope="col" key={column}>{column}</th>)}</tr></thead><tbody><tr><td colSpan={page.columns.length}><div className="inventory-empty"><Icon name="inventory"/><h2>Sin datos conectados</h2><p>Esta es la base visual de {page.title.toLowerCase()}. La consulta y las operaciones se integrarán posteriormente.</p></div></td></tr></tbody></table></div></section>}
    <p className="inventory-footnote">Base visual DEV · Sin datos reales ni operaciones de inventario. La autenticación, los permisos y la activación de Nodos se integrarán con los servicios existentes.</p>
   </main>
  </div>
 </div>;
}
