import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSupplierText,matchesSupplier,loadSupplierDirectory} from './supplierSearch.mjs';

const row=(id,nombre)=>({id,nombre,codigo:'PROV-'+id,roles:['proveedor'],datos_generales:{numero_identificacion:'FISCAL-'+id,email:'private@example.invalid'}});
const options={endpoint:'https://api.example.invalid/proveedores',tenant:'tenant-a',company:'company-a',isCurrent:()=>true};
test('name, code and fiscal ID match case/accent-insensitively; email is outside this search',()=>{
 const supplier=row('3','Río Claro');
 assert.equal(normalizeSupplierText('  RÍO  '),'rio');
 for(const term of ['RIO','claro','prov-3','fiscal-3'])assert.equal(matchesSupplier(supplier,term),true);
 assert.equal(matchesSupplier(supplier,'private@example.invalid'),false);
});
test('search directory traverses all authorized pages, preserving tenant and company',async()=>{
 const calls=[];
 const request=async(url,settings)=>{calls.push({url,settings});return {data:calls.length===1?{items:[row('1','Primero')],next_cursor:'next'}:{items:[row('3','Proveedor remoto')],next_cursor:null}};};
 const rows=await loadSupplierDirectory({...options,request});
 assert.equal(rows.filter(s=>matchesSupplier(s,'remoto')).length,1);assert.equal(calls.length,2);
 for(const call of calls){const query=new URL(call.url).searchParams;assert.equal(query.get('company_id'),'company-a');assert.equal(query.get('limit'),'100');assert.equal(call.settings.headers['X-MasterERP-Tenant-Id'],'tenant-a');}
 assert.equal(new URL(calls[1].url).searchParams.get('after'),'next');
});
test('context cancellation discards results and stops further requests',async()=>{
 let current=true,calls=0;
 const result=await loadSupplierDirectory({...options,isCurrent:()=>current,request:async()=>{calls++;current=false;return {data:{items:[row('1','Old context')],next_cursor:'next'}};}});
 assert.equal(result,null);assert.equal(calls,1);
});
test('failure on a later page rejects instead of presenting incomplete matches',async()=>{
 let calls=0;
 await assert.rejects(loadSupplierDirectory({...options,request:async()=>{if(++calls===2)throw Error('second_page_failure');return {data:{items:[row('1','Partial')],next_cursor:'next'}};}}),/second_page_failure/);
});
test('repeated cursors stop safely instead of looping',async()=>{
 let calls=0;
 await assert.rejects(loadSupplierDirectory({...options,request:async()=>{calls++;return {data:{items:[row('1','Repeated')],next_cursor:'next'}};}}),/invalid_supplier_cursor/);assert.equal(calls,2);
});
test('malformed responses cannot be mistaken for an empty directory',async()=>{
 await assert.rejects(loadSupplierDirectory({...options,request:async()=>({data:{items:[]}})}),/invalid_supplier_response/);
});
