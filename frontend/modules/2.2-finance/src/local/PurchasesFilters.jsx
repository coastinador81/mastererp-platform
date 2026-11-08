import React,{useId,useState} from 'react';
import FinanceIcon from '../FinanceIcon.jsx';

export default function PurchasesFilters({draft,onChange,error,nodes,suggestions,statuses=[]}){
 const id=useId(),[open,setOpen]=useState(false),[active,setActive]=useState(-1);
 const visible=open&&draft.search.trim().length>0&&suggestions.length>0;
 const choose=value=>{onChange('search',value);setOpen(false);setActive(-1);};
 const keyDown=e=>{
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setOpen(false);setActive(-1);}
  if(['ArrowDown','ArrowUp'].includes(e.key)&&suggestions.length&&draft.search.trim()){
   e.preventDefault();setOpen(true);setActive(old=>e.key==='ArrowDown'?(old+1)%suggestions.length:(old<=0?suggestions.length-1:old-1));
  }
  if(e.key==='Enter'){e.preventDefault();if(visible&&active>=0)choose(suggestions[active]);else setOpen(false);}
 };
 return <form className="purchase-summary-filters demo-purchase-filters" onSubmit={e=>e.preventDefault()} noValidate aria-label="Filtros de compras">
  <div className="demo-purchase-filter-grid">
   <label>Nodo<select aria-label="Nodo" value={draft.node} onChange={e=>onChange('node',e.target.value)}><option value="">Todos los nodos</option>{nodes.map(node=><option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
   <label>Desde<input type="date" aria-label="Fecha desde" value={draft.from} onChange={e=>onChange('from',e.target.value)} aria-invalid={Boolean(error)} aria-describedby={error?id+'-error':undefined}/></label>
   <label>Hasta<input type="date" aria-label="Fecha hasta" min={draft.from||undefined} value={draft.to} onChange={e=>onChange('to',e.target.value)} aria-invalid={Boolean(error)} aria-describedby={error?id+'-error':undefined}/></label>
   <label>Estado<select aria-label="Estado" value={draft.status} onChange={e=>onChange('status',e.target.value)}><option value="">Todos los estados</option>{statuses.map(status=><option key={status} value={status}>{status}</option>)}</select></label>
   <label>Moneda<select aria-label="Moneda" value={draft.currency} onChange={e=>onChange('currency',e.target.value)}><option value="VES">Bolívares (Bs.)</option><option value="USD">Dólares (USD)</option><option value="EUR">Euros (EUR)</option></select></label>
  <div className="demo-purchase-search"><label htmlFor={id+'-search'}>Buscar compra</label><div className="demo-purchase-search-control"><FinanceIcon name="search"/><input id={id+'-search'} role="combobox" type="search" autoComplete="off" placeholder="Referencia, proveedor o concepto" value={draft.search} aria-autocomplete="list" aria-expanded={visible} aria-controls={id+'-suggestions'} aria-activedescendant={visible&&active>=0?id+'-option-'+active:undefined} onChange={e=>{onChange('search',e.target.value);setOpen(true);setActive(-1);}} onFocus={()=>setOpen(true)} onBlur={()=>{setOpen(false);setActive(-1);}} onKeyDown={keyDown}/></div>
    {visible&&<ul id={id+'-suggestions'} className="demo-purchase-search-suggestions" role="listbox" aria-label="Sugerencias de compras">{suggestions.map((value,index)=><li key={value} id={id+'-option-'+index} role="option" aria-selected={index===active} onMouseDown={e=>e.preventDefault()} onMouseEnter={()=>setActive(index)} onClick={()=>choose(value)}><FinanceIcon name="search"/><span>{value}</span></li>)}</ul>}
   </div>
  </div>
  {error&&<p id={id+'-error'} role="alert" className="purchase-filter-error">{error}</p>}
 </form>;
}
