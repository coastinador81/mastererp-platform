import React,{useRef,useState} from 'react';
import './purchasesSummary.css';

const icons={
 liquidity:<><path d="M4 7h15v13H4V7Zm0 0V4h12v3m0 5h5v5h-5v-5Z"/><circle cx="17.5" cy="14.5" r=".5"/></>,
 payable:<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6m-6 4h3"/></>,
 reserves:<><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="M12 8v8m-4-4h8"/></>,
 credit:<><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18m-8 5h5"/></>,
 returns:<><path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12h-3"/></>,
 discounts:<><path d="m3 12 9-9h8v8l-9 9-8-8Z"/><circle cx="16" cy="7" r="1"/><path d="m9 11 5 5m0-5-5 5"/></>,
 suppliers:<><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-17a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v3"/></>,
};
function Icon({name}){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>;}
const indicators=[
 {name:'Liquidez disponible',icon:'liquidity',tone:'blue',description:'Fondos disponibles para compras.'},
 {name:'Cuentas por pagar',icon:'payable',tone:'amber',description:'Obligaciones pendientes con proveedores.'},
 {name:'Reservas financieras',icon:'reserves',tone:'violet',description:'Fondos reservados para compromisos.'},
 {name:'Notas de crédito',icon:'credit',tone:'teal',description:'Créditos de proveedores por consultar.'},
 {name:'Devoluciones',icon:'returns',tone:'slate',description:'Devoluciones vinculadas a compras.'},
 {name:'Descuentos',icon:'discounts',tone:'rose',description:'Descuentos asociados a proveedores.'},
];
const initialFilters={node:'',from:'',to:'',currency:'VES'};
const currencies=[['VES','Bolívares (Bs.)'],['USD','Dólares (USD)'],['EUR','Euros (EUR)']];
const displayDate=value=>value.split('-').reverse().join('/');
export default function PurchasesSummary({nodes=[]}){
 const [draft,setDraft]=useState({...initialFilters}),[filters,setFilters]=useState({...initialFilters}),[error,setError]=useState('');
 const until=useRef(null);
 const selectedNode=nodes.find(node=>node.id===filters.node);
 const scope=selectedNode?selectedNode.name:'Todos los nodos';
 const currency=currencies.find(([code])=>code===filters.currency)?.[1]||'Bolívares (Bs.)';
 const dates=filters.from&&filters.to?`${displayDate(filters.from)} — ${displayDate(filters.to)}`:filters.from?`Desde ${displayDate(filters.from)}`:filters.to?`Hasta ${displayDate(filters.to)}`:'Todas las fechas';
 const change=(key,value)=>{setDraft(current=>({...current,[key]:value}));setError('');};
 const apply=event=>{
  event.preventDefault();
  if(draft.from&&draft.to&&draft.to<draft.from){setError('La fecha hasta debe ser igual o posterior a la fecha desde.');until.current?.focus();return;}
  setFilters({...draft});setError('');
 };
 const reset=()=>{setDraft({...initialFilters});setFilters({...initialFilters});setError('');};
 return <section className="purchase-summary" aria-labelledby="purchases-title">
  <p className="purchase-summary-breadcrumb">Finanzas <span>/</span> Administración <span>/</span> Gestión de compras</p>
  <header className="purchase-summary-heading"><div><h1 id="purchases-title">Resumen</h1><p>Una visión de tus fondos y compromisos con proveedores.</p></div><span className="purchase-summary-preview">Vista previa · Sin datos</span></header>
  <div className="purchase-summary-tabs"><span aria-current="page">Resumen</span></div>
  <form className="purchase-summary-filters" onSubmit={apply} noValidate aria-label="Filtros del resumen de compras">
   <div className="purchase-filter-fields">
    <label className="purchase-filter-node">Nodo<select aria-label="Nodo" value={draft.node} onChange={event=>change('node',event.target.value)}><option value="">Todos los nodos</option>{nodes.map(node=><option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
    <label>Fecha desde<input type="date" value={draft.from} onChange={event=>change('from',event.target.value)}/></label>
    <label>Fecha hasta<input ref={until} type="date" value={draft.to} min={draft.from||undefined} aria-invalid={Boolean(error)} aria-describedby={error?'purchase-date-error':undefined} onChange={event=>change('to',event.target.value)}/></label>
    <label>Moneda<select aria-label="Moneda" value={draft.currency} onChange={event=>change('currency',event.target.value)}>{currencies.map(([code,name])=><option value={code} key={code}>{name}</option>)}</select></label>
   </div>
   <div className="purchase-filter-footer"><p>Importes en la moneda seleccionada. Sin conversiones.</p><div><button type="button" className="secondary" onClick={reset}>Restablecer</button><button type="submit">Aplicar filtros</button></div></div>
   {error&&<p className="purchase-filter-error" id="purchase-date-error" role="alert">{error}</p>}
  </form>
  <div className="purchase-summary-scope" role="status"><span>{selectedNode?'Resumen por nodo':'Resumen general'}<strong>{scope}</strong></span><p>{dates}<span aria-hidden="true"> · </span>{currency}</p></div>
  <dl className="purchase-indicators" aria-label="Indicadores de compras">{indicators.map(indicator=><div className="purchase-indicator" key={indicator.name}>
   <div className="purchase-indicator-top"><dt>{indicator.name}</dt><span className={'purchase-indicator-icon '+indicator.tone}><Icon name={indicator.icon}/></span></div>
   <dd aria-label={indicator.name+': sin datos, '+filters.currency}><span>—</span><small>{filters.currency==='VES'?'Bs.':filters.currency}</small></dd><p>{indicator.description}</p>
  </div>)}</dl>
  <div className="purchase-summary-sections">
   <section className="purchase-overview-panel" aria-labelledby="purchase-payable-title">
    <header><div><h2 id="purchase-payable-title">Cuentas por pagar a proveedores</h2><p>Consulta los compromisos pendientes y sus vencimientos.</p></div><span className="purchase-section-icon"><Icon name="suppliers"/></span></header>
    <div className="purchase-summary-table-scroll"><table><thead><tr><th>Proveedor</th><th>Por pagar</th><th>Vencido</th><th>Próximo vencimiento</th><th>Moneda</th></tr></thead><tbody><tr><td colSpan="5"><div className="purchase-summary-empty"><span><Icon name="payable"/></span><h3>Sin información de proveedores</h3><p>Aquí verás las cuentas por pagar y sus próximos vencimientos.</p></div></td></tr></tbody></table></div>
   </section>
   <section className="purchase-overview-panel" aria-labelledby="purchase-reserves-title">
    <header><div><h2 id="purchase-reserves-title">Reservas financieras</h2><p>Fondos destinados a compromisos de compra.</p></div><span className="purchase-section-icon"><Icon name="reserves"/></span></header>
    <div className="purchase-summary-table-scroll"><table><thead><tr><th>Concepto</th><th>Importe reservado</th><th>Moneda</th><th>Estado</th></tr></thead><tbody><tr><td colSpan="4"><div className="purchase-summary-empty"><span><Icon name="reserves"/></span><h3>Sin información de reservas</h3><p>Aquí podrás consultar los fondos reservados.</p></div></td></tr></tbody></table></div>
   </section>
  </div>
  <p className="purchase-summary-footnote">Vista de diseño con nodos de ejemplo. Los filtros solo cambian el ámbito visual; los importes y movimientos todavía no están conectados.</p>
 </section>;
}
