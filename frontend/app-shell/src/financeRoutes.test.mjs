import {test} from 'node:test';import assert from 'node:assert/strict';import {workspacePath,financeUrl} from './financeRoutes.mjs';
const id='00000001-0000-0000-0000-000000000001',base='/modulos/finanzas/administracion/proveedores';
test('independent supplier deep links round-trip without hash or tokens',()=>{for(const path of ['/modulos/finanzas',base,base+'/nuevo',base+'/'+id,base+'/'+id+'/editar']){const url=financeUrl(path),location=new URL(url,'https://finanzas-dev.uonify.com');assert.equal(workspacePath(location,true),path);assert.ok(!url.includes('#'));assert.ok(!url.includes('token'));}});
test('PKCE-returned hash routes are interpreted and can be normalized',()=>{const location=new URL('https://finanzas-dev.uonify.com/#'+base+'/'+id+'/editar');assert.equal(financeUrl(workspacePath(location,true)),'/?vista=proveedores&accion=editar&id='+id);});
test('unknown or external routes are never emitted as redirect targets',()=>{for(const path of ['https://example.invalid','//example.invalid',base+'/not-a-uuid',base+'/'+id+'/other','/auth/callback'])assert.equal(financeUrl(path),null);});
test('general workspace root remains independent of Finance routing',()=>{for(const origin of ['https://dev.uonify.com/','https://app-dev.uonify.com/'])assert.equal(workspacePath(new URL(origin)), '/');assert.equal(workspacePath(new URL('https://finanzas-dev.uonify.com/'),true),'/modulos/finanzas');});

test('purchase views preserve list/create/detail/edit on reload',()=>{for(const view of ['solicitudes-compra','ordenes-compra','facturas-proveedores'])for(const tail of ['','/nuevo','/'+id,'/'+id+'/editar']){const path='/modulos/finanzas/administracion/'+view+tail;assert.equal(workspacePath(new URL(financeUrl(path),'https://finanzas-dev.uonify.com'),true),path);}});

test('every Finance query view can survive the existing PKCE hash-only return contract',()=>{for(const view of ['clientes','proveedores','solicitudes-compra','ordenes-compra','facturas-proveedores']){const original=new URL('/?vista='+view+'&id='+id,'https://finanzas-dev.uonify.com');const logical=workspacePath(original,true);assert.notEqual(financeUrl(logical),'/');const callback=new URL('/#'+logical,original.origin);assert.equal(financeUrl(workspacePath(callback,true)),original.pathname+original.search);}});

test('sales read-only list and detail survive reload and PKCE',()=>{for(const tail of ['', '/'+id]){const path='/modulos/finanzas/administracion/ventas'+tail;const url=financeUrl(path);assert.equal(workspacePath(new URL(url,'https://finanzas-dev.uonify.com'),true),path);assert.ok(!url.includes('#'));}assert.equal(financeUrl('/modulos/finanzas/administracion/ventas/nuevo'),null);assert.equal(financeUrl('/modulos/finanzas/administracion/ventas/'+id+'/editar'),null);});
test('configuration query wins over stale hash routes',()=>{
 const path='/modulos/finanzas/configuracion';
 const url=financeUrl(path);
 assert.equal(url,'/?vista=configuracion');
 assert.equal(workspacePath(new URL('/?vista=configuracion#/modulos/finanzas','https://127.0.0.1:5187'),true),path);
 assert.equal(workspacePath(new URL(url,'https://127.0.0.1:5187'),true),path);
});
