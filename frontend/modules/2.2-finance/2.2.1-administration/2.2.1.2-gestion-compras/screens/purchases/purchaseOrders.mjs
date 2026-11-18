export const normalizeOrderText=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').trim();
export const orderState=value=>value==='borrador'?'Borrador':String(value||'Sin estado');
export function matchesOrder(row,filters){
 return (!filters.from||row.fecha>=filters.from)&&(!filters.to||row.fecha<=filters.to)&&(!filters.currency||row.moneda===filters.currency)&&(!filters.status||row.estado===filters.status)&&normalizeOrderText([row.numero,row.proveedor].join(' ')).includes(normalizeOrderText(filters.search));
}
export function validateOrder(row,company){
 if(!row||typeof row.id!=='string'||row.company_id!==company||row.clase!=='orden_compra'||typeof row.fecha!=='string'||typeof row.proveedor!=='string'||typeof row.moneda!=='string'||!/^\d+(?:\.\d+)?$/.test(String(row.total))||typeof row.estado!=='string')throw new Error('invalid_order_response');
 return row;
}
export async function loadOrderDirectory({request,endpoint,tenant,company,isCurrent}){
 const rows=new Map(),cursors=new Set();let after=null,pages=0;
 do{
  if(!isCurrent())return null;
  if(++pages>200||after&&cursors.has(after))throw new Error('order_directory_incomplete');
  if(after)cursors.add(after);
  const query=new URLSearchParams({company_id:company,limit:'100',...(after?{after}:{})});
  const result=await request(endpoint+'?'+query,{headers:{'X-MasterERP-Tenant-Id':tenant}});
  if(!isCurrent())return null;
  const data=result?.data;
  if(!Array.isArray(data?.items)||!(data.next_cursor===null||typeof data.next_cursor==='string'))throw new Error('invalid_order_response');
  for(const row of data.items)rows.set(validateOrder(row,company).id,row);
  after=data.next_cursor;
 }while(after);
 return [...rows.values()];
}
export async function readOrder({request,endpoint,tenant,company,id,isCurrent}){
 const result=await request(endpoint+'/'+encodeURIComponent(id)+'?'+new URLSearchParams({company_id:company}),{headers:{'X-MasterERP-Tenant-Id':tenant}});
 if(!isCurrent())return null;
 const order=validateOrder(result?.data,company);
 if(order.id!==id||!Array.isArray(order.lineas))throw new Error('invalid_order_response');
 return order;
}
