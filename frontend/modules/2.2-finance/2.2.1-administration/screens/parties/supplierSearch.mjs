export const normalizeSupplierText=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').trim();
export function matchesSupplier(row,term){
  const query=normalizeSupplierText(term);
  return [row.nombre,row.codigo,row.datos_generales?.numero_identificacion].some(value=>normalizeSupplierText(value).includes(query));
}

// The current API has no text-search parameter. Read its authorized keyset pages;
// never claim a complete result after a partial failure or context cancellation.
export async function loadSupplierDirectory({request,endpoint,tenant,company,isCurrent}){
  const rows=new Map(),cursors=new Set();let after=null;
  do{
    if(!isCurrent())return null;
    if(after&&cursors.has(after))throw new Error('invalid_supplier_cursor');
    if(after)cursors.add(after);
    const query=new URLSearchParams({company_id:company,limit:'100',...(after?{after}:{})});
    const result=await request(endpoint+'?'+query,{headers:{'X-MasterERP-Tenant-Id':tenant}});
    if(!isCurrent())return null;
    const data=result?.data;
    if(!Array.isArray(data?.items)||data.items.some(row=>!row||typeof row.id!=='string'||typeof row.nombre!=='string'||typeof row.codigo!=='string'||!Array.isArray(row.roles))||!(data.next_cursor===null||typeof data.next_cursor==='string'))throw new Error('invalid_supplier_response');
    for(const row of data.items)rows.set(row.id,row);
    after=data.next_cursor;
  }while(after);
  return [...rows.values()];
}
