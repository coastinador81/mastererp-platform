import React,{useState} from 'react';
import FinanceIcon from '../../../src/FinanceIcon.jsx';
import SupplierRow from './SupplierRow.jsx';
import useSupplierDirectory from './useSupplierDirectory.jsx';
import {matchesSupplier} from './supplierSearch.mjs';

export default function SupplierDirectory({data,workspace,base,navigate,reload,hasPrevious,onPrevious,onNext,endpoint,plural='proveedores'}){
  const [term,setTerm]=useState(''),[page,setPage]=useState(0),[retry,setRetry]=useState(0);
  const searching=Boolean(term.trim());
  const directory=useSupplierDirectory({workspace,endpoint,enabled:searching,reload:reload+':'+retry});
  const matches=searching?(directory.items||[]).filter(row=>matchesSupplier(row,term)):[];
  const rows=searching?matches.slice(page*10,page*10+10):data.items;
  const working=searching&&directory.loading,failed=searching&&directory.error;
  const previous=searching?page>0:hasPrevious,next=searching?(page+1)*10<matches.length:Boolean(data.next_cursor);
  const count=searching?`Mostrando ${rows.length} de ${matches.length} coincidencias.`:`Mostrando ${rows.length} ${plural}${hasPrevious||data.next_cursor?' en esta página':''}.`;
  return <div className="panel supplier-directory-panel">
    <label className="supplier-search"><FinanceIcon name="search"/><input type="search" aria-label={'Buscar '+plural} placeholder="Buscar por nombre, código o identificación fiscal" value={term} onChange={event=>{setTerm(event.target.value);setPage(0);}}/></label>
    {failed&&<div className="notice error" role="alert">No se pudo completar la búsqueda. <button type="button" className="secondary" onClick={()=>setRetry(value=>value+1)}>Reintentar búsqueda</button></div>}
    <div className="table-scroll" aria-busy={working}><table className="suppliers-table"><thead><tr><th>Código</th><th>Nombre</th><th>Identificación fiscal</th><th>Correo</th><th>Teléfono</th></tr></thead><tbody>
      {!working&&!failed&&rows.map(row=><SupplierRow key={row.id} row={row} path={base+'/'+row.id} navigate={navigate}/>)}
    </tbody></table></div>
    {!working&&!failed&&rows.length===0&&<p className="empty">{searching?'No se encontraron '+plural+' para esta búsqueda.':'No hay '+plural+' registrados en esta empresa.'}</p>}
    <div className="pagination supplier-pagination"><span role="status">{working?'Buscando en '+plural+' de esta empresa…':failed?'Búsqueda no disponible.':count}</span><div className="supplier-page-controls">
      <button type="button" className="secondary" disabled={working||failed||!previous} onClick={()=>searching?setPage(value=>value-1):onPrevious()}>Anterior</button>
      <button type="button" className="secondary" disabled={working||failed||!next} onClick={()=>searching?setPage(value=>value+1):onNext()}>Siguiente</button>
    </div></div>
  </div>;
}
