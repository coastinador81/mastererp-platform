import React,{useEffect,useState} from 'react';
import FinanceIcon from '../../../../../src/FinanceIcon.jsx';
import {financeUrl} from '../../../../../../../app-shell/src/financeRoutes.mjs';
import SaleDetail from '../detail/SaleDetail.jsx';
import {amount,date,state,origin} from './salesFormat.mjs';
import './sales.css';

const BASE='/modulos/finanzas/administracion/ventas';
const API=window.location.origin==='https://finanzas-dev.uonify.com'?window.location.origin:'https://qx8nmypdhi.execute-api.us-west-1.amazonaws.com';
const messages={400:'No se pudo consultar esta página. Vuelve al listado para intentarlo.',401:'Tu sesión ha caducado. Vuelve a acceder.',403:'No tienes permiso para consultar las ventas de esta empresa.',404:'Esta venta no está disponible en la empresa activa.',503:'No se pudieron cargar las ventas. Puedes volver a intentarlo.'};
const modified=e=>e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey;
const selecting=()=>Boolean(window.getSelection()?.toString());
const validSale=row=>row&&typeof row.id==='string'&&typeof row.total==='string'&&typeof row.moneda==='string'&&Number.isInteger(row.decimales)&&typeof row.cliente?.nombre==='string'&&typeof row.pedido?.numero==='string';
export function saleHref(path){return document.documentElement.classList.contains('finance-app')?financeUrl(path):'#'+path;}
function SaleRow({row,navigate}){
 const path=BASE+'/'+row.id;
 return <tr className="sale-row" onClick={event=>{
  if(event.defaultPrevented||modified(event)||selecting())return;
  if(event.target.closest?.('a,button,input,select,textarea,label,[role],[tabindex],[contenteditable]'))return;
  navigate(path);
 }}><td><a href={saleHref(path)} onClick={event=>{
  if(modified(event)||event.defaultPrevented)return;
  event.preventDefault();if(!selecting())navigate(path);
 }}>{row.numero}</a></td><td>{date(row.fecha)}</td><td>{row.cliente.nombre}</td><td>{origin(row.origen)}</td><td><span className={'sale-badge '+(row.estado==='CANCELLED'?'cancelled':'')}>{state(row.estado)}</span></td><td className="sale-money">{amount(row.total,row.decimales)} <span>{row.moneda}</span></td></tr>;
}
export default function Sales({workspace,path,navigate}){
 const {tenant,company,context,request}=workspace;
 const canRead=context?.permissions.includes('administration.read');
 const id=path===BASE?null:path.slice(BASE.length+1);
 const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(null);
 const [term,setTerm]=useState(''),[search,setSearch]=useState(''),[cursor,setCursor]=useState(''),[pages,setPages]=useState([]),[reload,setReload]=useState(0);
 useEffect(()=>{if(term.trim()===search)return;const timer=setTimeout(()=>{setSearch(term.trim());setCursor('');setPages([]);},300);return()=>clearTimeout(timer);},[term,search]);
 useEffect(()=>{
  let live=true;setData(null);setError(null);
  if(!canRead||!company){setLoading(false);return()=>{live=false;};}
  if(id&&!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)){setError(404);setLoading(false);return()=>{live=false;};}
  setLoading(true);
  const query=new URLSearchParams({company_id:company,limit:'10',...(id?{}:{...(cursor?{after:cursor}:{}),...(search?{q:search}:{})})});
  request(API+'/v1/administration/ventas'+(id?'/'+id:'')+'?'+query,{headers:{'X-MasterERP-Tenant-Id':tenant}})
   .then(result=>{if(live){const value=result.data;const valid=id?validSale(value)&&Array.isArray(value.lineas):value&&Array.isArray(value.items)&&value.items.every(validSale)&&('next_cursor' in value);if(!valid){const failure=new Error('invalid_sales_response');failure.status=503;throw failure;}setData(value);}})
   .catch(failure=>{if(live&&failure.name!=='AbortError'){setError(failure.status||503);if(failure.status===403)workspace.denied?.();}})
   .finally(()=>{if(live)setLoading(false);});
  return()=>{live=false;};
 },[tenant,company,id,cursor,search,reload,canRead]);
 return <section className="finance-sales">
  <p className="eyebrow">Finanzas / Administración / Gestión comercial</p>
  <header className="sales-heading"><div><h1>{id?'Detalle de venta':'Ventas'}</h1><p>{id?'Información de la venta registrada y su pedido de origen.':'Consulta las ventas originadas en eCommerce.'}</p></div>{!id&&canRead&&<button type="button" className="secondary" disabled={loading} onClick={()=>setReload(value=>value+1)}>Actualizar</button>}</header>
  {id&&<a className="sales-back" href={saleHref(BASE)} onClick={event=>{if(!modified(event)){event.preventDefault();navigate(BASE);}}}>← Volver a Ventas</a>}
  {!canRead?<p className="notice" role="alert">No tienes permiso para consultar Ventas.</p>:error?<div className="notice error" role="alert">{messages[error]||messages[503]} {error!==401&&error!==403&&error!==404&&<button type="button" className="secondary" onClick={()=>setReload(value=>value+1)}>Reintentar</button>}</div>:
   id?(loading?<p role="status">Cargando venta…</p>:data&&<SaleDetail sale={data}/>):
   <div className="panel sales-directory">
    <label className="sales-search"><FinanceIcon name="search"/><input type="search" aria-label="Buscar ventas" placeholder="Buscar por venta, cliente o pedido" maxLength={120} value={term} onChange={event=>setTerm(event.target.value)}/></label>
    <div className="table-scroll" aria-busy={loading}><table><thead><tr><th>Venta</th><th>Fecha</th><th>Cliente</th><th>Origen</th><th>Estado</th><th>Total</th></tr></thead><tbody>{!loading&&data?.items.map(row=><SaleRow key={row.id} row={row} navigate={navigate}/>)}</tbody></table></div>
    {loading?<p className="sales-empty" role="status">Cargando ventas…</p>:data?.items.length===0&&<p className="sales-empty">{search?'No se encontraron ventas para esta búsqueda.':'Todavía no hay ventas registradas en esta empresa.'}</p>}
    <div className="sales-pagination"><span role="status">{!loading&&data?`Mostrando ${data.items.length} ventas${pages.length||data.next_cursor?' en esta página':''}.`:''}</span><div><button type="button" className="secondary" disabled={loading||!pages.length} onClick={()=>{setCursor(pages.at(-1));setPages(value=>value.slice(0,-1));}}>Anterior</button><button type="button" className="secondary" disabled={loading||!data?.next_cursor} onClick={()=>{setPages(value=>[...value,cursor]);setCursor(data.next_cursor);}}>Siguiente</button></div></div>
   </div>}
 </section>;
}
