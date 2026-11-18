import React,{useId,useState} from 'react';
import FinanceIcon from '../../../../src/FinanceIcon.jsx';
import {normalizeOrderText,orderState} from './purchaseOrders.mjs';
export default function OrderDirectoryFilters({draft,change,items,error}){
 const id=useId(),[open,setOpen]=useState(false),[active,setActive]=useState(-1);
 const candidates=items.filter(row=>(!draft.from||row.fecha>=draft.from)&&(!draft.to||row.fecha<=draft.to)&&(!draft.currency||row.moneda===draft.currency)&&(!draft.status||row.estado===draft.status));
 const suggestions=[...new Set(candidates.flatMap(row=>[row.numero,row.proveedor]).filter(Boolean))].filter(value=>normalizeOrderText(value).includes(normalizeOrderText(draft.search))).slice(0,6);
 const show=open&&draft.search.trim()&&suggestions.length>0;
 const choose=value=>{change('search',value);setOpen(false);setActive(-1);};
 const keys=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setOpen(false);}if(['ArrowDown','ArrowUp'].includes(e.key)&&suggestions.length){e.preventDefault();setOpen(true);setActive(old=>e.key==='ArrowDown'?(old+1)%suggestions.length:old<=0?suggestions.length-1:old-1);}if(e.key==='Enter'){e.preventDefault();if(show&&active>=0&&suggestions[active])choose(suggestions[active]);}};
 return <form className="panel order-directory-filters" aria-label="Filtros de órdenes de compra" onSubmit={e=>e.preventDefault()}>
  <label>Nodo<select aria-label="Nodo" disabled title="Filtro por nodo pendiente de contrato de datos"><option>No disponible</option></select></label>
  <label>Desde<input aria-label="Fecha desde" type="date" value={draft.from} onChange={e=>change('from',e.target.value)} aria-invalid={Boolean(error)} aria-describedby={error?id+'-error':undefined}/></label>
  <label>Hasta<input aria-label="Fecha hasta" type="date" min={draft.from||undefined} value={draft.to} onChange={e=>change('to',e.target.value)} aria-invalid={Boolean(error)} aria-describedby={error?id+'-error':undefined}/></label>
  <label>Estado<select aria-label="Estado" value={draft.status} onChange={e=>change('status',e.target.value)}><option value="">Todos los estados</option>{[...new Set(items.map(row=>row.estado))].map(value=><option key={value} value={value}>{orderState(value)}</option>)}</select></label>
  <label>Moneda<select aria-label="Moneda" value={draft.currency} onChange={e=>change('currency',e.target.value)}><option value="">Todas las monedas</option>{[...new Set(items.map(row=>row.moneda))].sort().map(value=><option key={value} value={value}>{value==='VES'?'Bolívares (Bs.)':value}</option>)}</select></label>
  <div className="order-directory-search"><label htmlFor={id+'-search'}>Buscar orden</label><div className="order-directory-search-control"><FinanceIcon name="search"/><input id={id+'-search'} role="combobox" type="search" autoComplete="off" value={draft.search} onChange={e=>{change('search',e.target.value);setOpen(true);setActive(-1);}} onFocus={()=>setOpen(true)} onBlur={()=>{setOpen(false);setActive(-1);}} onKeyDown={keys} placeholder="Referencia o proveedor" aria-autocomplete="list" aria-expanded={Boolean(show)} aria-controls={id+'-options'} aria-activedescendant={show&&active>=0?id+'-option-'+active:undefined}/></div>
   {Boolean(show)&&<ul id={id+'-options'} role="listbox" aria-label="Sugerencias de búsqueda">{suggestions.map((value,index)=><li key={value} id={id+'-option-'+index} role="option" aria-selected={active===index} onMouseDown={e=>e.preventDefault()} onMouseEnter={()=>setActive(index)} onClick={()=>choose(value)}>{value}</li>)}</ul>}
  </div>
  {error&&<p className="notice error order-directory-filter-error" id={id+'-error'} role="alert">{error}</p>}
 </form>;
}
