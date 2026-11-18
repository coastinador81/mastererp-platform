import React,{useEffect,useState} from 'react';
import Purchases from './Purchases.jsx';
import OrderDirectoryFilters from './OrderDirectoryFilters.jsx';
import {loadOrderDirectory,readOrder,matchesOrder,orderState} from './purchaseOrders.mjs';
import {amount,date} from '../../../2.2.1.1-gestion-comercial/2.2.1.1.3-ventas/screens/list/salesFormat.mjs';
import './purchaseOrders.css';
const API=window.location.origin==='https://finanzas-dev.uonify.com'?window.location.origin:'https://qx8nmypdhi.execute-api.us-west-1.amazonaws.com';
const endpoint=API+'/v1/administration/compras/ordenes',base='/modulos/finanzas/administracion/ordenes-compra';
const empty={from:'',to:'',currency:'',status:'',search:''};
const errors={401:'Tu sesión ha finalizado. Vuelve a acceder.',403:'No tienes permiso para consultar estas órdenes.',404:'La orden no está disponible en esta empresa.',503:'No se pudieron consultar las ordenes. Puedes reintentar.'};
export default function PurchaseOrders({workspace,path,navigate}){
 const {tenant,company,context,request,denied}=workspace;
 const tail=path.slice(base.length).split('/').filter(Boolean),form=tail[0]==='nuevo'||tail[1]==='editar',id=tail[0]&&tail[0]!=='nuevo'?tail[0]:null;
 const canRead=context.permissions.includes('administration.purchases.read'),canWrite=context.permissions.includes('administration.purchases.write');
 const [reload,setReload]=useState(0),[state,setState]=useState({scope:null,data:null,error:null}),[draft,setDraft]=useState(empty),[filters,setFilters]=useState(empty),[filterError,setFilterError]=useState(''),[page,setPage]=useState(0);
 const scope=JSON.stringify([tenant,company,id,reload,canRead]);
 useEffect(()=>{
  if(form||!canRead||!tenant||!company)return;
  let live=true;setState({scope,data:null,error:null});setDraft(empty);setFilters(empty);setFilterError('');setPage(0);
  const load=id?readOrder:loadOrderDirectory;
  load({request,endpoint,tenant,company,id,isCurrent:()=>live}).then(data=>{if(live&&data!==null)setState({scope,data,error:null});}).catch(error=>{if(!live||error.name==='AbortError')return;setState({scope,data:null,error:errors[error.status]||'No se pudo completar la lectura de órdenes. No se muestran resultados parciales.'});if(error.status===403)denied();});
  return()=>{live=false;};
 },[scope,form]);
 const current=state.scope===scope&&canRead?state:{data:null,error:null};
 if(form)return <Purchases workspace={workspace} capacity="ordenes-compra" path={path} navigate={navigate}/>;
 if(!canRead)return <p className="notice error" role="alert">No tienes permiso para consultar órdenes de compra.</p>;
 const change=(name,value)=>{const next={...draft,[name]:value};setDraft(next);if(next.from&&next.to&&next.to<next.from){setFilterError('La fecha hasta debe ser igual o posterior a la fecha desde.');return;}setFilterError('');setFilters(next);setPage(0);};
 const go=(event,url)=>{if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();navigate(url);};
 const openRow=(event,row)=>{if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.target.closest('a,button,input,select,textarea,[contenteditable=true]')||window.getSelection()?.toString())return;navigate(base+'/'+row.id);};
 const items=!id&&Array.isArray(current.data)?current.data:[],filtered=items.filter(row=>matchesOrder(row,filters));
 const maxPage=Math.max(0,Math.ceil(filtered.length/10)-1),activePage=Math.min(page,maxPage),rows=filtered.slice(activePage*10,activePage*10+10),order=id?current.data:null;
 return <section className="purchase-orders-directory" aria-labelledby="order-directory-title">
  <p className="supplier-breadcrumb">Finanzas <span>/</span> Administración <span>/</span> Gestión de compras</p>
  <header className="page-heading"><div>{id&&<a href="/?vista=ordenes-compra" onClick={e=>go(e,base)}>Volver a órdenes</a>}<h1 id="order-directory-title">{id?(order?.numero||'Detalle de la orden'):'Órdenes de compra'}</h1><p>Consulta las órdenes registradas de la empresa activa.</p></div><div className="actions"><button type="button" className="secondary" onClick={()=>setReload(x=>x+1)} disabled={!current.error&&current.data===null}>Actualizar</button>{!id&&canWrite&&<a className="order-directory-create" href="/?vista=ordenes-compra&accion=crear" onClick={e=>go(e,base+'/nuevo')}>Crear orden</a>}</div></header>
  <p className="notice">Las operaciones disponibles son borradores. La aprobación, emisión y entrega no forman parte de esta lectura.</p>
  {current.error?<div className="notice error" role="alert">{current.error}</div>:current.data===null?<p role="status">Cargando órdenes de compra...</p>:id&&order?<>
   <section className="panel"><h2>Información general</h2><dl className="order-directory-detail">{[['Referencia',order.numero||'Sin referencia'],['Proveedor',order.proveedor],['Fecha',date(order.fecha)],['Estado',orderState(order.estado)],['Moneda',order.moneda],['Total',amount(order.total)],['Total en moneda base',order.moneda_base+' '+amount(order.total_base)],['Tipo de cambio',order.tipo_cambio],['Fecha y fuente del cambio',date(order.cambio_fecha)+' / '+order.cambio_fuente],['Versión',order.version]].map(([name,value])=><div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>{order.origen_id&&<a href={'/?vista=solicitudes-compra&id='+order.origen_id+'&datos=reales'}>Consultar compra de origen</a>}</section>
   <section className="panel"><h2>Productos y servicios</h2><div className="table-scroll"><table><caption className="order-directory-sr">Detalles de la orden</caption><thead><tr><th>Descripción</th><th>Cantidad</th><th>Precio unitario</th><th>Total</th></tr></thead><tbody>{order.lineas.map((line,index)=><tr key={index}><td>{line.descripcion}</td><td>{amount(line.cantidad,0)}</td><td>{amount(line.precio_unitario)}</td><td>{amount(line.total)}</td></tr>)}</tbody></table></div></section>
   {canWrite&&order.editable&&<a href={'/?vista=ordenes-compra&id='+id+'&accion=editar'} onClick={e=>go(e,base+'/'+id+'/editar')}>Editar borrador</a>}
  </>:<>
   <OrderDirectoryFilters draft={draft} change={change} items={items} error={filterError}/>
   <div className="panel"><div className="table-scroll"><table><caption className="order-directory-sr">Órdenes de compra registradas</caption><thead><tr><th>Referencia</th><th>Fecha</th><th>Proveedor</th><th>Moneda</th><th>Importe total</th><th>Estado</th></tr></thead><tbody>{rows.map(row=><tr key={row.id} className="order-directory-row" onClick={e=>openRow(e,row)}><td><a href={'/?vista=ordenes-compra&id='+row.id} onClick={e=>go(e,base+'/'+row.id)}>{row.numero||'Sin referencia'}</a></td><td>{date(row.fecha)}</td><td>{row.proveedor}</td><td>{row.moneda==='VES'?'Bs.':row.moneda}</td><td>{amount(row.total)}</td><td><span className="badge">{orderState(row.estado)}</span></td></tr>)}</tbody></table></div>
   {!rows.length&&<p className="empty" role="status">{items.length?'No hay órdenes que coincidan con los filtros.':'No hay órdenes registradas en esta empresa.'}</p>}
   <div className="pagination"><span role="status">{filtered.length} órdenes</span><div className="order-directory-pages"><button type="button" className="secondary" disabled={activePage===0} onClick={()=>setPage(x=>Math.max(0,x-1))}>Anterior</button><button type="button" className="secondary" disabled={activePage===maxPage} onClick={()=>setPage(x=>x+1)}>Siguiente</button></div></div></div>
  </>}
 </section>;
}
